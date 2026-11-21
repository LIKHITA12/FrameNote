"""Dodo Payments billing: hosted checkout for Solo Pro and signed webhooks that keep the tier in sync.

Dodo signs webhooks with the Standard Webhooks scheme (https://www.standardwebhooks.com):
HMAC-SHA256 over "{webhook-id}.{webhook-timestamp}.{raw body}", keyed with the base64 part of
the "whsec_..." secret, sent as space-separated "v1,<base64>" values in the webhook-signature header.
"""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.subscription import Subscription
from app.models.user import User
from app.services.auth import get_user_subscription

logger = logging.getLogger("framenote.billing")

DODO_BASE_URLS = {
    "test_mode": "https://test.dodopayments.com",
    "live_mode": "https://live.dodopayments.com",
}
WEBHOOK_TOLERANCE_SECONDS = 5 * 60

# Subscription events that mean the customer has paid access right now.
_GRANT_EVENTS = {"subscription.active", "subscription.renewed", "subscription.plan_changed", "subscription.unpaused"}
# Events that end paid access. past_due is a grace period, so the tier is kept until on_hold/cancelled/expired.
_REVOKE_EVENTS = {"subscription.on_hold", "subscription.paused", "subscription.cancelled", "subscription.expired", "subscription.failed"}
_ACTIVE_STATUSES = {"active", "past_due"}


def create_checkout_url(db: Session, user: User, plan: str = "pro", billing_cycle: str = "monthly") -> str:
    _ = get_user_subscription(db=db, user_id=user.id)

    if plan != "pro":
        # Solo Pro is the only paid plan; Starter needs no checkout.
        raise HTTPException(status_code=400, detail="Unknown plan.")

    product_id = (
        settings.dodo_product_id_pro_annual if billing_cycle == "annual" else settings.dodo_product_id_pro_monthly
    )

    if not settings.dodo_payments_api_key or not product_id:
        if settings.environment == "production":
            raise HTTPException(status_code=503, detail="Billing is not configured yet.")
        # Local fallback keeps the dev flow testable without Dodo keys.
        return settings.billing_success_url

    body = {
        "product_cart": [{"product_id": product_id, "quantity": 1}],
        "customer": {"email": user.email},
        "return_url": settings.billing_success_url,
        "cancel_url": settings.billing_cancel_url,
        "metadata": {"user_id": user.id, "plan": plan, "billing_cycle": billing_cycle},
    }
    try:
        response = httpx.post(
            f"{DODO_BASE_URLS[settings.dodo_payments_environment]}/checkouts",
            json=body,
            headers={"Authorization": f"Bearer {settings.dodo_payments_api_key}"},
            timeout=20.0,
        )
        response.raise_for_status()
        checkout_url = response.json().get("checkout_url")
    except Exception as exc:
        logger.exception("Dodo checkout session creation failed")
        raise HTTPException(status_code=502, detail="Could not start checkout. Please try again.") from exc
    if not checkout_url:
        raise HTTPException(status_code=502, detail="Could not start checkout. Please try again.")
    return str(checkout_url)


def verify_webhook_signature(payload: bytes, headers: dict[str, str], secret: str) -> None:
    """Raise HTTPException(400) unless the request carries a valid, fresh Standard Webhooks signature."""
    webhook_id = headers.get("webhook-id")
    timestamp = headers.get("webhook-timestamp")
    signature_header = headers.get("webhook-signature")
    if not (webhook_id and timestamp and signature_header):
        raise HTTPException(status_code=400, detail="Missing webhook signature.")

    try:
        sent_at = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.") from exc
    if abs(time.time() - sent_at) > WEBHOOK_TOLERANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Webhook timestamp is too old.")

    try:
        key = base64.b64decode(secret.removeprefix("whsec_"))
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Billing webhooks are misconfigured.") from exc

    signed_content = f"{webhook_id}.{timestamp}.".encode() + payload
    expected = base64.b64encode(hmac.new(key, signed_content, hashlib.sha256).digest()).decode()
    for candidate in signature_header.split():
        version, _, value = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):
            return
    raise HTTPException(status_code=400, detail="Invalid webhook signature.")


def handle_webhook_event(db: Session, payload: bytes, headers: dict[str, str]) -> None:
    if not settings.dodo_payments_api_key:
        return

    # Every event must carry a valid signature; an unsigned body could otherwise grant Pro to any user.
    if not settings.dodo_payments_webhook_key:
        raise HTTPException(status_code=503, detail="Billing webhooks are not configured.")
    verify_webhook_signature(payload=payload, headers=headers, secret=settings.dodo_payments_webhook_key)

    try:
        event = json.loads(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload.") from exc

    event_type = str(event.get("type") or "")
    data = event.get("data") or {}
    if not event_type.startswith("subscription.") or not isinstance(data, dict):
        return

    subscription = _find_subscription(db=db, data=data)
    if subscription is None:
        logger.warning("Dodo %s event did not match any FrameNote user", event_type)
        return

    customer = data.get("customer") or {}
    subscription.payment_customer_id = customer.get("customer_id") or subscription.payment_customer_id
    subscription.payment_subscription_id = data.get("subscription_id") or subscription.payment_subscription_id

    status = str(data.get("status") or "")
    if event_type in _GRANT_EVENTS or (event_type == "subscription.updated" and status in _ACTIVE_STATUSES):
        subscription.tier = "pro"
        subscription.status = "active"
    elif event_type == "subscription.past_due":
        subscription.status = "past_due"
    elif event_type in _REVOKE_EVENTS or (event_type == "subscription.updated" and status and status not in _ACTIVE_STATUSES | {"pending"}):
        subscription.tier = "free"
        subscription.status = "inactive"

    db.add(subscription)
    db.commit()


def _find_subscription(db: Session, data: dict[str, Any]) -> Subscription | None:
    """Match an event to a user: by Dodo subscription id, then checkout metadata, then customer email."""
    subscription_id = data.get("subscription_id")
    if subscription_id:
        existing = db.query(Subscription).filter(Subscription.payment_subscription_id == subscription_id).first()
        if existing:
            return existing

    metadata = data.get("metadata") or {}
    user_id = metadata.get("user_id") if isinstance(metadata, dict) else None
    if user_id and db.get(User, str(user_id)):
        return get_user_subscription(db=db, user_id=str(user_id))

    email = (data.get("customer") or {}).get("email")
    if email:
        user = db.query(User).filter(func.lower(User.email) == str(email).lower()).first()
        if user:
            return get_user_subscription(db=db, user_id=user.id)
    return None


def create_customer_portal_url(db: Session, user: User) -> str:
    """Link to Dodo's hosted portal where a Pro user can update their card or cancel."""
    subscription = get_user_subscription(db=db, user_id=user.id)
    if not settings.dodo_payments_api_key or not subscription.payment_customer_id:
        raise HTTPException(status_code=404, detail="No billing account found for this user.")
    try:
        response = httpx.post(
            f"{DODO_BASE_URLS[settings.dodo_payments_environment]}/customers/{subscription.payment_customer_id}/customer-portal/session",
            params={"return_url": f"{settings.frontend_base_url.rstrip('/')}/upgrade"},
            headers={"Authorization": f"Bearer {settings.dodo_payments_api_key}"},
            timeout=20.0,
        )
        response.raise_for_status()
        link = response.json().get("link")
    except Exception as exc:
        logger.exception("Dodo customer portal session creation failed")
        raise HTTPException(status_code=502, detail="Could not open the billing portal. Please try again.") from exc
    if not link:
        raise HTTPException(status_code=502, detail="Could not open the billing portal. Please try again.")
    return str(link)

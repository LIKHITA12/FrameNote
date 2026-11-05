from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.subscription import Subscription
from app.models.user import User
from app.services.auth import get_user_subscription


def create_checkout_url(db: Session, user: User, plan: str = "pro", billing_cycle: str = "monthly") -> str:
    _ = get_user_subscription(db=db, user_id=user.id)

    if plan != "pro":
        # Solo Pro is the only paid plan; Starter needs no checkout.
        raise HTTPException(status_code=400, detail="Unknown plan.")

    price_id = (
        settings.stripe_price_id_pro_annual
        if billing_cycle == "annual"
        else settings.stripe_price_id_pro_monthly
    ) or settings.stripe_price_id_pro

    if not settings.stripe_secret_key or not price_id:
        # Local fallback keeps dev flow testable without Stripe keys.
        return settings.stripe_success_url

    try:
        import stripe

        stripe.api_key = settings.stripe_secret_key
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            customer_email=user.email,
            success_url=settings.stripe_success_url,
            cancel_url=settings.stripe_cancel_url,
            metadata={"user_id": user.id, "plan": plan, "billing_cycle": billing_cycle},
        )
        return str(session.url)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create checkout session: {exc}") from exc


def handle_webhook_event(db: Session, payload: bytes, signature: str | None) -> None:
    if not settings.stripe_secret_key:
        return

    import stripe

    stripe.api_key = settings.stripe_secret_key

    # Every event must carry a valid Stripe signature; an unsigned body could otherwise grant Pro to any user_id.
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Billing webhooks are not configured.")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature.")
    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=signature, secret=settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature.") from exc

    if isinstance(event, dict):
        event_type = event.get("type")
        data = event.get("data", {}).get("object", {})
    else:
        event_type = getattr(event, "type", None)
        data = getattr(getattr(event, "data", None), "object", {}) or {}

    if not isinstance(data, dict):
        data = dict(data)

    if event_type == "checkout.session.completed":
        user_id = data.get("metadata", {}).get("user_id")
        customer_id = data.get("customer")
        subscription_id = data.get("subscription")
        if user_id:
            subscription = get_user_subscription(db=db, user_id=user_id)
            subscription.tier = "pro"
            subscription.status = "active"
            subscription.stripe_customer_id = customer_id
            subscription.stripe_subscription_id = subscription_id
            db.add(subscription)
            db.commit()

    if event_type in {"customer.subscription.deleted", "customer.subscription.paused"}:
        subscription_id = data.get("id")
        if subscription_id:
            subscription = db.query(Subscription).filter(Subscription.stripe_subscription_id == subscription_id).first()
            if subscription:
                subscription.tier = "free"
                subscription.status = "inactive"
                db.add(subscription)
                db.commit()

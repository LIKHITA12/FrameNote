import base64
import hashlib
import hmac
import json
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.deps import get_db
from app.api.oauth_routes import router as oauth_router
from app.api.routes import router
from app.core.config import settings
from app.db import Base
from app.models.subscription import Subscription
from app.models.user import User
from app.services.auth import hash_password
from app.services.oauth import (
    MICROSOFT_CONSUMER_TENANT_ID,
    SSO_BINDING_COOKIE,
    OAuthError,
    OAuthUserInfo,
    microsoft_verified_email,
)

WEBHOOK_SECRET = "whsec_" + base64.b64encode(b"framenote-test-webhook-key").decode()


def _dodo_headers(payload: bytes, secret: str = WEBHOOK_SECRET, timestamp: int | None = None) -> dict[str, str]:
    """Standard Webhooks headers, signed the way Dodo Payments signs them."""
    webhook_id = "msg_test"
    sent_at = str(timestamp if timestamp is not None else int(time.time()))
    key = base64.b64decode(secret.removeprefix("whsec_"))
    digest = hmac.new(key, f"{webhook_id}.{sent_at}.".encode() + payload, hashlib.sha256).digest()
    return {
        "webhook-id": webhook_id,
        "webhook-timestamp": sent_at,
        "webhook-signature": f"v1,{base64.b64encode(digest).decode()}",
    }


class _ApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        app = FastAPI()
        app.include_router(router, prefix=settings.api_v1_prefix)
        app.include_router(oauth_router, prefix=settings.api_v1_prefix)

        def test_db():
            session = self.session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app, follow_redirects=False)

    def tearDown(self) -> None:
        self.client.close()
        self.db.close()
        self.engine.dispose()


class DodoWebhookTests(_ApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = User(email="buyer@example.test")
        self.db.add(self.user)
        self.db.commit()
        self.db.add(Subscription(user_id=self.user.id, tier="free", status="active"))
        self.db.commit()
        self.payload = self._event("subscription.active", status="active", metadata={"user_id": self.user.id})
        self.endpoint = f"{settings.api_v1_prefix}/billing/webhook"
        self._patches = [
            patch.object(settings, "dodo_payments_api_key", "dodo_test_key"),
            patch.object(settings, "dodo_payments_webhook_key", WEBHOOK_SECRET),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self) -> None:
        for item in self._patches:
            item.stop()
        super().tearDown()

    @staticmethod
    def _event(event_type: str, status: str, metadata: dict | None = None, email: str = "buyer@example.test") -> bytes:
        return json.dumps(
            {
                "business_id": "bus_test",
                "type": event_type,
                "timestamp": "2026-11-21T00:00:00Z",
                "data": {
                    "payload_type": "Subscription",
                    "subscription_id": "sub_1",
                    "customer": {"customer_id": "cus_1", "email": email},
                    "status": status,
                    "metadata": metadata or {},
                },
            }
        ).encode()

    def _subscription(self) -> Subscription:
        self.db.expire_all()
        return self.db.scalar(select(Subscription).where(Subscription.user_id == self.user.id))

    def _post(self, payload: bytes, headers: dict[str, str] | None = None):
        return self.client.post(self.endpoint, content=payload, headers=headers or {})

    def test_unsigned_event_cannot_grant_pro(self) -> None:
        response = self._post(self.payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._subscription().tier, "free")

    def test_forged_signature_is_rejected(self) -> None:
        wrong_secret = "whsec_" + base64.b64encode(b"not-the-real-key").decode()
        response = self._post(self.payload, _dodo_headers(self.payload, wrong_secret))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._subscription().tier, "free")

    def test_stale_timestamp_is_rejected(self) -> None:
        response = self._post(self.payload, _dodo_headers(self.payload, timestamp=int(time.time()) - 3600))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._subscription().tier, "free")

    def test_missing_webhook_secret_refuses_events(self) -> None:
        with patch.object(settings, "dodo_payments_webhook_key", None):
            response = self._post(self.payload, _dodo_headers(self.payload))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self._subscription().tier, "free")

    def test_signed_activation_grants_pro_and_stores_ids(self) -> None:
        response = self._post(self.payload, _dodo_headers(self.payload))
        self.assertEqual(response.status_code, 200)
        subscription = self._subscription()
        self.assertEqual(subscription.tier, "pro")
        self.assertEqual(subscription.payment_customer_id, "cus_1")
        self.assertEqual(subscription.payment_subscription_id, "sub_1")

    def test_activation_without_metadata_matches_customer_email(self) -> None:
        payload = self._event("subscription.active", status="active", email="BUYER@example.test")
        response = self._post(payload, _dodo_headers(payload))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._subscription().tier, "pro")

    def test_cancellation_downgrades_to_free(self) -> None:
        self._post(self.payload, _dodo_headers(self.payload))
        cancelled = self._event("subscription.cancelled", status="cancelled")
        response = self._post(cancelled, _dodo_headers(cancelled))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._subscription().tier, "free")

    def test_past_due_keeps_pro_during_grace_period(self) -> None:
        self._post(self.payload, _dodo_headers(self.payload))
        past_due = self._event("subscription.past_due", status="past_due")
        self._post(past_due, _dodo_headers(past_due))
        subscription = self._subscription()
        self.assertEqual(subscription.tier, "pro")
        self.assertEqual(subscription.status, "past_due")


class SsoLoginTests(_ApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self._patches = [
            patch.object(settings, "google_client_id", "google-client"),
            patch.object(settings, "google_client_secret", "google-secret"),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self) -> None:
        for item in self._patches:
            item.stop()
        super().tearDown()

    def _start_google_login(self) -> tuple[str, str]:
        response = self.client.get(f"{settings.api_v1_prefix}/auth/google/login")
        self.assertEqual(response.status_code, 307)
        query = parse_qs(urlsplit(response.headers["location"]).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        binding = response.cookies.get(SSO_BINDING_COOKIE)
        self.assertTrue(binding)
        return query["state"][0], binding

    def _callback(self, state: str, cookie: str | None, info: OAuthUserInfo | None = None):
        self.client.cookies.clear()
        if cookie is not None:
            self.client.cookies.set(SSO_BINDING_COOKIE, cookie)
        info = info or OAuthUserInfo(email="person@example.test", full_name="Person")
        with patch("app.services.oauth._exchange_google", return_value=info) as exchange:
            response = self.client.get(f"{settings.api_v1_prefix}/auth/google/callback", params={"code": "abc", "state": state})
        location = parse_qs(urlsplit(response.headers["location"]).query)
        return location, exchange

    def test_callback_from_another_browser_is_rejected(self) -> None:
        state, _ = self._start_google_login()
        location, exchange = self._callback(state, cookie=None)
        self.assertIn("same browser", location["sso_error"][0])
        exchange.assert_not_called()

        location, exchange = self._callback(state, cookie="attacker-browser-binding")
        self.assertIn("sso_error", location)
        exchange.assert_not_called()

    def test_callback_in_starting_browser_signs_in_with_pkce_verifier(self) -> None:
        state, binding = self._start_google_login()
        location, exchange = self._callback(state, cookie=binding)
        self.assertIn("sso_code", location)
        exchange.assert_called_once_with("abc", binding)
        user = self.db.scalar(select(User).where(User.email == "person@example.test"))
        self.assertTrue(user.email_verified)

    def test_sso_takeover_of_unverified_password_account_revokes_squatter(self) -> None:
        squatter = User(email="victim@example.test", password_hash=hash_password("attacker-password"))
        self.db.add(squatter)
        self.db.commit()
        # Revocation compares whole seconds, so make the squatter's token clearly older.
        issued = datetime.now(timezone.utc) - timedelta(seconds=10)
        old_token = jwt.encode(
            {"sub": squatter.id, "type": "access", "iat": issued, "exp": issued + timedelta(days=1)},
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        me = f"{settings.api_v1_prefix}/users/me"
        self.assertEqual(self.client.get(me, headers={"Authorization": f"Bearer {old_token}"}).status_code, 200)

        state, binding = self._start_google_login()
        location, _ = self._callback(state, cookie=binding, info=OAuthUserInfo(email="victim@example.test"))
        self.assertIn("sso_code", location)

        self.db.expire_all()
        account = self.db.get(User, squatter.id)
        self.assertIsNone(account.password_hash)
        self.assertTrue(account.email_verified)
        self.assertEqual(self.client.get(me, headers={"Authorization": f"Bearer {old_token}"}).status_code, 401)

        exchange = self.client.post(f"{settings.api_v1_prefix}/auth/sso/exchange", json={"code": location["sso_code"][0]})
        self.assertEqual(exchange.status_code, 200)
        new_token = exchange.json()["access_token"]
        self.assertEqual(self.client.get(me, headers={"Authorization": f"Bearer {new_token}"}).status_code, 200)


class ProviderEmailVerificationTests(unittest.TestCase):
    def test_google_unverified_email_is_rejected(self) -> None:
        from app.services import oauth

        class FakeResponse:
            def __init__(self, body):
                self.body = body

            def raise_for_status(self):
                return None

            def json(self):
                return self.body

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def post(self, *args, **kwargs):
                return FakeResponse({"access_token": "token"})

            def get(self, *args, **kwargs):
                return FakeResponse({"email": "victim@example.test", "email_verified": False})

        with patch.object(oauth.httpx, "Client", FakeClient), self.assertRaises(OAuthError):
            oauth._exchange_google("code", "verifier")

    def test_microsoft_requires_provider_verified_email(self) -> None:
        work_tenant = "11111111-2222-3333-4444-555555555555"
        with self.assertRaises(OAuthError):
            microsoft_verified_email({"email": "victim@example.test", "tid": work_tenant})
        self.assertEqual(
            microsoft_verified_email({"email": "me@outlook.com", "tid": MICROSOFT_CONSUMER_TENANT_ID}), "me@outlook.com"
        )
        self.assertEqual(
            microsoft_verified_email({"email": "me@corp.test", "tid": work_tenant, "xms_edov": True}), "me@corp.test"
        )
        with patch.object(settings, "microsoft_trusted_tenant_ids", work_tenant.upper()):
            self.assertEqual(microsoft_verified_email({"email": "me@corp.test", "tid": work_tenant}), "me@corp.test")


if __name__ == "__main__":
    unittest.main()

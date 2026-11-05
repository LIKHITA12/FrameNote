import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.core.config import Settings, settings
from app.services.rate_limit import check_rate_limit
from app.services.storage import create_upload_presign
from app import main

PRODUCTION_DB_URL = "postgresql+psycopg://framenote:long-random-password@db.example.test/framenote?sslmode=require"


class SecuritySettingsTests(unittest.TestCase):
    def test_production_rejects_unsafe_defaults(self) -> None:
        with self.assertRaises(ValueError):
            Settings(_env_file=None, environment="production")
        with self.assertRaises(ValueError):
            Settings(
                _env_file=None, environment="production", jwt_secret_key="0123456789abcdefghijklmnopqrstuv",
                legacy_header_auth_enabled=True, r2_endpoint="https://r2.example.test",
                r2_access_key_id="key", r2_secret_access_key="secret", r2_bucket="private",
                database_url=PRODUCTION_DB_URL,
            )
        secure = Settings(
            _env_file=None, environment="production", jwt_secret_key="0123456789abcdefghijklmnopqrstuv",
            legacy_header_auth_enabled=False, r2_endpoint="https://r2.example.test",
            r2_access_key_id="key", r2_secret_access_key="secret", r2_bucket="private",
            database_url=PRODUCTION_DB_URL, openai_api_key="sk-test",
        )
        self.assertEqual(secure.environment, "production")

    def test_production_rejects_development_or_unencrypted_database(self) -> None:
        base = dict(
            _env_file=None, environment="production", jwt_secret_key="0123456789abcdefghijklmnopqrstuv",
            legacy_header_auth_enabled=False, r2_endpoint="https://r2.example.test",
            r2_access_key_id="key", r2_secret_access_key="secret", r2_bucket="private",
        )
        for url in (
            "sqlite:///./framenote.db",
            "postgresql+psycopg://postgres:postgres@postgres:5432/framenote",
            "postgresql+psycopg://framenote:secret@db.example.test/framenote",
            "postgresql+psycopg://framenote:secret@localhost/framenote?sslmode=require",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                Settings(**base, database_url=url)

    def test_sensitive_action_has_limit(self) -> None:
        with patch.object(settings, "environment", "test"):
            check_rate_limit("security-test", "unique-media-security-identity", 2, 3600)
            check_rate_limit("security-test", "unique-media-security-identity", 2, 3600)
            with self.assertRaises(HTTPException) as denied:
                check_rate_limit("security-test", "unique-media-security-identity", 2, 3600)
            self.assertEqual(denied.exception.status_code, 429)

    def test_r2_upload_uses_size_limited_post_policy(self) -> None:
        s3 = MagicMock()
        s3.generate_presigned_post.return_value = {"url": "https://r2.example.test/upload", "fields": {"key": "asset"}}
        with patch("app.services.storage._can_use_r2", return_value=True), patch("app.services.storage.boto3.client", return_value=s3):
            url, method, headers, fields, _ = create_upload_presign(
                "uploads/user/file.mp4", "video/mp4", "http://localhost:8000/", "user"
            )
        self.assertEqual(url, "https://r2.example.test/upload")
        self.assertEqual(method, "POST")
        self.assertEqual(headers, {})
        self.assertEqual(fields, {"key": "asset"})
        conditions = s3.generate_presigned_post.call_args.kwargs["Conditions"]
        self.assertIn(["content-length-range", 1, settings.max_upload_bytes], conditions)

    def test_production_startup_does_not_create_schema_or_demo_account(self) -> None:
        with patch.object(settings, "environment", "production"), patch.object(main.Base.metadata, "create_all") as create_all, patch.object(main, "_ensure_demo_account") as demo, patch.object(main, "assert_schema_current") as schema:
            main.on_startup()
        create_all.assert_not_called()
        demo.assert_not_called()
        schema.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()

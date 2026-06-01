import unittest

from sync_preflight_service import assert_webapp_sync_ready, SyncPreflightError


class SyncPreflightServiceTest(unittest.TestCase):
    def test_rejects_webapp_sync_when_runtime_uses_local_storage(self):
        with self.assertRaises(SyncPreflightError) as ctx:
            assert_webapp_sync_ready(
                storage_backend="local",
                env={
                    "WEBAPP_DB_URL": "postgresql://example",
                    "WEBAPP_JWT_SECRET": "secret",
                    "STORAGE_PROVIDER": "local",
                },
            )

        self.assertIn("GCS", str(ctx.exception))

    def test_allows_webapp_sync_with_gcs_runtime_storage(self):
        assert_webapp_sync_ready(
            storage_backend="gcs",
            env={
                "WEBAPP_DB_URL": "postgresql://example",
                "WEBAPP_JWT_SECRET": "secret",
                "STORAGE_PROVIDER": "gcs",
                "GCS_BUCKET_NAME": "gradesense-prod",
                "GOOGLE_APPLICATION_CREDENTIALS_JSON": '{"type":"service_account"}',
            },
        )


if __name__ == "__main__":
    unittest.main()

import unittest

from storage_service import resolve_gcs_credentials


class StorageServiceTest(unittest.TestCase):
    def test_resolve_gcs_credentials_prefers_service_account_json(self):
        credentials = resolve_gcs_credentials({
            "GOOGLE_APPLICATION_CREDENTIALS_JSON": '{"type":"service_account"}',
            "GOOGLE_APPLICATION_CREDENTIALS": "/tmp/unused.json",
        })

        self.assertEqual(credentials["mode"], "json")
        self.assertEqual(credentials["value"], {"type": "service_account"})

    def test_resolve_gcs_credentials_uses_file_path_when_json_absent(self):
        credentials = resolve_gcs_credentials({
            "GOOGLE_APPLICATION_CREDENTIALS": "/etc/secrets/google.json",
        })

        self.assertEqual(credentials["mode"], "path")
        self.assertEqual(credentials["value"], "/etc/secrets/google.json")


if __name__ == "__main__":
    unittest.main()

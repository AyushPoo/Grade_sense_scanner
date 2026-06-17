import unittest

from review_file_url_service import build_gcs_proxy_url


class ReviewFileUrlServiceTest(unittest.TestCase):
    def test_build_gcs_proxy_url_returns_absolute_cache_busted_backend_url(self):
        url = build_gcs_proxy_url(
            "https://grade-sense-scanner-323601156671.asia-south2.run.app/",
            "submissions/sub_1/answer-sheets/file A.pdf",
            cache_key="file_123",
        )

        self.assertEqual(
            url,
            "https://grade-sense-scanner-323601156671.asia-south2.run.app/api/files-gcs/submissions/sub_1/answer-sheets/file%20A.pdf?v=file_123",
        )

    def test_build_gcs_proxy_url_handles_missing_values(self):
        self.assertIsNone(build_gcs_proxy_url("https://example.com", None))
        self.assertIsNone(build_gcs_proxy_url("", "file.pdf"))


if __name__ == "__main__":
    unittest.main()

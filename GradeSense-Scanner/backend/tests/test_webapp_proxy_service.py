import unittest

from webapp_proxy_service import WebappProxyConfigError, build_proxy_headers, build_webapp_url


class WebappProxyServiceTest(unittest.TestCase):
    def test_build_webapp_url_normalizes_base_and_path(self):
        self.assertEqual(
            build_webapp_url("https://app.gradesense.in/", "/api/v1/exams"),
            "https://app.gradesense.in/api/v1/exams",
        )
        self.assertEqual(
            build_webapp_url("https://app.gradesense.in/client", "api/v1/feedback"),
            "https://app.gradesense.in/client/api/v1/feedback",
        )

    def test_build_webapp_url_rejects_missing_or_unsafe_paths(self):
        with self.assertRaises(WebappProxyConfigError):
            build_webapp_url("", "/api/v1/exams")
        with self.assertRaises(ValueError):
            build_webapp_url("https://app.gradesense.in", "https://evil.test/api")
        with self.assertRaises(ValueError):
            build_webapp_url("https://app.gradesense.in", "/api/v1/../admin")

    def test_build_proxy_headers_preserves_auth_and_mobile_bypass_header(self):
        headers = build_proxy_headers("Bearer token_123")

        self.assertEqual(headers["Authorization"], "Bearer token_123")
        self.assertEqual(headers["Bypass-Tunnel-Reminder"], "true")


if __name__ == "__main__":
    unittest.main()

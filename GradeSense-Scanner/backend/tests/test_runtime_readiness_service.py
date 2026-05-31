import unittest

from runtime_readiness_service import build_readiness_report


class RuntimeReadinessServiceTest(unittest.TestCase):
    def test_build_readiness_report_marks_required_environment(self):
        report = build_readiness_report({
            "MONGO_URL": "mongodb://example",
            "DB_NAME": "gradesense",
            "WEBAPP_DB_URL": "postgresql://example",
            "WEBAPP_JWT_SECRET": "secret",
        })

        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["missingRequired"], [])
        self.assertEqual(report["checks"]["database"]["configured"], True)
        self.assertEqual(report["checks"]["webappSync"]["configured"], True)

    def test_build_readiness_report_does_not_expose_secret_values(self):
        report = build_readiness_report({
            "MONGO_URL": "mongodb://username:password@example",
            "DB_NAME": "gradesense",
            "WEBAPP_DB_URL": "postgresql://secret",
            "WEBAPP_JWT_SECRET": "super-secret",
            "WEBAPP_URL": "https://example.com",
        })

        rendered = str(report)
        self.assertNotIn("password", rendered)
        self.assertNotIn("super-secret", rendered)
        self.assertNotIn("postgresql://secret", rendered)

    def test_build_readiness_report_flags_missing_webapp_sync(self):
        report = build_readiness_report({
            "MONGO_URL": "mongodb://example",
            "DB_NAME": "gradesense",
        })

        self.assertEqual(report["status"], "degraded")
        self.assertIn("WEBAPP_DB_URL", report["missingRequired"])
        self.assertIn("WEBAPP_JWT_SECRET", report["missingRequired"])
        self.assertEqual(report["checks"]["webappSync"]["configured"], False)


if __name__ == "__main__":
    unittest.main()

import unittest

from server import PORTAL_PROXY_ROUTES, get_missing_portal_proxy_routes


class PortalProxyRoutesTest(unittest.TestCase):
    def test_required_mobile_portal_routes_are_registered(self):
        self.assertGreater(len(PORTAL_PROXY_ROUTES), 0)
        self.assertEqual(get_missing_portal_proxy_routes(), [])


if __name__ == "__main__":
    unittest.main()

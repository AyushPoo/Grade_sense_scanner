import unittest

from gcs_file_response_service import (
    InvalidGCSKeyError,
    InvalidRangeHeaderError,
    build_file_headers,
    infer_content_type,
    parse_range_header,
    sanitize_gcs_key,
)


class GCSFileResponseServiceTest(unittest.TestCase):
    def test_sanitize_gcs_key_rejects_empty_and_parent_paths(self):
        with self.assertRaises(InvalidGCSKeyError):
            sanitize_gcs_key("")
        with self.assertRaises(InvalidGCSKeyError):
            sanitize_gcs_key("submissions/../secret.pdf")

    def test_sanitize_gcs_key_normalizes_leading_slashes(self):
        self.assertEqual(
            sanitize_gcs_key("/submissions/sub_1/file.pdf"),
            "submissions/sub_1/file.pdf",
        )

    def test_infer_content_type_prefers_stored_value(self):
        self.assertEqual(infer_content_type("paper.pdf", "application/pdf"), "application/pdf")
        self.assertEqual(infer_content_type("paper.pdf", None), "application/pdf")

    def test_parse_range_header_supports_standard_and_suffix_ranges(self):
        self.assertEqual(parse_range_header("bytes=10-19", 100).start, 10)
        self.assertEqual(parse_range_header("bytes=10-19", 100).end, 19)
        self.assertEqual(parse_range_header("bytes=-10", 100).start, 90)
        self.assertEqual(parse_range_header("bytes=-10", 100).end, 99)
        self.assertEqual(parse_range_header("bytes=95-", 100).end, 99)

    def test_parse_range_header_rejects_invalid_ranges(self):
        with self.assertRaises(InvalidRangeHeaderError):
            parse_range_header("items=0-1", 100)
        with self.assertRaises(InvalidRangeHeaderError):
            parse_range_header("bytes=200-300", 100)

    def test_build_file_headers_supports_partial_content(self):
        byte_range = parse_range_header("bytes=10-19", 100)
        headers = build_file_headers(
            filename="paper.pdf",
            content_type="application/pdf",
            content_length=100,
            byte_range=byte_range,
        )

        self.assertEqual(headers["Accept-Ranges"], "bytes")
        self.assertEqual(headers["Content-Length"], "10")
        self.assertEqual(headers["Content-Range"], "bytes 10-19/100")
        self.assertEqual(headers["Content-Disposition"], 'inline; filename="paper.pdf"')


if __name__ == "__main__":
    unittest.main()

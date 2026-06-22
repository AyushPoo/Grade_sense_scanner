from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from typing import Optional


class InvalidGCSKeyError(ValueError):
    pass


class InvalidRangeHeaderError(ValueError):
    pass


@dataclass(frozen=True)
class ByteRange:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1


def sanitize_gcs_key(gcs_key: str) -> str:
    normalized = (gcs_key or "").strip().lstrip("/")
    if not normalized or any(part == ".." for part in normalized.split("/")):
        raise InvalidGCSKeyError("Invalid file path")
    return normalized


def infer_content_type(filename: str, stored_content_type: Optional[str]) -> str:
    if stored_content_type and stored_content_type != "application/octet-stream":
        return stored_content_type
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def parse_range_header(range_header: Optional[str], size: int) -> Optional[ByteRange]:
    if not range_header:
        return None
    if size <= 0:
        raise InvalidRangeHeaderError("Cannot range an empty file")

    value = range_header.strip().lower()
    if not value.startswith("bytes="):
        raise InvalidRangeHeaderError("Only byte ranges are supported")

    raw_range = value.removeprefix("bytes=").split(",", 1)[0].strip()
    if "-" not in raw_range:
        raise InvalidRangeHeaderError("Invalid byte range")

    start_text, end_text = raw_range.split("-", 1)
    if not start_text and not end_text:
        raise InvalidRangeHeaderError("Invalid byte range")

    if not start_text:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            raise InvalidRangeHeaderError("Invalid byte range")
        start = max(size - suffix_length, 0)
        end = size - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1

    if start < 0 or end < start or start >= size:
        raise InvalidRangeHeaderError("Requested range is outside the file")

    return ByteRange(start=start, end=min(end, size - 1))


def build_file_headers(
    *,
    filename: str,
    content_type: str,
    content_length: int,
    byte_range: Optional[ByteRange] = None,
) -> dict[str, str]:
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=2592000, must-revalidate",
        "Content-Disposition": f'inline; filename="{filename}"',
        "Content-Type": content_type,
    }

    if byte_range:
        headers["Content-Length"] = str(byte_range.length)
        headers["Content-Range"] = f"bytes {byte_range.start}-{byte_range.end}/{content_length}"
    else:
        headers["Content-Length"] = str(content_length)

    return headers

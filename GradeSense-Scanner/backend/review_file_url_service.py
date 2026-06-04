from __future__ import annotations

from typing import Optional
from urllib.parse import quote


def build_gcs_proxy_url(base_url: str, gcs_key: Optional[str], cache_key: Optional[str] = None) -> Optional[str]:
    if not base_url or not gcs_key:
        return None

    normalized_base = base_url.rstrip("/")
    encoded_key = quote(gcs_key.strip("/"), safe="/")
    url = f"{normalized_base}/api/files-gcs/{encoded_key}"

    if cache_key:
        url = f"{url}?v={quote(str(cache_key), safe='')}"

    return url

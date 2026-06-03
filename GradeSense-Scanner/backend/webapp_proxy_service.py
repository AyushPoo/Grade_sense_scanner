from urllib.parse import urlparse


class WebappProxyConfigError(RuntimeError):
    """Raised when the scanner backend cannot safely proxy to the webapp."""


def build_webapp_url(base_url: str | None, path: str) -> str:
    if not base_url or not base_url.strip():
        raise WebappProxyConfigError("WEBAPP_URL is not configured.")

    normalized_path = path.strip()
    parsed_path = urlparse(normalized_path)
    if parsed_path.scheme or parsed_path.netloc:
        raise ValueError("Proxy paths must be relative webapp API paths.")
    if ".." in normalized_path.split("/"):
        raise ValueError("Proxy paths may not contain parent-directory segments.")

    return f"{base_url.rstrip('/')}/{normalized_path.lstrip('/')}"


def build_proxy_headers(authorization: str) -> dict[str, str]:
    return {
        "Authorization": authorization,
        "Bypass-Tunnel-Reminder": "true",
    }

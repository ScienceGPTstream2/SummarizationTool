"""
Auth Proxy
==========
Transparently forwards /api/auth/* requests to the BetterAuth sidecar
(AUTH_SIDECAR_URL, default http://localhost:3001).

In production (Azure Container Apps) the frontend SWA routes /api/* to this
FastAPI backend. Because the auth sidecar runs on localhost:3001 inside the
same container-app pod, we forward rather than running nginx.
"""

import logging
import os

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth-proxy"])

_AUTH_SIDECAR_URL = os.getenv("AUTH_SIDECAR_URL", "http://localhost:3001")


def _get_allowed_emails() -> set:
    raw = os.getenv("ALLOWED_EMAILS", "")
    if not raw.strip():
        return set()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}

# Headers that must not be forwarded (hop-by-hop or would break the proxy).
_HOP_BY_HOP = frozenset(
    [
        "host",
        "content-length",
        "transfer-encoding",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "upgrade",
    ]
)


@router.api_route(
    "/api/auth/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def proxy_auth(path: str, request: Request) -> Response:
    """Forward any /api/auth/* request to the BetterAuth sidecar."""
    target_url = f"{_AUTH_SIDECAR_URL}/api/auth/{path}"

    # Pass all headers except hop-by-hop ones; add forwarding hints.
    forward_headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP
    }
    forward_headers["x-forwarded-host"] = request.headers.get("host", "")
    forward_headers["x-forwarded-proto"] = request.url.scheme

    body = await request.body()

    async with httpx.AsyncClient(timeout=30.0) as client:
        upstream = await client.request(
            method=request.method,
            url=target_url,
            headers=forward_headers,
            content=body,
            params=dict(request.query_params),
            follow_redirects=False,
        )

    # Enforce email allowlist: intercept get-session before returning to browser.
    # This is the call the frontend makes to determine auth state on every page load.
    if path == "get-session" and request.method.upper() == "GET" and upstream.status_code == 200:
        allowed = _get_allowed_emails()
        if allowed:
            try:
                data = upstream.json()
                email = (data.get("user") or {}).get("email", "")
                if email and email.lower() not in allowed:
                    logger.info(f"[Allowlist] Blocked get-session for {email}")
                    return JSONResponse(
                        status_code=403,
                        content={"error": "Access denied: email not authorized"},
                    )
            except Exception as exc:
                logger.error(f"[Allowlist] Error parsing get-session response: {exc}")

    # Build response — handle Set-Cookie specially since there can be multiples
    # and a dict would drop all but the last one.
    single_headers = {}
    set_cookie_values = []
    for k, v in upstream.headers.multi_items():
        if k.lower() in _HOP_BY_HOP:
            continue
        if k.lower() == "set-cookie":
            set_cookie_values.append(v)
        else:
            single_headers[k] = v

    response = Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=single_headers,
    )
    # Append each Set-Cookie header individually so none are lost
    for cookie_val in set_cookie_values:
        response.headers.append("set-cookie", cookie_val)

    return response

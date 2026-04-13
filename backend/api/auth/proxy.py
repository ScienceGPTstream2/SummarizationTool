"""
Auth Proxy
==========
Transparently forwards /api/auth/* requests to the BetterAuth sidecar
(AUTH_SIDECAR_URL, default http://localhost:3001).

In production (Azure Container Apps) the frontend SWA routes /api/* to this
FastAPI backend. Because the auth sidecar runs on localhost:3001 inside the
same container-app pod, we forward rather than running nginx.
"""

import os
import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter(tags=["auth-proxy"])

_AUTH_SIDECAR_URL = os.getenv("AUTH_SIDECAR_URL", "http://localhost:3001")

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

    # Strip hop-by-hop from response but keep everything else (incl. Set-Cookie).
    resp_headers = {
        k: v for k, v in upstream.headers.multi_items() if k.lower() not in _HOP_BY_HOP
    }

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
    )

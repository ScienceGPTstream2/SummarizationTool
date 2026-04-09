#!/usr/bin/env bash
# Run all integration tests against the live backend.
#
# Usage:
#   export AUTH_TOKEN_A="<your-token-user-a>"
#   export AUTH_TOKEN_B="<your-token-user-b>"
#   ./backend/tests/run_all_tests.sh
#
# Or pass tokens inline:
#   AUTH_TOKEN_A="..." AUTH_TOKEN_B="..." ./backend/tests/run_all_tests.sh

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8001}"
export BACKEND_URL

if [ -z "${AUTH_TOKEN_A:-}" ] || [ -z "${AUTH_TOKEN_B:-}" ]; then
    echo "ERROR: Both AUTH_TOKEN_A and AUTH_TOKEN_B must be set."
    echo ""
    echo "  export AUTH_TOKEN_A='<token-for-user-a>'"
    echo "  export AUTH_TOKEN_B='<token-for-user-b>'"
    exit 1
fi

echo "=== Backend Health Check ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/server/server-config" || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
    echo "WARNING: Backend not responding at $BACKEND_URL (HTTP $HTTP_CODE)"
    echo "Tests may fail. Make sure the backend is running."
fi

echo ""
echo "=== Running Full Test Suite ==="
echo "Backend: $BACKEND_URL"
echo ""

cd "$(dirname "$0")/.."

python3 -m pytest tests/test_auth_edge_cases.py \
                   tests/test_session_edge_cases.py \
                   tests/test_cross_user_isolation.py \
                   tests/test_groups_integration.py \
                   tests/test_session_sharing_integration.py \
                   -v -s --tb=short \
                   "$@"

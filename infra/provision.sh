#!/usr/bin/env bash
# infra/provision.sh
#
# One-time provisioning of the Azure Container App.
# Run this ONCE when standing up a new environment.
# Subsequent image updates are handled by GitHub Actions automatically.
#
# Usage:
#   1. Fill in the exports below (or set them in your shell first).
#   2. chmod +x infra/provision.sh && ./infra/provision.sh
#
# Prerequisites:
#   az login (or az login --use-device-code)
#   az extension add --name containerapp

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — set these or export them before running
# ---------------------------------------------------------------------------
: "${AZURE_SUBSCRIPTION_ID:?Need AZURE_SUBSCRIPTION_ID}"
: "${AZURE_RESOURCE_GROUP:?Need AZURE_RESOURCE_GROUP}"
: "${CONTAINER_APP_ENV_NAME:?Need CONTAINER_APP_ENV_NAME}"
: "${CONTAINER_APP_NAME:=summarization-app}"

: "${ACR_NAME:?Need ACR_NAME}"
: "${ACR_USERNAME:?Need ACR_USERNAME}"
: "${ACR_PASSWORD:?Need ACR_PASSWORD}"

: "${STATIC_WEB_APP_URL:?Need STATIC_WEB_APP_URL}"   # e.g. lemon-river-abc.azurestaticapps.net

: "${DATABASE_URL:?Need DATABASE_URL}"
: "${GITHUB_CLIENT_ID:?Need GITHUB_CLIENT_ID}"
: "${GITHUB_CLIENT_SECRET:?Need GITHUB_CLIENT_SECRET}"
: "${BETTER_AUTH_SECRET:?Need BETTER_AUTH_SECRET}"
: "${AZURE_STORAGE_CONNECTION_STRING:?Need AZURE_STORAGE_CONNECTION_STRING}"

# ---------------------------------------------------------------------------
# Substitute placeholders → generate ephemeral YAML, never written to disk
# ---------------------------------------------------------------------------
RESOLVED_YAML=$(envsubst < "$(dirname "$0")/container-app.yaml")

echo "→ Creating Container App: $CONTAINER_APP_NAME"
echo "$RESOLVED_YAML" | az containerapp create \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --yaml /dev/stdin

echo "✓ Done. Container App is live."
echo "  Remember to register the GitHub OAuth callback URL in your GitHub App:"
echo "  https://${STATIC_WEB_APP_URL}/api/auth/callback/github"

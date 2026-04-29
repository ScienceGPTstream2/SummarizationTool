#!/usr/bin/env bash
# status.sh — Report the image SHA currently deployed in staging and production.
#
# Usage:
#   bash scripts/status.sh
#
# Prerequisites:
#   - az CLI installed and logged in (az login or az login --service-principal)
#   - Environment variables set (see below), or edit the defaults in this script.
#
# Required environment variables (or edit defaults below):
#   AZURE_RESOURCE_GROUP
#   AZURE_SUBSCRIPTION_ID
#   STAGING_CONTAINER_APP_NAME     Container App name for staging
#   STAGING_FRONTEND_APP_NAME      Container App name for frontend (staging)
#   PROD_CONTAINER_APP_NAME        Container App name for production
#   PROD_FRONTEND_APP_NAME         Container App name for frontend (production)
set -euo pipefail

RG="${AZURE_RESOURCE_GROUP:-HcSx-ScienceGPT3-XerographicMockingbird-vNet-rg}"
SUB="${AZURE_SUBSCRIPTION_ID:-9c673b89-f870-4b2e-ac72-fb91ac4fdd12}"
STAGING_APP="${STAGING_CONTAINER_APP_NAME:-}"
STAGING_FE="${STAGING_FRONTEND_APP_NAME:-}"
PROD_APP="${PROD_CONTAINER_APP_NAME:-}"
PROD_FE="${PROD_FRONTEND_APP_NAME:-}"

get_containerapp_sha() {
  local app="$1" container="$2" image
  image=$(az containerapp show \
    --name "$app" \
    --resource-group "$RG" \
    --subscription "$SUB" \
    --query "properties.template.containers[?name=='${container}'].image | [0]" \
    -o tsv 2>/dev/null || true)
  echo "${image##*:}"
}

echo "=== Staging ==="
if [ -n "$STAGING_APP" ] && [ -n "$STAGING_FE" ]; then
  FE_SHA=$(get_containerapp_sha "$STAGING_FE" summarization-frontend)
  BE_SHA=$(get_containerapp_sha "$STAGING_APP" backend)
  AU_SHA=$(get_containerapp_sha "$STAGING_APP" auth-sidecar)
  echo "  frontend:  ${FE_SHA}"
  echo "  backend:   ${BE_SHA}"
  echo "  auth:      ${AU_SHA}"
  if [ -z "$FE_SHA" ] || [ -z "$BE_SHA" ] || [ -z "$AU_SHA" ]; then
    echo "  ⚠️  Could not retrieve one or more SHAs — check az login and app names"
  elif [ "$FE_SHA" = "$BE_SHA" ] && [ "$BE_SHA" = "$AU_SHA" ]; then
    echo "  ✅ All three on the same SHA"
  else
    echo "  ⚠️  Mixed SHAs — staging may be partially deployed"
  fi
else
  echo "  (set STAGING_CONTAINER_APP_NAME and STAGING_FRONTEND_APP_NAME)"
fi

echo ""
echo "=== Production ==="
if [ -n "$PROD_APP" ] && [ -n "$PROD_FE" ]; then
  FE_SHA=$(get_containerapp_sha "$PROD_FE" summarization-frontend)
  BE_SHA=$(get_containerapp_sha "$PROD_APP" backend)
  AU_SHA=$(get_containerapp_sha "$PROD_APP" auth-sidecar)
  echo "  frontend:  ${FE_SHA}"
  echo "  backend:   ${BE_SHA}"
  echo "  auth:      ${AU_SHA}"
  if [ -z "$FE_SHA" ] || [ -z "$BE_SHA" ] || [ -z "$AU_SHA" ]; then
    echo "  ⚠️  Could not retrieve one or more SHAs — check az login and app names"
  elif [ "$FE_SHA" = "$BE_SHA" ] && [ "$BE_SHA" = "$AU_SHA" ]; then
    echo "  ✅ All three on the same SHA"
  else
    echo "  ⚠️  Mixed SHAs — production may be in a bad state"
  fi
else
  echo "  (set PROD_CONTAINER_APP_NAME and PROD_FRONTEND_APP_NAME)"
fi

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# deploy-aca.sh — Deploy SummarizationTool to Azure Container Apps
#
# Usage (from Cloud Shell or any az-authenticated shell):
#   bash scripts/deploy-aca.sh                # Deploy latest images
#   bash scripts/deploy-aca.sh abc1234        # Deploy a specific tag
#   bash scripts/deploy-aca.sh --backend      # Deploy backend only
#   bash scripts/deploy-aca.sh --auth         # Deploy auth sidecar only
#   bash scripts/deploy-aca.sh --build        # Build + push + deploy
#   bash scripts/deploy-aca.sh --status       # Check current status
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ──
RG="HcSx-ScienceGPT3-XerographicMockingbird-vNet-rg"
APP="summarization-backend"
ACR="summarizationtoolacr"
REGISTRY="${ACR}.azurecr.io"
SUB="9c673b89-f870-4b2e-ac72-fb91ac4fdd12"

# ── Parse args ──
TAG="${1:-latest}"
DEPLOY_BACKEND=true
DEPLOY_AUTH=true
BUILD=false
STATUS=false

case "${1:-}" in
  --backend) DEPLOY_AUTH=false; TAG="latest" ;;
  --auth)    DEPLOY_BACKEND=false; TAG="latest" ;;
  --build)   BUILD=true; TAG="latest" ;;
  --status)  STATUS=true ;;
  --help|-h)
    echo "Usage: deploy-aca.sh [TAG|--backend|--auth|--build|--status]"
    exit 0
    ;;
esac

# ── Status check ──
if $STATUS; then
  echo "📊 Container App Status:"
  az containerapp revision list --name "$APP" --resource-group "$RG" --subscription "$SUB" \
    --query "[].{Revision:name, Status:properties.runningState, Health:properties.healthState, Replicas:properties.replicas}" -o table
  echo ""
  echo "🔑 Secrets:"
  az containerapp secret list --name "$APP" --resource-group "$RG" --subscription "$SUB" -o table
  echo ""
  echo "📦 ACR Images (backend):"
  az acr repository show-tags --name "$ACR" --repository summarization-backend --top 5 --orderby time_desc -o tsv 2>/dev/null || echo "  (none)"
  echo ""
  echo "📦 ACR Images (auth):"
  az acr repository show-tags --name "$ACR" --repository summarization-auth --top 5 --orderby time_desc -o tsv 2>/dev/null || echo "  (none)"
  exit 0
fi

# ── Build (optional) ──
if $BUILD; then
  echo "🔨 Building backend image in ACR..."
  az acr build --registry "$ACR" --subscription "$SUB" \
    --image "summarization-backend:latest" ./backend

  echo "🔨 Building auth image in ACR..."
  az acr build --registry "$ACR" --subscription "$SUB" \
    --image "summarization-auth:latest" ./auth-service

  TAG="latest"
fi

# ── Deploy ──
echo "🚀 Deploying tag: $TAG"

if $DEPLOY_BACKEND; then
  echo "  → Updating backend container..."
  az containerapp update --name "$APP" --resource-group "$RG" --subscription "$SUB" \
    --container-name backend \
    --image "${REGISTRY}/summarization-backend:${TAG}" 2>&1 | tail -3
fi

if $DEPLOY_AUTH; then
  echo "  → Updating auth-sidecar container..."
  az containerapp update --name "$APP" --resource-group "$RG" --subscription "$SUB" \
    --container-name auth-sidecar \
    --image "${REGISTRY}/summarization-auth:${TAG}" 2>&1 | tail -3
fi

# ── Verify ──
echo ""
echo "⏳ Waiting 15s for deployment..."
sleep 15

echo "✅ Deployment status:"
az containerapp revision list --name "$APP" --resource-group "$RG" --subscription "$SUB" \
  --query "[0].{Revision:name, Status:properties.runningState, Health:properties.healthState, Replicas:properties.replicas}" -o table

echo ""
echo "📋 Backend logs (last 5 lines):"
az containerapp logs show --name "$APP" --resource-group "$RG" --subscription "$SUB" \
  --type console --container backend 2>/dev/null | tail -5 || echo "  (waiting for logs...)"

echo ""
echo "Done! 🎉"

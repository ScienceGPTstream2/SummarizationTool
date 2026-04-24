#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# SummarizationTool — Full Infrastructure Deployment
# ═══════════════════════════════════════════════════════════════════════
#
# Copy-paste these commands into Azure Cloud Shell (bash).
# Each section is idempotent — safe to re-run.
#
# Prerequisites:
#   - Azure CLI logged in (Cloud Shell handles this)
#   - ACR: summarizationtoolacr already exists
#   - Container App Environment: summarization-env already exists
#   - VNet: aca-subnet and pg-subnet already configured
#
# Architecture after deployment:
#
#   ┌──────────────────────────────────────────────────────┐
#   │              summarization-env (VNet)                 │
#   │                                                      │
#   │  Frontend ──→ Backend (FastAPI)                       │
#   │  (nginx)      ├── Azure OpenAI (external)            │
#   │               ├── Anthropic (external)               │
#   │               ├── Gemini/Vertex (external)           │
#   │               ├── VLLM-service ──→ GPU T4            │
#   │               │   (Qwen2.5-7B, scale 0→3)           │
#   │               └── Docling-service ──→ GPU T4         │
#   │                   (PDF→MD, scale 0→3)                │
#   │                                                      │
#   │  PostgreSQL ← private endpoint                       │
#   └──────────────────────────────────────────────────────┘
#
# Estimated costs (scale-to-zero):
#   - GPU services idle: $0/hr
#   - GPU services active: ~$0.65/hr per replica per service
#   - Frontend + Backend (Consumption): ~$0.000016/vCPU-s
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Variables ──────────────────────────────────────────────────────────
RG="HcSx-ScienceGPT3-XerographicMockingbird-vNet-rg"
ENV="summarization-env"
ACR="summarizationtoolacr"
LOCATION="canadacentral"
INTERNAL_DNS="agreeableforest-97721d5c.canadacentral.azurecontainerapps.io"

echo "═══════════════════════════════════════════════════════════════"
echo "  SummarizationTool — Full Infrastructure Deployment"
echo "  Resource Group: $RG"
echo "  Environment:    $ENV"
echo "  ACR:            $ACR.azurecr.io"
echo "═══════════════════════════════════════════════════════════════"

# ── Step 1: Add GPU workload profile (shared by docling + vllm) ───────
echo ""
echo "▶ Step 1: Adding GPU workload profile..."
az containerapp env workload-profile add \
  --name "$ENV" \
  --resource-group "$RG" \
  --workload-profile-name gpu-t4 \
  --workload-profile-type Consumption-GPU-NC8as-T4 \
  2>/dev/null || echo "  (already exists, skipping)"

# ── Step 2: Build docling-service image in ACR ────────────────────────
echo ""
echo "▶ Step 2: Building docling-service image in ACR..."
az acr build \
  --registry "$ACR" \
  --image docling-service:latest \
  https://github.com/ScienceGPTstream2/docling-service.git \
  --no-logs

# ── Step 3: Build vllm-service image in ACR ───────────────────────────
echo ""
echo "▶ Step 3: Building vllm-service image in ACR..."
echo "  (This takes ~15-20 min — downloading model weights into image)"
az acr build \
  --registry "$ACR" \
  --image vllm-service:latest \
  https://github.com/ScienceGPTstream2/VLLM-Service.git \
  --no-logs

# ── Step 4: Deploy docling-service Container App ──────────────────────
echo ""
echo "▶ Step 4: Deploying docling-service (GPU, internal, scale-to-zero)..."
az containerapp create \
  --name docling-service \
  --resource-group "$RG" \
  --environment "$ENV" \
  --workload-profile-name gpu-t4 \
  --image "$ACR.azurecr.io/docling-service:latest" \
  --registry-server "$ACR.azurecr.io" \
  --target-port 8000 \
  --ingress internal \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 8 \
  --memory 56Gi \
  --env-vars \
    PORT=8000 \
    DOCLING_OUTPUT_DIR=/data/output \
  2>/dev/null || \
az containerapp update \
  --name docling-service \
  --resource-group "$RG" \
  --image "$ACR.azurecr.io/docling-service:latest"

# ── Step 5: Deploy vllm-service Container App ─────────────────────────
echo ""
echo "▶ Step 5: Deploying vllm-service (GPU, internal, scale-to-zero)..."
az containerapp create \
  --name vllm-service \
  --resource-group "$RG" \
  --environment "$ENV" \
  --workload-profile-name gpu-t4 \
  --image "$ACR.azurecr.io/vllm-service:latest" \
  --registry-server "$ACR.azurecr.io" \
  --target-port 8000 \
  --ingress internal \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 8 \
  --memory 56Gi \
  2>/dev/null || \
az containerapp update \
  --name vllm-service \
  --resource-group "$RG" \
  --image "$ACR.azurecr.io/vllm-service:latest"

# ── Step 6: Wire backend to GPU services ──────────────────────────────
echo ""
echo "▶ Step 6: Setting env vars on backend..."
az containerapp update \
  --name summarization-backend \
  --resource-group "$RG" \
  --set-env-vars \
    "DOCLING_SERVICE_URL=http://docling-service.internal.${INTERNAL_DNS}" \
    "VLLM_BASE_URL=http://vllm-service.internal.${INTERNAL_DNS}/v1" \
    "VLLM_API_KEY=EMPTY"

# ── Step 7: Verify deployments ────────────────────────────────────────
echo ""
echo "▶ Step 7: Verifying deployments..."
echo ""
echo "  Container Apps:"
az containerapp list \
  --resource-group "$RG" \
  --query "[].{Name:name, FQDN:properties.configuration.ingress.fqdn, Status:properties.runningStatus}" \
  --output table

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo ""
echo "  Services deployed:"
echo "    Frontend:  https://summarization-frontend.${INTERNAL_DNS}"
echo "    Backend:   https://summarization-backend.${INTERNAL_DNS}"
echo "    Docling:   http://docling-service.internal.${INTERNAL_DNS}"
echo "    VLLM:      http://vllm-service.internal.${INTERNAL_DNS}/v1"
echo ""
echo "  GPU services scale to zero when idle (\$0/hr)."
echo "  Active cost: ~\$0.65/hr per replica per GPU service."
echo ""
echo "  Test VLLM from backend container:"
echo "    az containerapp exec --name summarization-backend --resource-group $RG"
echo "    curl http://vllm-service.internal.${INTERNAL_DNS}/v1/models"
echo "═══════════════════════════════════════════════════════════════"

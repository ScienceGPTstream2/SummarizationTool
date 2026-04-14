# ═══════════════════════════════════════════════════════════════════════
# SummarizationTool — Full Infrastructure Deployment (PowerShell)
# ═══════════════════════════════════════════════════════════════════════
#
# Run from Windows PowerShell with Azure CLI installed:
#   .\deploy-all.ps1
#
# Prerequisites:
#   - Azure CLI installed (winget install Microsoft.AzureCLI)
#   - Logged in: az login
#   - ACR + Container App Environment already exist
#
# ═══════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

# ── Variables ──────────────────────────────────────────────────────────
$RG       = "HcSx-ScienceGPT3-XerographicMockingbird-vNet-rg"
$ENV_NAME = "summarization-env"
$ACR      = "summarizationtoolacr"
$LOCATION = "canadacentral"
$DNS      = "agreeableforest-97721d5c.canadacentral.azurecontainerapps.io"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  SummarizationTool — Full Infrastructure Deployment"          -ForegroundColor Cyan
Write-Host "  Resource Group: $RG"                                         -ForegroundColor Cyan
Write-Host "  Environment:    $ENV_NAME"                                   -ForegroundColor Cyan
Write-Host "  ACR:            $ACR.azurecr.io"                             -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Add GPU workload profile ──────────────────────────────────
Write-Host "▶ Step 1: Adding GPU workload profile..." -ForegroundColor Yellow
try {
    az containerapp env workload-profile add `
        --name $ENV_NAME `
        --resource-group $RG `
        --workload-profile-name gpu-t4 `
        --workload-profile-type Consumption-GPU-NC8as-T4
    Write-Host "  ✅ GPU profile added" -ForegroundColor Green
} catch {
    Write-Host "  (already exists, skipping)" -ForegroundColor DarkGray
}

# ── Step 2: Build docling-service image in ACR ────────────────────────
Write-Host ""
Write-Host "▶ Step 2: Building docling-service image in ACR..." -ForegroundColor Yellow
az acr build `
    --registry $ACR `
    --image docling-service:latest `
    https://github.com/ScienceGPTstream2/docling-service.git
Write-Host "  ✅ docling-service built" -ForegroundColor Green

# ── Step 3: Build vllm-service image in ACR ───────────────────────────
Write-Host ""
Write-Host "▶ Step 3: Building vllm-service image in ACR..." -ForegroundColor Yellow
Write-Host "  (This takes ~15-20 min — downloading model weights into image)" -ForegroundColor DarkGray
az acr build `
    --registry $ACR `
    --image vllm-service:latest `
    https://github.com/ScienceGPTstream2/VLLM-Service.git
Write-Host "  ✅ vllm-service built" -ForegroundColor Green

# ── Step 4: Deploy docling-service Container App ──────────────────────
Write-Host ""
Write-Host "▶ Step 4: Deploying docling-service (GPU, internal, scale-to-zero)..." -ForegroundColor Yellow
$doclingExists = az containerapp show --name docling-service --resource-group $RG 2>$null
if ($doclingExists) {
    az containerapp update `
        --name docling-service `
        --resource-group $RG `
        --image "$ACR.azurecr.io/docling-service:latest"
} else {
    az containerapp create `
        --name docling-service `
        --resource-group $RG `
        --environment $ENV_NAME `
        --workload-profile-name gpu-t4 `
        --image "$ACR.azurecr.io/docling-service:latest" `
        --registry-server "$ACR.azurecr.io" `
        --target-port 8000 `
        --ingress internal `
        --min-replicas 0 `
        --max-replicas 3 `
        --cpu 8 `
        --memory 56Gi `
        --env-vars PORT=8000 DOCLING_OUTPUT_DIR=/data/output
}
Write-Host "  ✅ docling-service deployed" -ForegroundColor Green

# ── Step 5: Deploy vllm-service Container App ─────────────────────────
Write-Host ""
Write-Host "▶ Step 5: Deploying vllm-service (GPU, internal, scale-to-zero)..." -ForegroundColor Yellow
$vllmExists = az containerapp show --name vllm-service --resource-group $RG 2>$null
if ($vllmExists) {
    az containerapp update `
        --name vllm-service `
        --resource-group $RG `
        --image "$ACR.azurecr.io/vllm-service:latest"
} else {
    az containerapp create `
        --name vllm-service `
        --resource-group $RG `
        --environment $ENV_NAME `
        --workload-profile-name gpu-t4 `
        --image "$ACR.azurecr.io/vllm-service:latest" `
        --registry-server "$ACR.azurecr.io" `
        --target-port 8000 `
        --ingress internal `
        --min-replicas 0 `
        --max-replicas 3 `
        --cpu 8 `
        --memory 56Gi
}
Write-Host "  ✅ vllm-service deployed" -ForegroundColor Green

# ── Step 6: Wire backend to GPU services ──────────────────────────────
Write-Host ""
Write-Host "▶ Step 6: Setting env vars on backend..." -ForegroundColor Yellow
az containerapp update `
    --name summarization-backend `
    --resource-group $RG `
    --set-env-vars `
        "DOCLING_SERVICE_URL=http://docling-service.internal.$DNS" `
        "VLLM_BASE_URL=http://vllm-service.internal.$DNS/v1" `
        "VLLM_API_KEY=EMPTY"
Write-Host "  ✅ Backend env vars set" -ForegroundColor Green

# ── Step 7: Verify deployments ────────────────────────────────────────
Write-Host ""
Write-Host "▶ Step 7: Verifying deployments..." -ForegroundColor Yellow
az containerapp list `
    --resource-group $RG `
    --query "[].{Name:name, FQDN:properties.configuration.ingress.fqdn}" `
    --output table

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ Deployment complete!"                                      -ForegroundColor Green
Write-Host ""                                                               -ForegroundColor Green
Write-Host "  Services deployed:"                                           -ForegroundColor Green
Write-Host "    Frontend:  https://summarization-frontend.$DNS"             -ForegroundColor White
Write-Host "    Backend:   https://summarization-backend.$DNS"              -ForegroundColor White
Write-Host "    Docling:   http://docling-service.internal.$DNS"            -ForegroundColor White
Write-Host "    VLLM:      http://vllm-service.internal.$DNS/v1"           -ForegroundColor White
Write-Host ""
Write-Host "  GPU services scale to zero when idle (`$0/hr)."              -ForegroundColor DarkGray
Write-Host "  Active cost: ~`$0.65/hr per replica per GPU service."        -ForegroundColor DarkGray
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green

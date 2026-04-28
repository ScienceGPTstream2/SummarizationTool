# Observability VM — Setup

LGTM stack (Loki + Grafana + Tempo + Prometheus) for the SummarizationTool.

## First-time setup

```bash
# 1. Copy and configure env
cp .env.example .env
# Edit .env: set GRAFANA_ADMIN_PASSWORD and BACKEND_FQDN

# 2. Start the stack
docker compose up -d

# 3. Grafana is at http://<VM_IP>:3000
#    Login: admin / <your password>
```

## Environment variables

Create `.env` next to `docker-compose.yml`:

```env
GRAFANA_ADMIN_PASSWORD=changeme
GRAFANA_ROOT_URL=http://<vm-public-ip>:3000
BACKEND_FQDN=summarization-backend.<env>.canadacentral.azurecontainerapps.io
```

## Backend env vars to set

On the summarization-backend Container App:

```bash
# Loki log shipping
az containerapp update --name summarization-backend \
  --resource-group <rg> --container-name backend \
  --set-env-vars "LOKI_URL=http://<vm-ip>:3100"

# OTel trace export
az containerapp update --name summarization-backend \
  --resource-group <rg> --container-name backend \
  --set-env-vars "OTLP_ENDPOINT=http://<vm-ip>:4318"
```

## NSG rules required

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 3000 | TCP | Your IP / VPN | Grafana UI |
| 3100 | TCP | Container Apps subnet | Loki (log push) |
| 4317 | TCP | Container Apps subnet | Tempo OTLP gRPC |
| 4318 | TCP | Container Apps subnet | Tempo OTLP HTTP |
| 9090 | TCP | localhost only | Prometheus (internal) |

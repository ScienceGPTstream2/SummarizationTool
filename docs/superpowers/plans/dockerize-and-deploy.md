# Dockerize & Deploy to Azure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dockerize the backend (FastAPI) and auth service (Express), deploy them to Azure Container Apps (auth as a sidecar), and deploy the frontend as a static build to Azure Static Web Apps.

**Architecture:**
- **Backend + Auth Sidecar** — One Azure Container App with two containers: FastAPI as the main container, Express/Better Auth as a sidecar. They share `localhost`, so no external networking needed between them.
- **Frontend** — Vite builds static files (`dist/`), deployed to Azure Static Web Apps with a CDN. A `staticwebapp.config.json` handles routing (`/api/*` proxied to backend Container App, SPA fallback for everything else).
- **Database** — Azure Database for PostgreSQL (Flexible Server), managed externally. No longer self-hosted Supabase.

**Tech Stack:** Docker, Azure Container Apps, Azure Static Web Apps, Azure Container Registry (ACR), Azure Database for PostgreSQL, GitHub Actions CI/CD

---

## Deployment Architecture Diagram

```
                        ┌──────────────────────────────────────┐
                        │         Azure Static Web Apps        │
    Browser ──────────▶│   Frontend (Vite static build)       │
                        │   CDN + SPA fallback routing         │
                        └──────────────┬───────────────────────┘
                                       │ /api/* proxy
                                       ▼
                        ┌──────────────────────────────────────┐
                        │      Azure Container App             │
                        │  ┌────────────────┐ ┌──────────────┐ │
                        │  │ Main Container │ │ Sidecar      │ │
                        │  │ FastAPI        │ │ Auth Service  │ │
                        │  │ (Gunicorn +    │ │ (Node.js +   │ │
                        │  │  Uvicorn)      │ │  Express)    │ │
                        │  │ Port 8001      │ │ Port 3001    │ │
                        │  └───────┬────────┘ └──────┬───────┘ │
                        │          │  localhost:3001  │         │
                        │          └─────────────────▶│         │
                        └──────────────┬───────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────────┐
                        │   Azure Database for PostgreSQL      │
                        │   (Flexible Server)                  │
                        └──────────────────────────────────────┘
```

---

## Pre-requisites

- Azure CLI (`az`) installed and logged in
- An Azure Resource Group created
- Azure Container Registry (ACR) created
- Azure Database for PostgreSQL Flexible Server provisioned
- GitHub repo secrets configured for CI/CD (ACR credentials, DB connection string, etc.)

---

## Task 1: Remove Legacy supabase-docker Directory

**Files:**
- Delete: `supabase-docker/` (39 tracked files)
- Modify: `.gitignore` (remove supabase-docker references)

- [ ] **Step 1: Remove supabase-docker directory**

```bash
rm -rf supabase-docker/
```

- [ ] **Step 2: Clean up .gitignore references**

Remove these lines from `.gitignore`:
```
# But keep supabase-docker logs config
!supabase-docker/volumes/logs/
!supabase-docker/volumes/logs/vector.yml
```

- [ ] **Step 3: Remove old deploy.sh**

The existing `deploy.sh` references supabase-docker and the old systemd-based deployment. Remove it — we'll replace it with container-based deployment.

```bash
rm deploy.sh
```

- [ ] **Step 4: Commit**

```bash
git add -A supabase-docker/ .gitignore deploy.sh
git commit -m "chore: remove legacy supabase-docker directory and old deploy script"
```

---

## Task 2: Create Backend Dockerfile

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`

- [ ] **Step 1: Create backend/.dockerignore**

```dockerignore
__pycache__/
*.pyc
*.pyo
.git/
.env
core/secrets.toml
venv/
tests/
uploads/
output/
files/
*.egg-info/
```

- [ ] **Step 2: Create backend/Dockerfile**

Multi-stage build: install dependencies in a builder stage, copy into a slim runtime image. Use Gunicorn with Uvicorn workers for production.

```dockerfile
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies needed for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt
RUN pip install --no-cache-dir --prefix=/install gunicorn

# --- Runtime stage ---
FROM python:3.11-slim

WORKDIR /app

# Install only runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Create directories for uploads and output
RUN mkdir -p uploads output files

# Expose the backend port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8001/api/server/health || exit 1

# Run with Gunicorn + Uvicorn workers
# Workers = 2 * CPU + 1 is a good starting point; override via WORKERS env var
CMD ["sh", "-c", "gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers ${WORKERS:-4} \
    --bind 0.0.0.0:8001 \
    --timeout 300 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -"]
```

- [ ] **Step 3: Build and test locally**

```bash
cd backend
docker build -t summarization-backend:dev .
docker run --rm -p 8001:8001 --env-file ../.env summarization-backend:dev
# In another terminal:
curl http://localhost:8001/api/server/health
```

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "feat: add backend Dockerfile with Gunicorn + Uvicorn workers"
```

---

## Task 3: Create Auth Service Dockerfile

**Files:**
- Create: `auth-service/Dockerfile`
- Create: `auth-service/.dockerignore`

- [ ] **Step 1: Create auth-service/.dockerignore**

```dockerignore
node_modules/
dist/
.git/
.env
*.log
```

- [ ] **Step 2: Create auth-service/Dockerfile**

Multi-stage build: install deps + compile TypeScript, then copy into a slim Node runtime.

```dockerfile
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Runtime stage ---
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Build and test locally**

```bash
cd auth-service
docker build -t summarization-auth:dev .
docker run --rm -p 3001:3001 --env-file ../.env summarization-auth:dev
# In another terminal:
curl http://localhost:3001/health
```

- [ ] **Step 4: Commit**

```bash
git add auth-service/Dockerfile auth-service/.dockerignore
git commit -m "feat: add auth service Dockerfile"
```

---

## Task 4: Create docker-compose.yml for Local Development

**Files:**
- Create: `docker-compose.yml` (project root)
- Create: `.env.example`

- [ ] **Step 1: Create .env.example**

Template showing all required environment variables (no real values):

```env
# Database
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/summarization

# Auth Service
BETTER_AUTH_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Backend
AUTH_SIDECAR_URL=http://auth:3001
WORKERS=4

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=

# Azure Document Intelligence
AZURE_DOC_INTELLIGENCE_ENDPOINT=
AZURE_DOC_INTELLIGENCE_KEY=

# Vertex AI / Gemini
GEMINI_PROJECT=
GEMINI_LOCATION=

# Anthropic via Vertex
ANTHROPIC_PROJECT_ID=
ANTHROPIC_LOCATION=
```

- [ ] **Step 2: Create docker-compose.yml**

For local dev/testing. Runs backend, auth, and a local PostgreSQL.

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-summarization}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-localdev}
      POSTGRES_DB: ${POSTGRES_DB:-summarization}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-summarization}"]
      interval: 5s
      timeout: 3s
      retries: 5

  auth:
    build: ./auth-service
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-summarization}:${POSTGRES_PASSWORD:-localdev}@db:5432/${POSTGRES_DB:-summarization}
      BETTER_AUTH_URL: http://auth:3001
      FRONTEND_URL: http://localhost:3000
      PORT: "3001"
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET:-}
    ports:
      - "3001:3001"
    depends_on:
      db:
        condition: service_healthy

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-summarization}:${POSTGRES_PASSWORD:-localdev}@db:5432/${POSTGRES_DB:-summarization}
      AUTH_SIDECAR_URL: http://auth:3001
      WORKERS: "2"
    env_file:
      - .env
    ports:
      - "8001:8001"
    volumes:
      - uploads:/app/uploads
    depends_on:
      db:
        condition: service_healthy
      auth:
        condition: service_healthy

volumes:
  pgdata:
  uploads:
```

- [ ] **Step 3: Test docker-compose locally**

```bash
docker compose up --build
# Verify:
curl http://localhost:8001/api/server/health
curl http://localhost:3001/health
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: add docker-compose for local development"
```

---

## Task 5: Configure Frontend for Azure Static Web Apps

**Files:**
- Create: `staticwebapp.config.json` (project root)

- [ ] **Step 1: Create staticwebapp.config.json**

This tells Azure Static Web Apps how to route requests. API calls proxy to the backend Container App; everything else falls back to `index.html` (SPA routing).

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/api/*"]
  },
  "routes": [
    {
      "route": "/api/auth/*",
      "allowedRoles": ["anonymous"]
    },
    {
      "route": "/api/*",
      "allowedRoles": ["anonymous"]
    }
  ],
  "forwardingGateway": {
    "requiredHeaders": {},
    "allowedForwardedHosts": []
  }
}
```

> **Note:** The actual API proxy to the Container App will be configured in the Azure Static Web Apps resource via the `BACKEND_URL` linked backend setting or via Azure Front Door. The exact configuration depends on your Azure setup.

- [ ] **Step 2: Verify frontend builds cleanly**

```bash
npm run build
ls -la dist/
```

- [ ] **Step 3: Commit**

```bash
git add staticwebapp.config.json
git commit -m "feat: add Azure Static Web Apps routing configuration"
```

---

## Task 6: Create Azure Container App Configuration

**Files:**
- Create: `infra/container-app.yaml`

- [ ] **Step 1: Create infra directory and Container App manifest**

This is the Azure Container App YAML definition with the backend as the main container and auth as a sidecar. This can be used with `az containerapp create --yaml`.

```yaml
# infra/container-app.yaml
# Deploy with: az containerapp create --name summarization-app \
#   --resource-group <RG> --environment <ENV> --yaml infra/container-app.yaml

properties:
  managedEnvironmentId: /subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.App/managedEnvironments/<ENV_NAME>
  configuration:
    ingress:
      external: true
      targetPort: 8001
      transport: auto
      allowInsecure: false
    secrets:
      - name: database-url
        value: <REPLACE_WITH_DATABASE_URL>
      - name: github-client-id
        value: <REPLACE_WITH_GITHUB_CLIENT_ID>
      - name: github-client-secret
        value: <REPLACE_WITH_GITHUB_CLIENT_SECRET>
    registries:
      - server: <ACR_NAME>.azurecr.io
        username: <ACR_USERNAME>
        passwordSecretRef: acr-password
  template:
    containers:
      # Main container: FastAPI backend
      - name: backend
        image: <ACR_NAME>.azurecr.io/summarization-backend:latest
        resources:
          cpu: 1.0
          memory: 2Gi
        env:
          - name: DATABASE_URL
            secretRef: database-url
          - name: AUTH_SIDECAR_URL
            value: http://localhost:3001
          - name: WORKERS
            value: "4"
        probes:
          - type: liveness
            httpGet:
              path: /api/server/health
              port: 8001
            initialDelaySeconds: 10
            periodSeconds: 30
          - type: readiness
            httpGet:
              path: /api/server/health
              port: 8001
            initialDelaySeconds: 5
            periodSeconds: 10

      # Sidecar container: Better Auth service
      - name: auth-sidecar
        image: <ACR_NAME>.azurecr.io/summarization-auth:latest
        resources:
          cpu: 0.25
          memory: 0.5Gi
        env:
          - name: DATABASE_URL
            secretRef: database-url
          - name: BETTER_AUTH_URL
            value: http://localhost:3001
          - name: FRONTEND_URL
            value: https://<YOUR_STATIC_WEB_APP_URL>
          - name: GITHUB_CLIENT_ID
            secretRef: github-client-id
          - name: GITHUB_CLIENT_SECRET
            secretRef: github-client-secret
          - name: PORT
            value: "3001"
        probes:
          - type: liveness
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 5
            periodSeconds: 30

    scale:
      minReplicas: 1
      maxReplicas: 5
      rules:
        - name: http-scaling
          http:
            metadata:
              concurrentRequests: "50"
```

- [ ] **Step 2: Commit**

```bash
mkdir -p infra
git add infra/container-app.yaml
git commit -m "feat: add Azure Container App manifest with auth sidecar"
```

---

## Task 7: Create CI/CD Pipeline (GitHub Actions)

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create GitHub Actions workflow**

Builds both Docker images, pushes to ACR, deploys Container App, and deploys frontend to Azure Static Web Apps.

```yaml
name: Build & Deploy

on:
  push:
    branches: [main]

env:
  ACR_NAME: <YOUR_ACR_NAME>
  RESOURCE_GROUP: <YOUR_RG>
  CONTAINER_APP_NAME: summarization-app
  STATIC_WEB_APP_NAME: summarization-frontend

jobs:
  # -- Build & push backend image --
  build-backend:
    runs-on: ubuntu-latest
    if: |
      contains(github.event.head_commit.modified, 'backend/') ||
      github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: az acr login --name ${{ env.ACR_NAME }}
      - run: |
          docker build -t ${{ env.ACR_NAME }}.azurecr.io/summarization-backend:${{ github.sha }} \
                        -t ${{ env.ACR_NAME }}.azurecr.io/summarization-backend:latest \
                        ./backend
          docker push ${{ env.ACR_NAME }}.azurecr.io/summarization-backend --all-tags

  # -- Build & push auth image --
  build-auth:
    runs-on: ubuntu-latest
    if: |
      contains(github.event.head_commit.modified, 'auth-service/') ||
      github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: az acr login --name ${{ env.ACR_NAME }}
      - run: |
          docker build -t ${{ env.ACR_NAME }}.azurecr.io/summarization-auth:${{ github.sha }} \
                        -t ${{ env.ACR_NAME }}.azurecr.io/summarization-auth:latest \
                        ./auth-service
          docker push ${{ env.ACR_NAME }}.azurecr.io/summarization-auth --all-tags

  # -- Deploy Container App --
  deploy-backend:
    needs: [build-backend, build-auth]
    if: always() && (needs.build-backend.result == 'success' || needs.build-auth.result == 'success')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: |
          az containerapp update \
            --name ${{ env.CONTAINER_APP_NAME }} \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --set-env-vars "IMAGE_TAG=${{ github.sha }}"

  # -- Deploy Frontend --
  deploy-frontend:
    runs-on: ubuntu-latest
    if: |
      contains(github.event.head_commit.modified, 'components/') ||
      contains(github.event.head_commit.modified, 'contexts/') ||
      contains(github.event.head_commit.modified, 'lib/') ||
      contains(github.event.head_commit.modified, 'styles/') ||
      github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.SWA_DEPLOY_TOKEN }}
          action: upload
          app_location: /
          output_location: dist
```

- [ ] **Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/deploy.yml
git commit -m "feat: add GitHub Actions CI/CD pipeline for Azure deployment"
```

---

## Task 8: Update Backend Config for Container Environment

**Files:**
- Modify: `backend/core/config.py` — support env vars natively (containers inject env vars, not secrets.toml)
- Modify: `backend/core/middleware.py` — restrict CORS origins in production

- [ ] **Step 1: Update config.py to prefer environment variables**

The container will inject secrets via environment variables. The `secrets.toml` path should only be a fallback for local development. The current `load_config()` already sets `os.environ.setdefault()`, which means env vars already win — this is correct. No code change needed, just verify this behavior.

- [ ] **Step 2: Update middleware.py for production CORS**

Replace the wildcard CORS origin with an env-var-driven allow list:

```python
import os

def setup_cors(app: FastAPI):
    allowed = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
    origins = [o.strip() for o in allowed.split(",")] if allowed != "*" else ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/core/middleware.py
git commit -m "feat: make CORS origins configurable via CORS_ALLOWED_ORIGINS env var"
```

---

## Summary — Execution Order

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Remove supabase-docker + old deploy.sh | — |
| 2 | Backend Dockerfile | — |
| 3 | Auth Service Dockerfile | — |
| 4 | docker-compose.yml for local dev | Tasks 2, 3 |
| 5 | Frontend Static Web Apps config | — |
| 6 | Azure Container App manifest (sidecar) | Tasks 2, 3 |
| 7 | GitHub Actions CI/CD | Tasks 2, 3, 5, 6 |
| 8 | Backend config updates for containers | — |

**Independent tasks (can run in parallel):** 1, 2, 3, 5, 8
**Sequential tasks:** 4 (after 2+3), 6 (after 2+3), 7 (after all)

#!/bin/bash
# ============================================================
# Setup systemd services for SummarizationTool
# Run once on initial deploy, idempotent on subsequent runs.
#
# Services created:
#   summarization-auth     — Better Auth sidecar (port 3001)
#   summarization-backend  — FastAPI/Uvicorn    (port 8001)
#   summarization-frontend — Vite dev server    (port 3000)
#
# Usage:
#   sudo bash scripts/setup-systemd.sh
# ============================================================
set -e

APP_DIR="/home/azureuser/SummarizationTool"
VENV_DIR="${APP_DIR}/venv"
APP_USER="azureuser"

echo "==== Setting up systemd services ===="

# ---------- 1. Auth service (Better Auth sidecar, port 3001) ----------
cat > /etc/systemd/system/summarization-auth.service <<EOF
[Unit]
Description=SummarizationTool Auth (Better Auth sidecar)
After=postgresql.service network.target
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/auth-service
EnvironmentFile=${APP_DIR}/auth-service/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
echo "  ✅ summarization-auth.service created"

# ---------- 2. Backend service (FastAPI/Uvicorn, port 8001) ----------
cat > /etc/systemd/system/summarization-backend.service <<EOF
[Unit]
Description=SummarizationTool Backend (FastAPI)
After=postgresql.service summarization-auth.service network.target
Wants=postgresql.service summarization-auth.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${APP_DIR}/backend/.env
ExecStart=${VENV_DIR}/bin/uvicorn main:app --host 0.0.0.0 --port 8001
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
echo "  ✅ summarization-backend.service created"

# ---------- 3. Frontend service (Vite dev server, port 3000) ----------
cat > /etc/systemd/system/summarization-frontend.service <<EOF
[Unit]
Description=SummarizationTool Frontend (Vite)
After=summarization-backend.service summarization-auth.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/npx vite --host 0.0.0.0 --port 3000
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
echo "  ✅ summarization-frontend.service created"

# ---------- 4. Reload systemd & enable services ----------
systemctl daemon-reload
systemctl enable summarization-auth summarization-backend summarization-frontend

echo ""
echo "==== Systemd services ready ===="
echo "  Start all:    sudo systemctl start summarization-auth summarization-backend summarization-frontend"
echo "  View logs:    journalctl -u summarization-backend -f"
echo "  Check status: sudo systemctl status summarization-auth summarization-backend summarization-frontend"

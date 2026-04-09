#!/bin/bash
set -e

echo "==== DEPLOY START ===="

cd ~/SummarizationTool

echo "Pulling latest code..."
git pull

echo "Checking Postgres..."
pg_isready -h localhost || sudo systemctl start postgresql
pg_isready -h localhost

echo "Ensuring systemd services exist..."
if [ ! -f /etc/systemd/system/summarization-auth.service ]; then
  echo "  First-time setup: creating systemd service files..."
  sudo bash scripts/setup-systemd.sh
fi

echo "Installing & building auth service..."
cd auth-service
npm ci
npx tsc
cd ..

echo "Installing backend deps..."
cd backend
source ../venv/bin/activate
pip install -r requirements.txt

echo "Running DB migrations..."
alembic upgrade head
cd ..

echo "Installing frontend deps..."
npm ci

echo "Building frontend..."
npm run build

echo "Restarting services..."
sudo systemctl restart summarization-auth
sudo systemctl restart summarization-backend
sudo systemctl restart summarization-frontend

echo "Health check..."
sleep 3
sudo systemctl is-active summarization-auth
sudo systemctl is-active summarization-backend
sudo systemctl is-active summarization-frontend
curl -sf --max-time 10 http://localhost:8001/docs > /dev/null && echo "Backend API: OK"
curl -sf --max-time 10 http://localhost:3001/health > /dev/null && echo "Auth service: OK"

echo "==== DEPLOY DONE ===="

#!/bin/bash
set -e

echo "==== DEPLOY START ===="

cd ~/SummarizationTool

echo "Pulling latest code..."
git pull

echo "Installing backend deps..."
cd backend
source ../venv/bin/activate
pip install -r requirements.txt

echo "Installing frontend deps..."
cd ../frontend
npm install

echo "Restarting backend..."
sudo systemctl restart summarization-backend

echo "Restarting frontend..."
sudo systemctl restart summarization-frontend

echo "Restarting Docker..."
cd ~/SummarizationTool/supabase-docker
sudo docker compose down
sudo docker compose up -d

echo "==== DEPLOY DONE ===="

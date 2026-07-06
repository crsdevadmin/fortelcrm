#!/bin/bash
# Fortel CRM - deploy backend to EC2.
# Run from Git Bash on your local machine:
#   chmod +x deploy/2_deploy_backend.sh
#   ./deploy/2_deploy_backend.sh

set -e

EC2_HOST="ubuntu@13.206.119.130"
KEY_FILE="$HOME/.ssh/fortel-key.pem"
APP_DIR="/opt/fortel-crm"

echo "=== Syncing code to EC2 ==="
rsync -avz --exclude 'node_modules' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude '.git' --exclude 'frontend/build' --exclude 'venv' \
  -e "ssh -i $KEY_FILE" \
  . "$EC2_HOST:$APP_DIR/"

echo "=== Installing Python dependencies ==="
ssh -i "$KEY_FILE" "$EC2_HOST" "
  source $APP_DIR/venv/bin/activate
  pip install --upgrade pip
  pip install -r $APP_DIR/backend/requirements.txt
  pip install openpyxl gunicorn
"

echo "=== Restarting service ==="
ssh -i "$KEY_FILE" "$EC2_HOST" "
  sudo systemctl daemon-reload
  sudo systemctl enable fortel
  sudo systemctl restart fortel
  sudo systemctl status fortel --no-pager
"

echo "=== Backend deploy complete ==="

#!/bin/bash
# ============================================================
# Fortel CRM — Deploy backend to EC2
# Run from your LOCAL machine (Windows users: use Git Bash):
#   chmod +x deploy/2_deploy_backend.sh
#   ./deploy/2_deploy_backend.sh
#
# Prerequisites: fill in EC2_HOST below
# ============================================================

EC2_HOST="ubuntu@YOUR_EC2_PUBLIC_IP"   # ← change this
KEY_FILE="~/.ssh/fortel-key.pem"        # ← path to your .pem file
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
  pip install -r $APP_DIR/requirements.txt
  pip install openpyxl gunicorn
"

echo "=== Restarting service ==="
ssh -i "$KEY_FILE" "$EC2_HOST" "
  sudo systemctl daemon-reload
  sudo systemctl enable fortel
  sudo systemctl restart fortel
  sudo systemctl status fortel --no-pager
"

echo "=== Deploy complete ==="

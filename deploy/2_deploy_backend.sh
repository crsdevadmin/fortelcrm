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
  if ! command -v tesseract >/dev/null; then
    sudo apt-get update
    sudo apt-get install -y tesseract-ocr
  fi
  source $APP_DIR/venv/bin/activate
  pip install --upgrade pip
  pip install -r $APP_DIR/backend/requirements.txt
  pip install openpyxl gunicorn
  cd $APP_DIR
  python -m backend.scripts.security_migration
"

echo "=== Restarting service ==="
ssh -i "$KEY_FILE" "$EC2_HOST" "
  sudo cp $APP_DIR/deploy/fortel-weekly-sms@.service /etc/systemd/system/fortel-weekly-sms@.service
  sudo cp $APP_DIR/deploy/fortel-weekly-sms-rep.timer /etc/systemd/system/fortel-weekly-sms-rep.timer
  sudo systemctl daemon-reload
  sudo systemctl disable --now fortel-weekly-sms-manager.timer 2>/dev/null || true
  sudo systemctl enable --now fortel-weekly-sms-rep.timer
  sudo systemctl restart fortel-weekly-sms-rep.timer
  sudo systemctl enable fortel
  sudo systemctl restart fortel
  sudo systemctl status fortel --no-pager
"

echo "=== Backend deploy complete ==="

#!/bin/bash
# Fortel CRM - build React frontend and deploy to the EC2 Nginx web root.

set -e

EC2_HOST="ubuntu@13.206.119.130"
KEY_FILE="$HOME/.ssh/fortel-key.pem"
WEB_ROOT="/var/www/fortel-crm"
STAGE_DIR="/tmp/fortel-frontend-deploy"

echo "=== Building React frontend ==="
cd frontend
npm ci
npm run build
cd ..

echo "=== Uploading frontend to EC2 ==="
ssh -i "$KEY_FILE" "$EC2_HOST" "rm -rf $STAGE_DIR && mkdir -p $STAGE_DIR"
rsync -avz --delete -e "ssh -i $KEY_FILE" frontend/build/ "$EC2_HOST:$STAGE_DIR/"
scp -i "$KEY_FILE" deploy/nginx.conf "$EC2_HOST:/tmp/fortel-nginx.conf"

echo "=== Publishing frontend and reloading Nginx ==="
ssh -i "$KEY_FILE" "$EC2_HOST" "
  sudo mkdir -p $WEB_ROOT
  sudo rsync -a --delete $STAGE_DIR/ $WEB_ROOT/
  sudo chown -R www-data:www-data $WEB_ROOT
  sudo cp /tmp/fortel-nginx.conf /etc/nginx/sites-available/fortel
  sudo nginx -t
  sudo systemctl reload nginx
  rm -rf $STAGE_DIR
  rm -f /tmp/fortel-nginx.conf
"

echo "=== Frontend deployed to $WEB_ROOT ==="

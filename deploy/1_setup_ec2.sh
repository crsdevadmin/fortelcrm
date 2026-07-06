#!/bin/bash
# ============================================================
# Fortel CRM — EC2 Initial Setup
# Run this ONCE on a fresh Ubuntu 22.04 EC2 instance:
#   chmod +x 1_setup_ec2.sh && sudo ./1_setup_ec2.sh
# ============================================================
set -e

echo "=== Updating system ==="
apt-get update -y && apt-get upgrade -y

echo "=== Installing Python 3.11, nginx, git ==="
apt-get install -y python3.11 python3.11-venv python3-pip nginx git certbot python3-certbot-nginx curl unzip

echo "=== Creating app user ==="
id -u fortel &>/dev/null || useradd -m -s /bin/bash fortel

echo "=== Creating app directory ==="
mkdir -p /opt/fortel-crm
chown fortel:fortel /opt/fortel-crm

echo "=== Setting up Python venv ==="
sudo -u fortel python3.11 -m venv /opt/fortel-crm/venv

echo "=== Done. Next: run 2_deploy_backend.sh from your local machine ==="

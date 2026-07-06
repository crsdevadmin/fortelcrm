# Fortel CRM — AWS Deployment Guide
**Stack**: EC2 (FastAPI) + RDS PostgreSQL + S3 + CloudFront

---

## Step 1 — Create EC2 Key Pair

1. Open AWS Console → EC2 → Key Pairs → **Create key pair**
2. Name: `fortel-key` | Format: `.pem`
3. Download the `.pem` file → move it to `C:\Users\mjaff\.ssh\fortel-key.pem`
4. On Git Bash: `chmod 400 ~/.ssh/fortel-key.pem`

---

## Step 2 — Create Security Groups

**Backend SG** (`fortel-backend-sg`):
| Type  | Port | Source |
|-------|------|--------|
| SSH   | 22   | Your IP only |
| HTTP  | 80   | 0.0.0.0/0 |
| HTTPS | 443  | 0.0.0.0/0 |

**Database SG** (`fortel-db-sg`):
| Type            | Port | Source |
|-----------------|------|--------|
| PostgreSQL      | 5432 | fortel-backend-sg |

---

## Step 3 — Create RDS PostgreSQL

1. AWS Console → RDS → **Create database**
2. Engine: **PostgreSQL 15**
3. Template: **Free tier** (or Production for HA)
4. DB instance ID: `fortel-crm-db`
5. Master username: `fortel_admin`
6. Master password: *(choose something strong, save it)*
7. Instance: `db.t3.micro`
8. Storage: 20 GB gp3
9. VPC security group: `fortel-db-sg`
10. Initial database name: `fortel_crm`
11. **Disable** public access (EC2 will connect privately)
12. Click **Create database** → wait ~5 min for endpoint

---

## Step 4 — Launch EC2 Instance

1. AWS Console → EC2 → **Launch instance**
2. Name: `fortel-crm-backend`
3. AMI: **Ubuntu Server 22.04 LTS**
4. Instance type: **t3.small** (~$15/month)
5. Key pair: `fortel-key`
6. Security group: `fortel-backend-sg`
7. Storage: 20 GB gp3
8. Launch

---

## Step 5 — Setup EC2

```bash
# SSH into EC2
ssh -i ~/.ssh/fortel-key.pem ubuntu@YOUR_EC2_IP

# Upload and run setup script
```

From your local machine (Git Bash):
```bash
scp -i ~/.ssh/fortel-key.pem deploy/1_setup_ec2.sh ubuntu@YOUR_EC2_IP:~
ssh -i ~/.ssh/fortel-key.pem ubuntu@YOUR_EC2_IP "sudo bash ~/1_setup_ec2.sh"
```

---

## Step 6 — Configure Backend .env on EC2

SSH into EC2:
```bash
ssh -i ~/.ssh/fortel-key.pem ubuntu@YOUR_EC2_IP

# Create log directory
sudo mkdir -p /var/log/fortel
sudo chown fortel:fortel /var/log/fortel

# Create .env file
sudo nano /opt/fortel-crm/.env
```

Paste contents from `deploy/ec2_env_template.env` with your real values filled in.

---

## Step 7 — Deploy Backend Code

Edit `deploy/2_deploy_backend.sh` — set `EC2_HOST` and `KEY_FILE`, then:

```bash
# From the fortel-crm folder on your local machine (Git Bash)
chmod +x deploy/2_deploy_backend.sh
./deploy/2_deploy_backend.sh
```

Then SSH in and set up nginx + systemd:
```bash
ssh -i ~/.ssh/fortel-key.pem ubuntu@YOUR_EC2_IP

# Install systemd service
sudo cp /opt/fortel-crm/deploy/fortel.service /etc/systemd/system/fortel.service
sudo systemctl daemon-reload
sudo systemctl enable fortel
sudo systemctl start fortel
sudo systemctl status fortel    # should show "active (running)"

# Install nginx config
sudo cp /opt/fortel-crm/deploy/nginx.conf /etc/nginx/sites-available/fortel
sudo ln -s /etc/nginx/sites-available/fortel /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Test: `curl http://YOUR_EC2_IP/` — should return `{"status":"ok",...}`

---

## Step 8 — Migrate Database

```bash
# From your local machine (Git Bash)
# Edit deploy/4_migrate_db.sh — set RDS_HOST, RDS_USER, LOCAL_DB
chmod +x deploy/4_migrate_db.sh
./deploy/4_migrate_db.sh
```

---

## Step 9 — Create S3 Bucket for Frontend

1. AWS Console → S3 → **Create bucket**
2. Name: `fortel-crm-frontend` (must be globally unique — add random suffix)
3. Region: ap-south-1
4. **Uncheck** "Block all public access"
5. Bucket → Properties → **Static website hosting** → Enable
   - Index document: `index.html`
   - Error document: `index.html`
6. Bucket → Permissions → Bucket Policy → paste:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::fortel-crm-frontend/*"
  }]
}
```

---

## Step 10 — Deploy Frontend

Edit `deploy/3_deploy_frontend.sh` — set `EC2_PUBLIC_IP` and `S3_BUCKET`, then:

```bash
# Install AWS CLI if not done: https://aws.amazon.com/cli/
aws configure   # enter your Access Key ID, Secret, region: ap-south-1

chmod +x deploy/3_deploy_frontend.sh
./deploy/3_deploy_frontend.sh
```

---

## Step 11 — Create CloudFront Distribution

1. AWS Console → CloudFront → **Create distribution**
2. Origin domain: your S3 **website endpoint** (not the bucket URL)
   - Looks like: `fortel-crm-frontend.s3-website.ap-south-1.amazonaws.com`
3. Viewer protocol: **Redirect HTTP to HTTPS**
4. Default root object: `index.html`
5. Custom error responses → Add:
   - 403 → `/index.html` → 200 (for React Router)
   - 404 → `/index.html` → 200
6. Create → wait ~10 min for deployment
7. Copy the `xxxx.cloudfront.net` domain — this is your app URL

---

## Step 12 — Update Frontend URL

Edit `deploy/3_deploy_frontend.sh` — add `CLOUDFRONT_DIST_ID` from the distribution, then re-run to invalidate cache.

---

## Costs (ap-south-1, roughly)

| Service | Spec | Monthly |
|---------|------|---------|
| EC2 t3.small | 2 vCPU, 2GB | ~$15 |
| RDS db.t3.micro | 2 vCPU, 1GB | ~$15 |
| S3 + CloudFront | ~1GB storage | ~$2 |
| **Total** | | **~$32/month** |

---

## Useful Commands (on EC2)

```bash
# View backend logs
sudo journalctl -u fortel -f

# Restart backend
sudo systemctl restart fortel

# Check nginx logs
sudo tail -f /var/log/nginx/error.log

# Check backend error log
sudo tail -f /var/log/fortel/error.log
```

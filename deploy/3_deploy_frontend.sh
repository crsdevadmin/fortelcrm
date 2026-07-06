#!/bin/bash
# ============================================================
# Fortel CRM — Build React frontend and deploy to S3
# Run from your LOCAL machine (Git Bash on Windows):
#   chmod +x deploy/3_deploy_frontend.sh
#   ./deploy/3_deploy_frontend.sh
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - S3 bucket created (static website hosting enabled)
#   - Fill in the variables below
# ============================================================

EC2_PUBLIC_IP="YOUR_EC2_PUBLIC_IP"      # ← EC2 public IP or domain
S3_BUCKET="fortel-crm-frontend"          # ← your S3 bucket name
CLOUDFRONT_DIST_ID="YOUR_CF_DIST_ID"    # ← CloudFront distribution ID (optional)

echo "=== Building React frontend ==="
cd frontend

# Write production env
cat > .env.production <<EOF
REACT_APP_API_URL=http://${EC2_PUBLIC_IP}
EOF

npm install
npm run build

echo "=== Uploading to S3 ==="
aws s3 sync build/ "s3://${S3_BUCKET}/" \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

# index.html must NOT be cached so users always get latest version
aws s3 cp build/index.html "s3://${S3_BUCKET}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate"

# Invalidate CloudFront cache (if set up)
if [ "$CLOUDFRONT_DIST_ID" != "YOUR_CF_DIST_ID" ]; then
  echo "=== Invalidating CloudFront cache ==="
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DIST_ID" \
    --paths "/*"
fi

cd ..
echo "=== Frontend deployed to s3://${S3_BUCKET}/ ==="

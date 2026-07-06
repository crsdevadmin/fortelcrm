#!/bin/bash
# Fortel CRM - build React frontend and deploy to S3.
# Run from Git Bash on your local machine:
#   chmod +x deploy/3_deploy_frontend.sh
#   ./deploy/3_deploy_frontend.sh

set -e

EC2_PUBLIC_IP="13.206.119.130"
S3_BUCKET="fortel-crm-frontend"
CLOUDFRONT_DIST_ID="YOUR_CF_DIST_ID"

echo "=== Building React frontend ==="
cd frontend

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

aws s3 cp build/index.html "s3://${S3_BUCKET}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate"

if [ "$CLOUDFRONT_DIST_ID" != "YOUR_CF_DIST_ID" ]; then
  echo "=== Invalidating CloudFront cache ==="
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DIST_ID" \
    --paths "/*"
fi

cd ..
echo "=== Frontend deployed to s3://${S3_BUCKET}/ ==="

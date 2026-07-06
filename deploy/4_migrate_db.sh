#!/bin/bash
# ============================================================
# Fortel CRM — Migrate local PostgreSQL data to AWS RDS
# Run from your LOCAL machine (Git Bash on Windows)
#
# Fill in the variables below before running.
# ============================================================

LOCAL_DB="fortel_crm"                       # local DB name
LOCAL_USER="postgres"                        # local PG user

RDS_HOST="your-db.xxxx.ap-south-1.rds.amazonaws.com"  # ← RDS endpoint
RDS_PORT="5432"
RDS_DB="fortel_crm"
RDS_USER="fortel_admin"                      # ← master username you set in RDS

DUMP_FILE="fortel_backup_$(date +%Y%m%d_%H%M).sql"

echo "=== Dumping local database ==="
pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" \
  --no-owner --no-privileges \
  -f "$DUMP_FILE"

echo "=== Dump saved to $DUMP_FILE ==="

echo "=== Restoring to RDS ==="
echo "You will be prompted for the RDS password."
psql -h "$RDS_HOST" -p "$RDS_PORT" -U "$RDS_USER" -d "$RDS_DB" \
  -f "$DUMP_FILE"

echo "=== Migration complete ==="
echo "Verify by connecting: psql -h $RDS_HOST -U $RDS_USER -d $RDS_DB"

#!/usr/bin/env bash
set -euo pipefail

# Production runtime:
# - code -> /home/solarise/task-manager
# - db   -> /home/solarise/task-manager-data/prod/dev.db
#
# URL priority (handled by deploy-standalone.sh):
#   shell NEXTAUTH_URL > shell APP_BASE_URL > app.conf > existing .env > script default
#
# To change the external URL, either:
#   1. export APP_BASE_URL="http://..." before running this script, OR
#   2. edit /home/solarise/task-manager-data/prod/app.conf and redeploy
#
# The value below is the last-resort fallback.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export APP_BASE_URL="${APP_BASE_URL:-}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-}"

"${REPO_DIR}/scripts/deploy-standalone.sh" \
  "/home/solarise/task-manager" \
  "task-manager.service" \
  "31080" \
  "0.0.0.0" \
  "${NEXTAUTH_URL:-${APP_BASE_URL:-http://101.34.158.217:31080}}" \
  "/home/solarise/task-manager-data/prod/dev.db" \
  "${REPO_DIR}/prisma/dev.db" \
  "fail"

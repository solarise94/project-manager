#!/usr/bin/env bash
set -euo pipefail

# Production runtime:
# - code -> /home/solarise/task-manager
# - db   -> /home/solarise/task-manager-data/prod/dev.db
# - external access through https://task.solarise94.fun:39090

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"${REPO_DIR}/scripts/deploy-standalone.sh" \
  "/home/solarise/task-manager" \
  "task-manager.service" \
  "31080" \
  "0.0.0.0" \
  "https://task.solarise94.fun:39090" \
  "/home/solarise/task-manager-data/prod/dev.db" \
  "${REPO_DIR}/prisma/dev.db" \
  "fail"

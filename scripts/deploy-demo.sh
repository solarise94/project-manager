#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"${REPO_DIR}/scripts/deploy-standalone.sh" \
  "/home/solarise/task-manager-demo" \
  "task-manager-demo.service" \
  "31081" \
  "127.0.0.1" \
  "http://127.0.0.1:31081" \
  "/home/solarise/task-manager/dev.db"

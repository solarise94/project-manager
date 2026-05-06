#!/usr/bin/env bash
set -euo pipefail

# Deploy to remote production server.
#
# Usage:
#   REMOTE_HOST=task-manager-server ./scripts/deploy-remote-prod.sh
#   APP_BASE_URL="https://task.solarise94.fun:31080" ./scripts/deploy-remote-prod.sh
#
# Connection:
#   REMOTE_HOST should be an SSH alias defined in ~/.ssh/config, e.g.:
#
#     Host task-manager-server
#       HostName 101.34.158.217
#       User ubuntu
#       IdentityFile ~/.ssh/myubuntu.pem
#       IdentitiesOnly yes
#
#   If you must use a bare IP, also set SSH_CONFIG_FILE or ensure your
#   default SSH config picks up the right key.
#
# Bootstrap:
#   Set REMOTE_BOOTSTRAP_DB=1 to seed the remote database on first deploy.

REMOTE_HOST="${REMOTE_HOST:-task-manager-server}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/ubuntu/task-manager}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/home/ubuntu/task-manager-data/prod}"
REMOTE_SERVICE="${REMOTE_SERVICE:-task-manager.service}"
REMOTE_PORT="${REMOTE_PORT:-31081}"
REMOTE_HOSTNAME="${REMOTE_HOSTNAME:-127.0.0.1}"

# ── Unified SSH helpers ────────────────────────────────────────────────
# All remote access goes through these to ensure consistent identity/config.

SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"
SSH_OPTS=()
if [[ -n "${SSH_CONFIG_FILE:-}" ]]; then
  SSH_OPTS+=(-F "${SSH_CONFIG_FILE}")
fi

# SSH_CMD is an array: ("ssh" "-F" "cfg" "user@host")
SSH_CMD=(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}")

# For rsync, build a safe rsh string.  Single-quote each option so that
# spaces inside SSH_CONFIG_FILE don't cause word-splitting.
build_rsync_rsh() {
  local parts=("ssh")
  for opt in "${SSH_OPTS[@]}"; do
    parts+=("'${opt}'")
  done
  printf '%s' "${parts[*]}"
}
RSYNC_RSH="$(build_rsync_rsh)"

# Shortcut helpers for consistent remote calls.
remote_ssh() {
  "${SSH_CMD[@]}" "$@"
}

remote_rsync() {
  rsync -e "${RSYNC_RSH}" "$@"
}

remote_scp() {
  scp "${SSH_OPTS[@]}" "$@"
}

# Escape a value for safe use in a dotenv file (POSIX shell compatible).
# Escapes backslash, double-quote, newline, carriage-return, tab.
dotenv_quote() {
  local val="$1"
  val="${val//\\/\\\\}"
  val="${val//\"/\\\"}"
  val="${val//$'\n'/\\n}"
  val="${val//$'\r'/\\r}"
  val="${val//$'\t'/\\t}"
  printf '%s' "${val}"
}

# ── Config ──────────────────────────────────────────────────────────────

BOOTSTRAP_DB="${BOOTSTRAP_DB:-}"
MISSING_DB_POLICY="${REMOTE_BOOTSTRAP_DB:+bootstrap}"
MISSING_DB_POLICY="${MISSING_DB_POLICY:-fail}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_PROD_DB="/home/solarise/task-manager-data/prod/dev.db"
REMOTE_DB_PATH="${REMOTE_DATA_DIR}/dev.db"
TMP_DIR="$(mktemp -d)"

SERVICE_WAS_RUNNING=false
DB_BAK_MADE=false

# Single EXIT trap: clean up temp dir, restore DB backup if replacement failed, restart service if needed
on_exit() {
  local exit_code=$?
  # Restore DB from .bak if we created a backup but the new files are still .new (replacement incomplete)
  if [[ "${DB_BAK_MADE}" == "true" ]]; then
    if remote_ssh "test -f ${REMOTE_DB_PATH}.new" 2>/dev/null; then
      echo "  Restoring database from backup..."
      remote_ssh "
        for f in ${REMOTE_DB_PATH} ${REMOTE_DB_PATH}-wal ${REMOTE_DB_PATH}-shm ${REMOTE_DB_PATH}-journal; do
          if [ -f \${f}.bak ]; then mv \${f}.bak \${f}; fi
        done
        rm -f ${REMOTE_DB_PATH}.new ${REMOTE_DB_PATH}-wal.new ${REMOTE_DB_PATH}-shm.new ${REMOTE_DB_PATH}-journal.new
      " 2>/dev/null || true
    else
      # Replacement succeeded — just clean up .bak files
      remote_ssh "rm -f ${REMOTE_DB_PATH}.bak ${REMOTE_DB_PATH}-wal.bak ${REMOTE_DB_PATH}-shm.bak ${REMOTE_DB_PATH}-journal.bak" 2>/dev/null || true
    fi
  fi
  rm -rf "${TMP_DIR}"
  if [[ "${SERVICE_WAS_RUNNING}" == "true" ]]; then
    echo "  Restoring remote service..."
    remote_ssh "sudo systemctl start ${REMOTE_SERVICE}" 2>/dev/null || true
  fi
  exit ${exit_code}
}
trap on_exit EXIT

echo "=== Deploying to ${SSH_TARGET}:${REMOTE_PORT} ==="

# Preflight: SSH connectivity.
echo ""
echo "[preflight] Checking remote SSH connectivity..."

SSH_CHECK_OUT="$(remote_ssh "echo connected: \$(hostname)" 2>&1)" || {
  ssh_status=$?
  echo "ERROR: SSH connection to ${SSH_TARGET} failed (exit code ${ssh_status})." >&2
  if [[ -n "${SSH_CONFIG_FILE:-}" ]]; then
    echo "  SSH_CONFIG_FILE=${SSH_CONFIG_FILE}" >&2
  fi
  echo "Check: SSH alias, IdentityFile in ~/.ssh/config, and host reachability." >&2
  echo "Example ~/.ssh/config entry:" >&2
  echo "  Host ${REMOTE_HOST}" >&2
  echo "    HostName <ip>" >&2
  echo "    User ${REMOTE_USER}" >&2
  echo "    IdentityFile ~/.ssh/myubuntu.pem" >&2
  echo "    IdentitiesOnly yes" >&2
  exit 1
}
echo "  ${SSH_CHECK_OUT}"

# ── [1/8] Build locally ──────────────────────────────────────────────────
echo ""
echo "[1/8] Building production bundle..."
cd "${REPO_DIR}"
npm run build

# ── [2/8] Sync database schema ───────────────────────────────────────────
# Pull remote DB to local temp, push schema, upload back.
# Prisma CLI cannot operate on remote paths.
# Stop service first to get a consistent SQLite copy.
echo ""
echo "[2/8] Syncing database schema..."
REMOTE_DB_EXISTS=false

# Use set +e to capture ssh exit code explicitly.
# ssh remote 'test -f' exit codes:
#   0 — file exists
#   1 — file does not exist
#   255 — SSH connection error
set +e
remote_ssh "test -f '${REMOTE_DB_PATH}'"
ssh_status=$?
set -e

case ${ssh_status} in
  0)
    REMOTE_DB_EXISTS=true
    ;;
  1)
    REMOTE_DB_EXISTS=false
    ;;
  *)
    echo "ERROR: SSH connection to ${SSH_TARGET} failed while checking ${REMOTE_DB_PATH}." >&2
    echo "SSH exited with status ${ssh_status} (expected 0=exists, 1=not-found)." >&2
    echo "Check SSH config, IdentityFile, and host alias." >&2
    exit 1
    ;;
esac

if [[ "${REMOTE_DB_EXISTS}" == "true" ]]; then
  # Stop service for consistent DB copy
  if remote_ssh "sudo systemctl is-active --quiet ${REMOTE_SERVICE}" 2>/dev/null; then
    SERVICE_WAS_RUNNING=true
    echo "  Stopping remote service for consistent database snapshot..."
    remote_ssh "sudo systemctl stop ${REMOTE_SERVICE}"
  fi

  echo "  Pulling remote database..."
  remote_rsync -a "${SSH_TARGET}:${REMOTE_DB_PATH}" "${TMP_DIR}/dev.db"
  for suffix in -wal -shm -journal; do
    remote_ssh "test -f ${REMOTE_DB_PATH}${suffix}" 2>/dev/null && \
      remote_rsync -a "${SSH_TARGET}:${REMOTE_DB_PATH}${suffix}" "${TMP_DIR}/dev.db${suffix}" || true
  done

  echo "  Pushing schema..."
  if ! DATABASE_URL="file:${TMP_DIR}/dev.db" npx prisma db push 2>&1; then
    echo ""
    echo "ERROR: prisma db push failed — the schema change may require destructive migration." >&2
    echo "Run manually after backup:" >&2
    echo "  DATABASE_URL=\"file:${REMOTE_DB_PATH}\" npx prisma db push --accept-data-loss" >&2
    exit 1
  fi

  # Checkpoint WAL so we can upload a clean main DB file.
  WAL_CHECKPOINT_OK=false
  if command -v sqlite3 &>/dev/null; then
    if sqlite3 "${TMP_DIR}/dev.db" 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null; then
      WAL_CHECKPOINT_OK=true
    fi
  fi

  # Upload: write to .new temp files. Old files are backed up to .bak before replacement.
  echo "  Uploading migrated database..."
  remote_rsync -a "${TMP_DIR}/dev.db" "${SSH_TARGET}:${REMOTE_DB_PATH}.new"
  if [[ "${WAL_CHECKPOINT_OK}" != "true" ]]; then
    for suffix in -wal -shm -journal; do
      if [[ -f "${TMP_DIR}/dev.db${suffix}" ]]; then
        remote_rsync -a "${TMP_DIR}/dev.db${suffix}" "${SSH_TARGET}:${REMOTE_DB_PATH}${suffix}.new"
      fi
    done
  fi

  # Atomically replace: backup old → mv .new → clean .bak on success
  remote_ssh "
    # Backup current files
    for f in ${REMOTE_DB_PATH} ${REMOTE_DB_PATH}-wal ${REMOTE_DB_PATH}-shm ${REMOTE_DB_PATH}-journal; do
      if [ -f \${f} ]; then cp \${f} \${f}.bak; fi
    done
  "
  DB_BAK_MADE=true

  remote_ssh "
    mv ${REMOTE_DB_PATH}.new ${REMOTE_DB_PATH}
    for s in -wal -shm -journal; do
      if [ -f ${REMOTE_DB_PATH}\${s}.new ]; then
        mv ${REMOTE_DB_PATH}\${s}.new ${REMOTE_DB_PATH}\${s}
      else
        rm -f ${REMOTE_DB_PATH}\${s}
      fi
    done
    rm -f ${REMOTE_DB_PATH}.bak ${REMOTE_DB_PATH}-wal.bak ${REMOTE_DB_PATH}-shm.bak ${REMOTE_DB_PATH}-journal.bak
  "
  DB_BAK_MADE=false
elif [[ "${MISSING_DB_POLICY}" == "bootstrap" ]]; then
  echo "  Remote database not found at ${SSH_TARGET}:${REMOTE_DB_PATH}, bootstrapping..."
  BOOTSTRAP_SRC="${BOOTSTRAP_DB:-${LOCAL_PROD_DB}}"
  if [[ ! -f "${BOOTSTRAP_SRC}" ]]; then
    echo "Bootstrap database not found: ${BOOTSTRAP_SRC}" >&2
    exit 1
  fi
  cp "${BOOTSTRAP_SRC}" "${TMP_DIR}/dev.db"
  DATABASE_URL="file:${TMP_DIR}/dev.db" npx prisma db push
  if command -v sqlite3 &>/dev/null; then
    sqlite3 "${TMP_DIR}/dev.db" 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null || true
  fi
  remote_ssh "mkdir -p ${REMOTE_DATA_DIR}"
  remote_rsync -a "${TMP_DIR}/dev.db" "${SSH_TARGET}:${REMOTE_DB_PATH}.new"
  remote_ssh "mv ${REMOTE_DB_PATH}.new ${REMOTE_DB_PATH}"
else
  echo "  Remote database not found at ${SSH_TARGET}:${REMOTE_DB_PATH}."
  echo "  No bootstrap configured (MISSING_DB_POLICY=${MISSING_DB_POLICY})."
  echo "  Set REMOTE_BOOTSTRAP_DB=1 to bootstrap on first deploy."
  exit 1
fi

# ── [3/8] Create remote directories ──────────────────────────────────────
echo ""
echo "[3/8] Creating remote directories..."
remote_ssh "mkdir -p ${REMOTE_APP_DIR} ${REMOTE_APP_DIR}/.next/static ${REMOTE_APP_DIR}/public ${REMOTE_DATA_DIR}"

# ── [4/8] Rsync code to remote ───────────────────────────────────────────
echo ""
echo "[4/8] Syncing standalone output to remote..."
remote_rsync -a --delete --exclude=".env" --exclude="dev.db" \
  "${REPO_DIR}/.next/standalone/" "${SSH_TARGET}:${REMOTE_APP_DIR}/"
remote_rsync -a --delete \
  "${REPO_DIR}/.next/static/" "${SSH_TARGET}:${REMOTE_APP_DIR}/.next/static/"
remote_rsync -a --delete \
  "${REPO_DIR}/public/" "${SSH_TARGET}:${REMOTE_APP_DIR}/public/"

# ── [4.5/8] Sync Prisma runtime to remote ────────────────────────────────
echo ""
echo "[4.5/8] Syncing Prisma runtime..."
remote_ssh "mkdir -p ${REMOTE_APP_DIR}/node_modules/@prisma ${REMOTE_APP_DIR}/node_modules/.prisma"
for PKG_DIR in "@prisma/client" ".prisma"; do
  SRC="${REPO_DIR}/node_modules/${PKG_DIR}"
  if [[ -d "${SRC}" ]]; then
    remote_rsync -a --delete "${SRC}/" "${SSH_TARGET}:${REMOTE_APP_DIR}/node_modules/${PKG_DIR}/"
  fi
done

# Scan for hashed Prisma client packages and create shims
HASH_PKGS=$(grep -roh '@prisma/client-[0-9a-f]\+' "${REPO_DIR}/.next/standalone/.next/server/" 2>/dev/null | sort -u || true)
for HASH_PKG in ${HASH_PKGS}; do
  remote_ssh "if [[ ! -d ${REMOTE_APP_DIR}/node_modules/${HASH_PKG} ]]; then
    mkdir -p ${REMOTE_APP_DIR}/node_modules/${HASH_PKG}
    echo '{\"name\":\"${HASH_PKG}\",\"version\":\"0.0.0\",\"main\":\"index.js\"}' > ${REMOTE_APP_DIR}/node_modules/${HASH_PKG}/package.json
    echo 'module.exports = require(\"@prisma/client\");' > ${REMOTE_APP_DIR}/node_modules/${HASH_PKG}/index.js
    echo 'module.exports = require(\"@prisma/client\");' > ${REMOTE_APP_DIR}/node_modules/${HASH_PKG}/default.js
  fi"
done

# ── [5/8] Read remote persistent config and generate .env locally ────────
echo ""
echo "[5/8] Reading remote config and generating .env..."

# Helper: read a key from a remote conf file.
# Handles both KEY="value" and KEY=value formats. Strips surrounding double-quotes if present.
read_remote_conf() {
  local remote_file="$1"
  local key="$2"
  local raw
  raw="$(remote_ssh "grep -E '^${key}=' '${remote_file}' 2>/dev/null | head -1" 2>/dev/null || true)"
  if [[ -z "${raw}" ]]; then
    return 0
  fi
  local val="${raw#${key}=}"
  val="${val#\"}"
  val="${val%\"}"
  printf '%s' "${val}"
}

# Read SMTP config
SMTP_HOST_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/smtp.conf" SMTP_HOST)"
SMTP_PORT_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/smtp.conf" SMTP_PORT)"
SMTP_USER_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/smtp.conf" SMTP_USER)"
SMTP_PASS_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/smtp.conf" SMTP_PASS)"
SMTP_FROM_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/smtp.conf" SMTP_FROM)"
SMTP_FROM_VALUE="${SMTP_FROM_VALUE:-SciManage <reminder@scimanage.com>}"

# Read MiniMax config
MINIMAX_API_KEY_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/minimax.conf" MINIMAX_API_KEY)"
MINIMAX_BASE_URL_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/minimax.conf" MINIMAX_BASE_URL)"
MINIMAX_MODEL_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/minimax.conf" MINIMAX_MODEL)"
MINIMAX_MODEL_VALUE="${MINIMAX_MODEL_VALUE:-MiniMax-M2.7}"

# Read Tavily config
TAVILY_API_KEY_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/tavily.conf" TAVILY_API_KEY)"

# Read Tencent ASR config
TENCENTCLOUD_SECRET_ID_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/tencent-asr.conf" TENCENTCLOUD_SECRET_ID)"
TENCENTCLOUD_SECRET_KEY_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/tencent-asr.conf" TENCENTCLOUD_SECRET_KEY)"

# Read Tencent Map config
TENCENT_MAP_KEY_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/tencent-map.conf" TENCENT_MAP_KEY)"
NEXT_PUBLIC_TENCENT_MAP_KEY_VALUE="$(read_remote_conf "${REMOTE_DATA_DIR}/tencent-map.conf" NEXT_PUBLIC_TENCENT_MAP_KEY)"

# Read app.conf for APP_BASE_URL
APP_BASE_URL_CONF="$(read_remote_conf "${REMOTE_DATA_DIR}/app.conf" APP_BASE_URL)"

# Read reminder cron token (for internal reminder API)
# Priority: env var > remote reminder.conf > remote existing .env
REMINDER_CRON_TOKEN_VALUE="${REMINDER_CRON_TOKEN:-$(read_remote_conf "${REMOTE_DATA_DIR}/reminder.conf" REMINDER_CRON_TOKEN)}"
if [[ -z "${REMINDER_CRON_TOKEN_VALUE}" ]]; then
  REMINDER_CRON_TOKEN_VALUE="$(read_remote_conf "${REMOTE_APP_DIR}/.env" REMINDER_CRON_TOKEN)"
fi

# Validate before generating .env so we don't overwrite a valid remote token with an empty one
if [[ -z "${REMINDER_CRON_TOKEN_VALUE}" ]]; then
  if [[ -n "${ALLOW_MISSING_REMINDER_TOKEN:-}" ]]; then
    echo "  WARNING: REMINDER_CRON_TOKEN is not configured; reminder timer will be skipped."
  else
    echo "ERROR: REMINDER_CRON_TOKEN is not configured." >&2
    echo "  Set REMINDER_CRON_TOKEN env var, create ${REMOTE_DATA_DIR}/reminder.conf with REMINDER_CRON_TOKEN=<token>," >&2
    echo "  or ensure the remote ${REMOTE_APP_DIR}/.env already contains REMINDER_CRON_TOKEN." >&2
    echo "  To proceed without reminders, set ALLOW_MISSING_REMINDER_TOKEN=1." >&2
    exit 1
  fi
fi

# URL priority: shell NEXTAUTH_URL > shell APP_BASE_URL > remote app.conf > default
APP_BASE_URL_VALUE="${APP_BASE_URL:-${APP_BASE_URL_CONF:-https://task.solarise94.fun:31080}}"
NEXTAUTH_URL_VALUE="${NEXTAUTH_URL:-${APP_BASE_URL_VALUE}}"
NEXTAUTH_SECRET_VALUE="${NEXTAUTH_SECRET:-sci-project-manage-secret-key-2024-change-in-production}"

echo "  APP_BASE_URL: ${APP_BASE_URL_VALUE}"
echo "  NEXTAUTH_URL: ${NEXTAUTH_URL_VALUE}"

# Generate .env file locally with safe quoting
ENV_FILE="${TMP_DIR}/.env"
{
  echo "# Runtime database"
  echo "DATABASE_URL=\"file:$(dotenv_quote "${REMOTE_DB_PATH}")\""
  echo "# Public base URL"
  echo "NEXTAUTH_URL=\"$(dotenv_quote "${NEXTAUTH_URL_VALUE}")\""
  echo "APP_BASE_URL=\"$(dotenv_quote "${APP_BASE_URL_VALUE}")\""
  echo "NEXTAUTH_SECRET=\"$(dotenv_quote "${NEXTAUTH_SECRET_VALUE}")\""
  echo ""
  echo "# SMTP"
  echo "SMTP_HOST=\"$(dotenv_quote "${SMTP_HOST_VALUE}")\""
  echo "SMTP_PORT=\"$(dotenv_quote "${SMTP_PORT_VALUE}")\""
  echo "SMTP_USER=\"$(dotenv_quote "${SMTP_USER_VALUE}")\""
  echo "SMTP_PASS=\"$(dotenv_quote "${SMTP_PASS_VALUE}")\""
  echo "SMTP_FROM=\"$(dotenv_quote "${SMTP_FROM_VALUE}")\""
  echo "# MiniMax AI"
  echo "MINIMAX_API_KEY=\"$(dotenv_quote "${MINIMAX_API_KEY_VALUE}")\""
  echo "MINIMAX_BASE_URL=\"$(dotenv_quote "${MINIMAX_BASE_URL_VALUE}")\""
  echo "MINIMAX_MODEL=\"$(dotenv_quote "${MINIMAX_MODEL_VALUE}")\""
  echo "# Tavily"
  echo "TAVILY_API_KEY=\"$(dotenv_quote "${TAVILY_API_KEY_VALUE}")\""
  echo "# Tencent ASR"
  echo "TENCENTCLOUD_SECRET_ID=\"$(dotenv_quote "${TENCENTCLOUD_SECRET_ID_VALUE}")\""
  echo "TENCENTCLOUD_SECRET_KEY=\"$(dotenv_quote "${TENCENTCLOUD_SECRET_KEY_VALUE}")\""
  echo "# Tencent Map"
  echo "TENCENT_MAP_KEY=\"$(dotenv_quote "${TENCENT_MAP_KEY_VALUE}")\""
  echo "NEXT_PUBLIC_TENCENT_MAP_KEY=\"$(dotenv_quote "${NEXT_PUBLIC_TENCENT_MAP_KEY_VALUE}")\""
  echo "# Server bind"
  echo "PORT=\"$(dotenv_quote "${REMOTE_PORT}")\""
  echo "HOSTNAME=\"$(dotenv_quote "${REMOTE_HOSTNAME}")\""
  if [[ -n "${REMINDER_CRON_TOKEN_VALUE}" ]]; then
    echo "# Internal reminder cron"
    echo "REMINDER_CRON_TOKEN=\"$(dotenv_quote "${REMINDER_CRON_TOKEN_VALUE}")\""
  fi
} > "${ENV_FILE}"

# ── [6/8] Upload .env and write systemd service ──────────────────────────
echo ""
echo "[6/8] Uploading .env and writing systemd service..."

# SCP the .env file to remote (safe: file transfer, no shell interpolation)
remote_scp "${ENV_FILE}" "${SSH_TARGET}:${REMOTE_APP_DIR}/.env"

# Write systemd service via SSH (no secrets in this command)
remote_ssh "sudo tee /etc/systemd/system/${REMOTE_SERVICE} > /dev/null <<'UNITEOF'
[Unit]
Description=Task Manager Next.js App
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${REMOTE_APP_DIR}/.env
ExecStart=/usr/bin/node ${REMOTE_APP_DIR}/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF"

# ── [7/8] Restart service ────────────────────────────────────────────────
echo ""
echo "[7/8] Restarting service..."
remote_ssh "sudo systemctl daemon-reload && sudo systemctl enable ${REMOTE_SERVICE} && sudo systemctl restart ${REMOTE_SERVICE}"
SERVICE_WAS_RUNNING=false  # successfully restarted, EXIT trap should not start again

# ── [8/8] Smoke test ─────────────────────────────────────────────────────
echo ""
echo "[8/8] Smoke testing on remote server..."
SMOKE_OK=false
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  HTTP_CODE=$(remote_ssh "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${REMOTE_PORT}/api/auth/session" 2>/dev/null || echo "000")
  if [[ "${HTTP_CODE}" == "200" ]]; then
    SMOKE_OK=true
    break
  fi
  echo "  Attempt ${i}: HTTP ${HTTP_CODE}, retrying..."
done

if [[ "${SMOKE_OK}" == "true" ]]; then
  echo ""
  echo "=== Deploy successful! ==="
  echo "  ${NEXTAUTH_URL_VALUE}"

  # ── [9/8] Set up reminder timer ──────────────────────────────────────────
  echo ""
  echo "[9/8] Setting up reminder timer..."

  if [[ -z "${REMINDER_CRON_TOKEN_VALUE}" ]]; then
    echo "  Skipping reminder timer (ALLOW_MISSING_REMINDER_TOKEN is set)."
  else
    REMINDER_SERVICE="task-manager-reminder.service"
    REMINDER_TIMER="task-manager-reminder.timer"

    echo "  Writing ${REMINDER_SERVICE}..."
    remote_ssh "sudo tee /etc/systemd/system/${REMINDER_SERVICE} > /dev/null <<'UNITEOF'
[Unit]
Description=Task Manager Reminder Runner
After=network.target

[Service]
Type=oneshot
EnvironmentFile=${REMOTE_APP_DIR}/.env
ExecStart=/bin/bash -c 'set -a; source ${REMOTE_APP_DIR}/.env; set +a; exec curl -fsS -X POST -H \"Authorization: Bearer \${REMINDER_CRON_TOKEN}\" http://127.0.0.1:${REMOTE_PORT}/api/internal/reminders/run'
UNITEOF"

    echo "  Writing ${REMINDER_TIMER}..."
    remote_ssh "sudo tee /etc/systemd/system/${REMINDER_TIMER} > /dev/null <<'UNITEOF'
[Unit]
Description=Task Manager Reminder Timer
Requires=${REMINDER_SERVICE}

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNITEOF"

    echo "  Enabling and starting reminder timer..."
    remote_ssh "sudo systemctl daemon-reload && sudo systemctl enable --now ${REMINDER_TIMER}"

    echo ""
    echo "  Reminder timer status:"
    remote_ssh "sudo systemctl status ${REMINDER_TIMER} --no-pager" || true
    echo ""
    echo "  Active timers:"
    remote_ssh "sudo systemctl list-timers --no-pager | grep -E 'task-manager|NEXT|LEFT'" || true
  fi
else
  echo ""
  echo "SMOKE TEST FAILED: /api/auth/session did not return 200 after 10 attempts." >&2
  echo "Recent service logs from remote:" >&2
  remote_ssh "sudo journalctl -u ${REMOTE_SERVICE} --no-pager -n 30" >&2
  exit 1
fi

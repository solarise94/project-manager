#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 6 ]]; then
  echo "Usage: $0 <target_dir> <service_name> <port> <bind_host> <nextauth_url> <bootstrap_db>" >&2
  exit 1
fi

TARGET_DIR="$1"
SERVICE_NAME="$2"
PORT="$3"
BIND_HOST="$4"
NEXTAUTH_URL_VALUE="$5"
BOOTSTRAP_DB="$6"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DB="${TARGET_DIR}/dev.db"
NEXTAUTH_SECRET_VALUE="sci-project-manage-secret-key-2024-change-in-production"
EXISTING_ENV_FILE="${TARGET_DIR}/.env"
SMTP_HOST_VALUE="${SMTP_HOST:-}"
SMTP_PORT_VALUE="${SMTP_PORT:-}"
SMTP_USER_VALUE="${SMTP_USER:-}"
SMTP_PASS_VALUE="${SMTP_PASS:-}"
SMTP_FROM_VALUE="${SMTP_FROM:-}"

cd "${REPO_DIR}"

echo "[1/5] Building production bundle..."
npm run build

echo "[2/5] Preparing runtime directory..."
mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/.next/static" "${TARGET_DIR}/public"

echo "[3/5] Syncing standalone output..."
rsync -a --delete --exclude=".env" --exclude="dev.db" "${REPO_DIR}/.next/standalone/" "${TARGET_DIR}/"
rsync -a --delete "${REPO_DIR}/.next/static/" "${TARGET_DIR}/.next/static/"
rsync -a --delete "${REPO_DIR}/public/" "${TARGET_DIR}/public/"

if [[ ! -f "${RUNTIME_DB}" ]]; then
  echo "[4/5] Bootstrapping runtime database..."
  cp "${BOOTSTRAP_DB}" "${RUNTIME_DB}"
else
  echo "[4/5] Keeping existing runtime database..."
fi

echo "[4/5] Syncing database schema..."
cd "${REPO_DIR}"
DATABASE_URL="file:${RUNTIME_DB}" npx prisma db push --accept-data-loss > /dev/null 2>&1 || echo "  Warning: schema sync may have issues (non-fatal)"

if [[ -f "${EXISTING_ENV_FILE}" ]]; then
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"
    value="${value#\"}"
    case "${key}" in
      SMTP_HOST)
        [[ -z "${SMTP_HOST_VALUE}" ]] && SMTP_HOST_VALUE="${value}"
        ;;
      SMTP_PORT)
        [[ -z "${SMTP_PORT_VALUE}" ]] && SMTP_PORT_VALUE="${value}"
        ;;
      SMTP_USER)
        [[ -z "${SMTP_USER_VALUE}" ]] && SMTP_USER_VALUE="${value}"
        ;;
      SMTP_PASS)
        [[ -z "${SMTP_PASS_VALUE}" ]] && SMTP_PASS_VALUE="${value}"
        ;;
      SMTP_FROM)
        [[ -z "${SMTP_FROM_VALUE}" ]] && SMTP_FROM_VALUE="${value}"
        ;;
    esac
  done < <(grep -E '^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM)=' "${EXISTING_ENV_FILE}" || true)
fi

SMTP_FROM_VALUE="${SMTP_FROM_VALUE:-SciManage <reminder@scimanage.com>}"

echo "[4/5] Writing runtime .env..."
cat > "${TARGET_DIR}/.env" <<EOF
DATABASE_URL="file:${RUNTIME_DB}"
NEXTAUTH_URL="${NEXTAUTH_URL_VALUE}"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET_VALUE}"

# SMTP Configuration (optional - leave empty to use Ethereal test email)
SMTP_HOST="${SMTP_HOST_VALUE}"
SMTP_PORT="${SMTP_PORT_VALUE}"
SMTP_USER="${SMTP_USER_VALUE}"
SMTP_PASS="${SMTP_PASS_VALUE}"
SMTP_FROM="${SMTP_FROM_VALUE}"
PORT="${PORT}"
HOSTNAME="${BIND_HOST}"
EOF

echo "[5/5] Restarting ${SERVICE_NAME}..."
systemctl --user daemon-reload
systemctl --user restart "${SERVICE_NAME}"
systemctl --user --no-pager --full status "${SERVICE_NAME}" | sed -n '1,20p'

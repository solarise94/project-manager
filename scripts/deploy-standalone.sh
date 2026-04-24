#!/usr/bin/env bash
set -euo pipefail

# Build a standalone runtime into TARGET_DIR.
# Database policy:
# - runtime data lives in RUNTIME_DB, outside the code directory
# - a legacy TARGET_DIR/dev.db is migrated once if present
# - missing runtime databases now fail closed by default

if [[ $# -ne 8 ]]; then
  echo "Usage: $0 <target_dir> <service_name> <port> <bind_host> <nextauth_url> <runtime_db> <bootstrap_db> <missing_db_policy>" >&2
  echo "Example: $0 /home/solarise/task-manager-demo task-manager-demo.service 31081 127.0.0.1 http://127.0.0.1:31081 /home/solarise/task-manager-data/demo/dev.db /home/solarise/task-manager-data/prod/dev.db fail" >&2
  exit 1
fi

TARGET_DIR="$1"
SERVICE_NAME="$2"
PORT="$3"
BIND_HOST="$4"
NEXTAUTH_URL_VALUE="$5"
RUNTIME_DB="$6"
BOOTSTRAP_DB="$7"
MISSING_DB_POLICY="$8"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_RUNTIME_DB="${TARGET_DIR}/dev.db"
NEXTAUTH_SECRET_VALUE="sci-project-manage-secret-key-2024-change-in-production"
EXISTING_ENV_FILE="${TARGET_DIR}/.env"
SERVICE_FILE="${HOME}/.config/systemd/user/${SERVICE_NAME}"
NODE_BIN="$(command -v node)"
SMTP_HOST_VALUE="${SMTP_HOST:-}"
SMTP_PORT_VALUE="${SMTP_PORT:-}"
SMTP_USER_VALUE="${SMTP_USER:-}"
SMTP_PASS_VALUE="${SMTP_PASS:-}"
SMTP_FROM_VALUE="${SMTP_FROM:-}"
MINIMAX_API_KEY_VALUE="${MINIMAX_API_KEY:-}"
MINIMAX_BASE_URL_VALUE="${MINIMAX_BASE_URL:-}"
MINIMAX_MODEL_VALUE="${MINIMAX_MODEL:-}"
TAVILY_API_KEY_VALUE="${TAVILY_API_KEY:-}"

# Persistent config files live next to the database, survive deploys.
SMTP_CONF="$(dirname "${RUNTIME_DB}")/smtp.conf"
MINIMAX_CONF="$(dirname "${RUNTIME_DB}")/minimax.conf"
TAVILY_CONF="$(dirname "${RUNTIME_DB}")/tavily.conf"

cd "${REPO_DIR}"

echo "[1/8] Building production bundle..."
npm run build

echo "[2/8] Preparing runtime directory..."
mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/.next/static" "${TARGET_DIR}/public" "$(dirname "${RUNTIME_DB}")"

echo "[3/8] Syncing standalone output..."
rsync -a --delete --exclude=".env" --exclude="dev.db" "${REPO_DIR}/.next/standalone/" "${TARGET_DIR}/"
rsync -a --delete "${REPO_DIR}/.next/static/" "${TARGET_DIR}/.next/static/"
rsync -a --delete "${REPO_DIR}/public/" "${TARGET_DIR}/public/"

echo "[4/8] Preparing runtime database at ${RUNTIME_DB}..."

if [[ "${RUNTIME_DB}" != "${LEGACY_RUNTIME_DB}" && -f "${LEGACY_RUNTIME_DB}" && ! -f "${RUNTIME_DB}" ]]; then
  echo "  Migrating legacy runtime database from ${LEGACY_RUNTIME_DB}..."
  mv "${LEGACY_RUNTIME_DB}" "${RUNTIME_DB}"

  for suffix in -wal -shm -journal; do
    if [[ -f "${LEGACY_RUNTIME_DB}${suffix}" ]]; then
      mv "${LEGACY_RUNTIME_DB}${suffix}" "${RUNTIME_DB}${suffix}"
    fi
  done
fi

if [[ -f "${RUNTIME_DB}" ]]; then
  echo "[4/8] Keeping existing runtime database at ${RUNTIME_DB}..."
else
  case "${MISSING_DB_POLICY}" in
    bootstrap)
      if [[ ! -f "${BOOTSTRAP_DB}" ]]; then
        echo "Bootstrap database not found: ${BOOTSTRAP_DB}" >&2
        exit 1
      fi
      echo "[4/8] Bootstrapping runtime database from ${BOOTSTRAP_DB}..."
      cp "${BOOTSTRAP_DB}" "${RUNTIME_DB}"
      ;;
    fail)
      echo "Runtime database missing at ${RUNTIME_DB}." >&2
      echo "Refusing to bootstrap automatically. Restore the database or create it explicitly first." >&2
      exit 1
      ;;
    *)
      echo "Unknown missing_db_policy: ${MISSING_DB_POLICY}" >&2
      exit 1
      ;;
  esac
fi

echo "[5/8] Syncing database schema..."
cd "${REPO_DIR}"
if ! DATABASE_URL="file:${RUNTIME_DB}" npx prisma db push 2>&1; then
  echo ""
  echo "ERROR: prisma db push failed — the schema change may require destructive migration." >&2
  echo "If you are SURE data loss is acceptable, run manually:" >&2
  echo "  DATABASE_URL=\"file:${RUNTIME_DB}\" npx prisma db push --accept-data-loss" >&2
  exit 1
fi

# Read SMTP config: smtp.conf (persistent) > existing .env (legacy) > shell env
for SMTP_SOURCE in "${SMTP_CONF}" "${EXISTING_ENV_FILE}"; do
  [[ -f "${SMTP_SOURCE}" ]] || continue
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"
    value="${value#\"}"
    case "${key}" in
      SMTP_HOST) [[ -z "${SMTP_HOST_VALUE}" ]] && SMTP_HOST_VALUE="${value}" ;;
      SMTP_PORT) [[ -z "${SMTP_PORT_VALUE}" ]] && SMTP_PORT_VALUE="${value}" ;;
      SMTP_USER) [[ -z "${SMTP_USER_VALUE}" ]] && SMTP_USER_VALUE="${value}" ;;
      SMTP_PASS) [[ -z "${SMTP_PASS_VALUE}" ]] && SMTP_PASS_VALUE="${value}" ;;
      SMTP_FROM) [[ -z "${SMTP_FROM_VALUE}" ]] && SMTP_FROM_VALUE="${value}" ;;
    esac
  done < <(grep -E '^SMTP_(HOST|PORT|USER|PASS|FROM)=' "${SMTP_SOURCE}" || true)
done

SMTP_FROM_VALUE="${SMTP_FROM_VALUE:-SciManage <reminder@scimanage.com>}"

# Read MiniMax config: minimax.conf (persistent) > existing .env (legacy) > shell env
for MM_SOURCE in "${MINIMAX_CONF}" "${EXISTING_ENV_FILE}"; do
  [[ -f "${MM_SOURCE}" ]] || continue
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"
    value="${value#\"}"
    case "${key}" in
      MINIMAX_API_KEY)  [[ -z "${MINIMAX_API_KEY_VALUE}" ]]  && MINIMAX_API_KEY_VALUE="${value}" ;;
      MINIMAX_BASE_URL) [[ -z "${MINIMAX_BASE_URL_VALUE}" ]] && MINIMAX_BASE_URL_VALUE="${value}" ;;
      MINIMAX_MODEL)    [[ -z "${MINIMAX_MODEL_VALUE}" ]]    && MINIMAX_MODEL_VALUE="${value}" ;;
    esac
  done < <(grep -E '^MINIMAX_(API_KEY|BASE_URL|MODEL)=' "${MM_SOURCE}" || true)
done

MINIMAX_MODEL_VALUE="${MINIMAX_MODEL_VALUE:-MiniMax-M2.7}"

# Read Tavily config: tavily.conf (persistent) > existing .env (legacy) > shell env
for TV_SOURCE in "${TAVILY_CONF}" "${EXISTING_ENV_FILE}"; do
  [[ -f "${TV_SOURCE}" ]] || continue
  while IFS='=' read -r key value; do
    value="${value%\"}" ; value="${value#\"}"
    case "${key}" in
      TAVILY_API_KEY) [[ -z "${TAVILY_API_KEY_VALUE}" ]] && TAVILY_API_KEY_VALUE="${value}" ;;
    esac
  done < <(grep -E '^TAVILY_API_KEY=' "${TV_SOURCE}" || true)
done

echo "[6/8] Writing runtime .env..."
cat > "${TARGET_DIR}/.env" <<EOF
# Runtime database for this deployed instance only.
DATABASE_URL="file:${RUNTIME_DB}"
# Public base URL used by auth and email links.
NEXTAUTH_URL="${NEXTAUTH_URL_VALUE}"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET_VALUE}"

# SMTP settings — sourced from smtp.conf next to the database.
# To change: edit $(dirname $RUNTIME_DB)/smtp.conf and redeploy.
SMTP_HOST="${SMTP_HOST_VALUE}"
SMTP_PORT="${SMTP_PORT_VALUE}"
SMTP_USER="${SMTP_USER_VALUE}"
SMTP_PASS="${SMTP_PASS_VALUE}"
SMTP_FROM="${SMTP_FROM_VALUE}"
# MiniMax AI settings — sourced from minimax.conf next to the database.
MINIMAX_API_KEY="${MINIMAX_API_KEY_VALUE}"
MINIMAX_BASE_URL="${MINIMAX_BASE_URL_VALUE}"
MINIMAX_MODEL="${MINIMAX_MODEL_VALUE}"
# Tavily search settings — sourced from tavily.conf next to the database.
TAVILY_API_KEY="${TAVILY_API_KEY_VALUE}"
# Standalone server bind settings.
PORT="${PORT}"
HOSTNAME="${BIND_HOST}"
EOF

echo "[7/8] Writing ${SERVICE_NAME} unit..."
mkdir -p "$(dirname "${SERVICE_FILE}")"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Task Manager Next.js App
After=network.target

[Service]
Type=simple
WorkingDirectory=${TARGET_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${TARGET_DIR}/.env
ExecStart=${NODE_BIN} ${TARGET_DIR}/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

echo "[8/8] Restarting ${SERVICE_NAME}..."
systemctl --user daemon-reload
systemctl --user restart "${SERVICE_NAME}"
systemctl --user --no-pager --full status "${SERVICE_NAME}" | sed -n '1,20p'

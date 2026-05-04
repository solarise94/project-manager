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
SCRIPT_DEFAULT_URL="$5"  # fallback only — lowest priority
RUNTIME_DB="$6"
BOOTSTRAP_DB="$7"
MISSING_DB_POLICY="$8"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_RUNTIME_DB="${TARGET_DIR}/dev.db"
NEXTAUTH_SECRET_VALUE="sci-project-manage-secret-key-2024-change-in-production"
EXISTING_ENV_FILE="${TARGET_DIR}/.env"
SERVICE_FILE="${HOME}/.config/systemd/user/${SERVICE_NAME}"
NODE_BIN="$(command -v node)"

# Escape a value for safe use in a dotenv file.
dotenv_quote() {
  local val="$1"
  val="${val//\\/\\\\}"
  val="${val//\"/\\\"}"
  val="${val//$'\n'/\\n}"
  val="${val//$'\r'/\\r}"
  val="${val//$'\t'/\\t}"
  printf '%s' "${val}"
}
SMTP_HOST_VALUE="${SMTP_HOST:-}"
SMTP_PORT_VALUE="${SMTP_PORT:-}"
SMTP_USER_VALUE="${SMTP_USER:-}"
SMTP_PASS_VALUE="${SMTP_PASS:-}"
SMTP_FROM_VALUE="${SMTP_FROM:-}"
MINIMAX_API_KEY_VALUE="${MINIMAX_API_KEY:-}"
MINIMAX_BASE_URL_VALUE="${MINIMAX_BASE_URL:-}"
MINIMAX_MODEL_VALUE="${MINIMAX_MODEL:-}"
TAVILY_API_KEY_VALUE="${TAVILY_API_KEY:-}"
TENCENTCLOUD_SECRET_ID_VALUE="${TENCENTCLOUD_SECRET_ID:-}"
TENCENTCLOUD_SECRET_KEY_VALUE="${TENCENTCLOUD_SECRET_KEY:-}"
TENCENT_MAP_KEY_VALUE="${TENCENT_MAP_KEY:-}"
NEXT_PUBLIC_TENCENT_MAP_KEY_VALUE="${NEXT_PUBLIC_TENCENT_MAP_KEY:-}"

# Persistent config files live next to the database, survive deploys.
SMTP_CONF="$(dirname "${RUNTIME_DB}")/smtp.conf"
MINIMAX_CONF="$(dirname "${RUNTIME_DB}")/minimax.conf"
TAVILY_CONF="$(dirname "${RUNTIME_DB}")/tavily.conf"
TENCENT_ASR_CONF="$(dirname "${RUNTIME_DB}")/tencent-asr.conf"
TENCENT_MAP_CONF="$(dirname "${RUNTIME_DB}")/tencent-map.conf"
APP_CONF="$(dirname "${RUNTIME_DB}")/app.conf"

# URL priority: shell NEXTAUTH_URL > shell APP_BASE_URL > app.conf > existing .env > script arg > hardcoded default
NEXTAUTH_URL_VALUE="${NEXTAUTH_URL:-}"
APP_BASE_URL_VALUE="${APP_BASE_URL:-}"

cd "${REPO_DIR}"

echo "[1/8] Building production bundle..."
npm run build

echo "[2/8] Preparing runtime directory..."
mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/.next/static" "${TARGET_DIR}/public" "$(dirname "${RUNTIME_DB}")"

echo "[3/8] Syncing standalone output..."
rsync -a --delete --exclude=".env" --exclude="dev.db" "${REPO_DIR}/.next/standalone/" "${TARGET_DIR}/"
rsync -a --delete "${REPO_DIR}/.next/static/" "${TARGET_DIR}/.next/static/"
rsync -a --delete "${REPO_DIR}/public/" "${TARGET_DIR}/public/"

echo "[3.5/8] Ensuring Prisma runtime is available in standalone..."
# Copy the canonical Prisma client packages
for PKG_DIR in "@prisma/client" ".prisma"; do
  SRC="${REPO_DIR}/node_modules/${PKG_DIR}"
  DST="${TARGET_DIR}/node_modules/${PKG_DIR}"
  if [[ -d "${SRC}" ]]; then
    mkdir -p "$(dirname "${DST}")"
    rsync -a --delete "${SRC}/" "${DST}/"
  fi
done

# Scan for hashed Prisma client package names (e.g. @prisma/client-2c3a283f134fdcb6)
# and create shim modules that re-export the canonical @prisma/client
HASH_PKGS=$(grep -roh '@prisma/client-[0-9a-f]\+' "${TARGET_DIR}/.next/server/" 2>/dev/null | sort -u || true)
for HASH_PKG in ${HASH_PKGS}; do
  SHIM_DIR="${TARGET_DIR}/node_modules/${HASH_PKG}"
  if [[ ! -d "${SHIM_DIR}" ]]; then
    echo "  Creating shim for ${HASH_PKG}"
    mkdir -p "${SHIM_DIR}"
    cat > "${SHIM_DIR}/package.json" <<SHIMEOF
{"name":"${HASH_PKG}","version":"0.0.0","main":"index.js"}
SHIMEOF
    cat > "${SHIM_DIR}/index.js" <<SHIMEOF
module.exports = require("@prisma/client");
SHIMEOF
    cat > "${SHIM_DIR}/default.js" <<SHIMEOF
module.exports = require("@prisma/client");
SHIMEOF
  fi
done

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

# Read Tencent Cloud ASR config: tencent-asr.conf (persistent) > existing .env (legacy) > shell env
for TC_SOURCE in "${TENCENT_ASR_CONF}" "${EXISTING_ENV_FILE}"; do
  [[ -f "${TC_SOURCE}" ]] || continue
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"
    value="${value#\"}"
    case "${key}" in
      TENCENTCLOUD_SECRET_ID)  [[ -z "${TENCENTCLOUD_SECRET_ID_VALUE}" ]]  && TENCENTCLOUD_SECRET_ID_VALUE="${value}" ;;
      TENCENTCLOUD_SECRET_KEY) [[ -z "${TENCENTCLOUD_SECRET_KEY_VALUE}" ]] && TENCENTCLOUD_SECRET_KEY_VALUE="${value}" ;;
    esac
  done < <(grep -E '^TENCENTCLOUD_SECRET_(ID|KEY)=' "${TC_SOURCE}" || true)
done

# Read Tencent Map config: shell env > tencent-map.conf > existing .env
for TM_SOURCE in "${TENCENT_MAP_CONF}" "${EXISTING_ENV_FILE}"; do
  [[ -f "${TM_SOURCE}" ]] || continue
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"
    value="${value#\"}"
    case "${key}" in
      TENCENT_MAP_KEY)             [[ -z "${TENCENT_MAP_KEY_VALUE}" ]]             && TENCENT_MAP_KEY_VALUE="${value}" ;;
      NEXT_PUBLIC_TENCENT_MAP_KEY) [[ -z "${NEXT_PUBLIC_TENCENT_MAP_KEY_VALUE}" ]] && NEXT_PUBLIC_TENCENT_MAP_KEY_VALUE="${value}" ;;
    esac
  done < <(grep -E '^(TENCENT_MAP_KEY|NEXT_PUBLIC_TENCENT_MAP_KEY)=' "${TM_SOURCE}" || true)
done

if [[ -n "${TENCENT_MAP_KEY_VALUE}" ]]; then
  echo "  Tencent Map Key: configured"
else
  echo "  Tencent Map Key: not configured"
fi

# Read app.conf (persistent config, survives deploys)
# Priority: shell env > app.conf > existing runtime .env (APP_BASE_URL only) > script default > hardcoded
if [[ -f "${APP_CONF}" ]]; then
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"; value="${value#\"}"
    case "${key}" in
      APP_BASE_URL) [[ -z "${APP_BASE_URL_VALUE}" ]] && APP_BASE_URL_VALUE="${value}" ;;
    esac
  done < <(grep -E '^APP_BASE_URL=' "${APP_CONF}" || true)
fi

# Read existing runtime .env — only APP_BASE_URL as last fallback.
# NEXTAUTH_URL from old .env is NOT used: it's stale output, not config.
if [[ -f "${EXISTING_ENV_FILE}" ]]; then
  while IFS='=' read -r key raw_value; do
    value="${raw_value%\"}"; value="${value#\"}"
    case "${key}" in
      APP_BASE_URL) [[ -z "${APP_BASE_URL_VALUE}" ]] && APP_BASE_URL_VALUE="${value}" ;;
    esac
  done < <(grep -E '^APP_BASE_URL=' "${EXISTING_ENV_FILE}" || true)
fi

# Resolve NEXTAUTH_URL: shell NEXTAUTH_URL > APP_BASE_URL (shell > app.conf > .env) > script default > hardcoded
if [[ -z "${NEXTAUTH_URL_VALUE}" ]]; then
  NEXTAUTH_URL_VALUE="${APP_BASE_URL_VALUE:-${SCRIPT_DEFAULT_URL:-http://localhost:3000}}"
fi

echo "  APP_BASE_URL: ${APP_BASE_URL_VALUE:-not set}"
echo "  NEXTAUTH_URL: ${NEXTAUTH_URL_VALUE}"

echo "[6/8] Writing runtime .env..."
{
  echo "# Runtime database for this deployed instance only."
  echo "DATABASE_URL=\"file:$(dotenv_quote "${RUNTIME_DB}")\""
  echo "# Public base URL used by auth and email links."
  echo "NEXTAUTH_URL=\"$(dotenv_quote "${NEXTAUTH_URL_VALUE}")\""
  echo "APP_BASE_URL=\"$(dotenv_quote "${APP_BASE_URL_VALUE:-${NEXTAUTH_URL_VALUE}}")\""
  echo "NEXTAUTH_SECRET=\"$(dotenv_quote "${NEXTAUTH_SECRET_VALUE}")\""
  echo ""
  echo "# SMTP settings"
  echo "SMTP_HOST=\"$(dotenv_quote "${SMTP_HOST_VALUE}")\""
  echo "SMTP_PORT=\"$(dotenv_quote "${SMTP_PORT_VALUE}")\""
  echo "SMTP_USER=\"$(dotenv_quote "${SMTP_USER_VALUE}")\""
  echo "SMTP_PASS=\"$(dotenv_quote "${SMTP_PASS_VALUE}")\""
  echo "SMTP_FROM=\"$(dotenv_quote "${SMTP_FROM_VALUE}")\""
  echo "# MiniMax AI settings"
  echo "MINIMAX_API_KEY=\"$(dotenv_quote "${MINIMAX_API_KEY_VALUE}")\""
  echo "MINIMAX_BASE_URL=\"$(dotenv_quote "${MINIMAX_BASE_URL_VALUE}")\""
  echo "MINIMAX_MODEL=\"$(dotenv_quote "${MINIMAX_MODEL_VALUE}")\""
  echo "# Tavily search settings"
  echo "TAVILY_API_KEY=\"$(dotenv_quote "${TAVILY_API_KEY_VALUE}")\""
  echo "# Tencent Cloud ASR settings"
  echo "TENCENTCLOUD_SECRET_ID=\"$(dotenv_quote "${TENCENTCLOUD_SECRET_ID_VALUE}")\""
  echo "TENCENTCLOUD_SECRET_KEY=\"$(dotenv_quote "${TENCENTCLOUD_SECRET_KEY_VALUE}")\""
  echo "# Tencent Map settings"
  echo "TENCENT_MAP_KEY=\"$(dotenv_quote "${TENCENT_MAP_KEY_VALUE}")\""
  echo "NEXT_PUBLIC_TENCENT_MAP_KEY=\"$(dotenv_quote "${NEXT_PUBLIC_TENCENT_MAP_KEY_VALUE}")\""
  echo "# Standalone server bind settings."
  echo "PORT=\"$(dotenv_quote "${PORT}")\""
  echo "HOSTNAME=\"$(dotenv_quote "${BIND_HOST}")\""
} > "${TARGET_DIR}/.env"

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

echo ""
echo "Smoke-testing /api/auth/session on port ${PORT}..."
SMOKE_OK=false
for i in 1 2 3 4 5; do
  sleep 2
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/api/auth/session" 2>/dev/null || echo "000")
  if [[ "${HTTP_CODE}" == "200" ]]; then
    SMOKE_OK=true
    break
  fi
  echo "  Attempt ${i}: HTTP ${HTTP_CODE}, retrying..."
done

if [[ "${SMOKE_OK}" == "true" ]]; then
  echo "Smoke test passed: /api/auth/session returned 200"
else
  echo ""
  echo "SMOKE TEST FAILED: /api/auth/session did not return 200 after 5 attempts." >&2
  echo "Recent service logs:" >&2
  journalctl --user -u "${SERVICE_NAME}" --no-pager -n 30 >&2
  exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REMOTE_HOST="${REMOTE_HOST:-task-manager-server}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"

APP_BASE_URL="${APP_BASE_URL:-https://task.solarise94.fun:32080}"
NEXTAUTH_URL="${NEXTAUTH_URL:-${APP_BASE_URL}}"

export REMOTE_HOST
export REMOTE_USER
export REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/ubuntu/task-manager-32080}"
export REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/home/ubuntu/task-manager-data/32080}"
export REMOTE_SERVICE="${REMOTE_SERVICE:-task-manager-32080.service}"
export REMOTE_PORT="${REMOTE_PORT:-32081}"
export REMOTE_HOSTNAME="${REMOTE_HOSTNAME:-127.0.0.1}"
export REMINDER_SERVICE="${REMINDER_SERVICE:-task-manager-32080-reminder.service}"
export REMINDER_TIMER="${REMINDER_TIMER:-task-manager-32080-reminder.timer}"
export CRM_REVIEW_SERVICE="${CRM_REVIEW_SERVICE:-task-manager-32080-crm-review.service}"
export CRM_REVIEW_TIMER="${CRM_REVIEW_TIMER:-task-manager-32080-crm-review.timer}"
export CRM_LIFECYCLE_SERVICE="${CRM_LIFECYCLE_SERVICE:-task-manager-32080-crm-lifecycle.service}"
export CRM_LIFECYCLE_TIMER="${CRM_LIFECYCLE_TIMER:-task-manager-32080-crm-lifecycle.timer}"
export APP_BASE_URL
export NEXTAUTH_URL
export DEPLOY_PUBLIC_URL="${APP_BASE_URL}"
export DEPLOY_TARGET="prod-32080"

"${REPO_DIR}/scripts/deploy-remote-prod.sh"

ssh "${SSH_TARGET}" "sudo tee /etc/nginx/sites-available/task-manager-32080 > /dev/null <<'NGINX'
server {
    listen 32080 ssl;
    server_name task.solarise94.fun;

    ssl_certificate /etc/ssl/task-manager/fullchain.pem;
    ssl_certificate_key /etc/ssl/task-manager/cert.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:32081;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 32080;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/task-manager-32080 /etc/nginx/sites-enabled/task-manager-32080
sudo nginx -t
sudo systemctl reload nginx"

echo ""
echo "=== 32080 reverse proxy ready ==="
echo "  ${APP_BASE_URL}"

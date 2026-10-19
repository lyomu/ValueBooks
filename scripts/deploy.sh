#!/usr/bin/env bash
set -euo pipefail

# Dedicated box deploy (161.97.140.207): pulls a pinned Docker Hub image
# rather than building on the box -- building here would contend with live
# traffic for the box's own 4 vCPU/8GB, same reasoning as drift's deploy.sh.
# Used both for a manual break-glass deploy and as the thing the Jenkins
# "Deploy Prod" stage invokes over SSH, so there is one deploy code path.

APP_DIR="${APP_DIR:-/srv/valuebooks/prod}"
REPO_URL="${REPO_URL:-https://github.com/lyomu/ValueBooks.git}"
BRANCH="${BRANCH:-main}"

if [ -z "${VALUEBOOKS_IMAGE_TAG:-}" ]; then
  echo "VALUEBOOKS_IMAGE_TAG must be set (e.g. sha-0123456789ab from the Jenkins build)." >&2
  echo "This box only ever runs a pinned, published image -- never :local." >&2
  exit 1
fi

if [ ! -f "${APP_DIR}/.env.production" ]; then
  echo "Missing ${APP_DIR}/.env.production. Populate it from .env.example before deploying." >&2
  exit 1
fi

# Keep this check deliberately independent of `source`: deployment config is
# data, not shell code, and a malformed value must not be able to execute on
# the production host (same convention as drift/scripts/deploy.sh).
env_value() {
  local name="$1"
  local line key value=""

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#export }"
    line="${line#export$'\t'}"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    [ "$key" = "$name" ] || continue
    value="${line#*=}"
  done < "${APP_DIR}/.env.production"

  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

require_env_var() {
  local name="$1"
  local value
  value="$(env_value "$name")"
  if [ -z "${value//[[:space:]]/}" ]; then
    echo "Missing or empty required variable ${name} in ${APP_DIR}/.env.production." >&2
    return 1
  fi
}

required_env_vars=(
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  SECURITY_PEPPER
  NEXT_PUBLIC_API_URL
)

for required_env_var in "${required_env_vars[@]}"; do
  require_env_var "$required_env_var"
done

if [ ! -d "${APP_DIR}/.git" ]; then
  mkdir -p "${APP_DIR}"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

export VALUEBOOKS_IMAGE_TAG
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps

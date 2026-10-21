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

# Last known good marker, not `docker inspect` on the running container -- survives the
# containers being replaced below and works the same for a break-glass deploy as for Jenkins.
LAST_GOOD_FILE="${APP_DIR}/.last_deployed_tag"
PREVIOUS_TAG=""
[ -f "${LAST_GOOD_FILE}" ] && PREVIOUS_TAG="$(cat "${LAST_GOOD_FILE}")"

export VALUEBOOKS_IMAGE_TAG
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps

# Same two checks as the Jenkinsfile's Smoke Tests (Prod) stage -- a deploy that brings up
# containers which never pass them is exactly what happened with sha-64891966aadb
# (apps/api/Dockerfile missing packages/*, fixed in PR #47), just caught here instead of there.
health_check() {
  label="$1"; url="$2"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    echo "${label} not ready yet, retrying..." >&2
    sleep 5
  done
  echo "${label} never became ready" >&2
  return 1
}

if health_check web http://127.0.0.1:3001/ && health_check api http://127.0.0.1:3002/api/v1/health; then
  echo "${VALUEBOOKS_IMAGE_TAG}" > "${LAST_GOOD_FILE}"
  echo "Deploy of ${VALUEBOOKS_IMAGE_TAG} is healthy -- recorded as last known good."
else
  echo "Health check failed for ${VALUEBOOKS_IMAGE_TAG}." >&2
  if [ -n "${PREVIOUS_TAG}" ] && [ "${PREVIOUS_TAG}" != "${VALUEBOOKS_IMAGE_TAG}" ]; then
    echo "Rolling back to last known good tag ${PREVIOUS_TAG}..." >&2
    VALUEBOOKS_IMAGE_TAG="${PREVIOUS_TAG}" bash "$0"
  else
    echo "No previous known-good tag recorded (first-ever deploy, same situation as the sha-64891966aadb incident) -- leaving the broken containers up for manual inspection rather than guessing." >&2
  fi
  exit 1
fi

# Monorepo-aware: build context is the REPO ROOT, not apps/web, because npm
# workspaces (@valuebooks/contracts, @valuebooks/localization, @valuebooks/ui)
# are resolved via sibling symlinks in the root node_modules. Build with:
#   docker build -f apps/web/Dockerfile -t valuebooks-web .
#
# Base image matches the rest of the einsbrand fleet's Node Dockerfiles
# (drift/backend, drift/website): node:24-bookworm-slim, not alpine — avoids
# musl-vs-glibc surprises with native addons (@napi-rs/canvas is also a
# dependency of @valuebooks/api, built against glibc here for consistency).

FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

# Workspace manifests only, for a cache-friendly npm ci layer -- this layer
# only invalidates when a package.json changes, not on every source edit.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/localization/package.json packages/localization/package.json
COPY packages/accounting-core/package.json packages/accounting-core/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json
RUN npm ci

COPY . .
ENV NODE_ENV=production
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at runtime -- must be a build arg, same pattern as drift's
# club-admin/platform-admin Dockerfiles (NEXT_PUBLIC_API_URL build-arg).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Host split (marketing / app / console). Left empty, the app serves every area on one host.
ARG NEXT_PUBLIC_MARKETING_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CONSOLE_URL
ENV NEXT_PUBLIC_MARKETING_URL=${NEXT_PUBLIC_MARKETING_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_CONSOLE_URL=${NEXT_PUBLIC_CONSOLE_URL}
RUN npm run build --workspace @valuebooks/web

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `output: "standalone"` traces only the server bundle; in this monorepo the
# standalone tree mirrors the workspace path from the repo root
# (apps/web/.next/standalone/apps/web/...), matching apps/web's own `start` script
# and its postbuild script (scripts/copy-standalone-static.mjs), which already
# copied .next/static and public/ into that same standalone tree before this
# COPY runs. `--chown=node:node` matters: Next's image optimizer writes to
# .next/cache at runtime and fails EACCES without it (see drift/website's
# Dockerfile, same fix, same reason).
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

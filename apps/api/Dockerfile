# Monorepo-aware: build context is the REPO ROOT, not apps/api (see
# apps/web/Dockerfile for why). Build with:
#   docker build -f apps/api/Dockerfile -t valuebooks-api .
#
# One image serves THREE processes (same dist/ output, different CMD at the
# compose layer): the HTTP API (dist/src/main.js), the generic BullMQ worker
# (dist/src/worker.js), and the document-extraction worker
# (dist/src/document-extraction-worker.js, which the app's own package.json
# already runs with --max-old-space-size=384 -- OCR/PDF work capped
# deliberately). Do not build three separate images for this.
#
# NEEDS A REAL BUILD+RUN TEST BEFORE TRUSTING THIS: two dependencies here are
# notoriously fragile in Docker --
#   - `playwright` (prod dependency, apps/api/src/sales/document-rendering.service.ts
#     launches a fresh `chromium` per PDF render, not a persistent browser) needs
#     Chromium's own apt dependencies, installed below via `playwright install-deps`.
#   - `@napi-rs/canvas` is a native addon; node:24-bookworm-slim (glibc) was chosen
#     over alpine specifically so its prebuilt binary has a target to match.
# If either breaks at runtime, check `playwright install-deps` actually covered
# this Debian version's library names before assuming the image itself is wrong.

FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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

COPY apps/api/prisma apps/api/prisma
RUN npm run db:generate --workspace @valuebooks/api

COPY . .
RUN npm run build --workspace @valuebooks/api

# CI runs lint/typecheck/test against THIS stage, and the integration suite
# exercises the PDF-render path (document-rendering.service.ts launches a real
# chromium), so the browser has to exist here too -- not only in runtime.
# Build #10's integration run failed 28 tests on a missing browser executable.
#
# PLAYWRIGHT_BROWSERS_PATH pins an explicit, world-readable location instead of
# the installing user's ~/.cache, so both stages agree on one path and a
# non-root runtime user can actually read it (see the runtime stage).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --prefix apps/api playwright install-deps chromium \
  && npx --prefix apps/api playwright install chromium

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Chromium for playwright's PDF-render path. `install-deps` installs this
# Debian release's apt packages for the browser; the browser binary itself is
# copied from the build stage rather than downloaded a second time.
#
# The explicit PLAYWRIGHT_BROWSERS_PATH matters. Installing as root without it
# lands the browser in /root/.cache/ms-playwright, and /root is mode 700 on
# Debian -- so the `node` user this image drops to could not read it, and every
# PDF render would fail at runtime while the image still built green.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /ms-playwright /ms-playwright
RUN npx --prefix apps/api playwright install-deps chromium \
  && chmod -R a+rX /ms-playwright

# tesseract.js (ocr.service.ts) calls createWorker('eng') with no langPath, so
# it caches eng.traineddata into the process CWD -- /app -- fetching it on
# first use. /app is root-owned, so without this the OCR worker dies on EACCES
# the first time it handles a document.
#
# This previously tried to COPY apps/api/eng.traineddata from the build stage,
# which could never work: *.traineddata is in .gitignore so the file is never
# in the build context, and /app/apps/api is not where tesseract.js looks
# anyway. That broken COPY failed the production image build outright, which
# went unnoticed because Docker Build & Push has never run.
RUN chown node:node /app

USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]

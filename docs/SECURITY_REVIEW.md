# Security review — dependency scanning, auth, sessions, secrets

**Date:** 2026-10-10 · **Scope:** `docs/PENDING_WORK.md` item 15 (H6) / `docs/GAPS.md` #11.
Builds on `docs/adr/0011-threat-model-and-secret-handling.md`, which scoped untrusted file input
(Phases 5/8/9) and explicitly deferred three things to this review: adding `npm audit` to CI,
rate limiting beyond auth, and the CSV export this review found has a real gap in.

## 1. Dependency scan

**Before:** no scan existed in CI. A local `npm audit --audit-level=high` found 27 advisories (6
critical, 16 high, 5 moderate).

**Fixed in this PR:** `npm audit fix` (no `--force`) resolved 24 of the 27 via same-major
patch/minor bumps — confirmed by inspecting the actual installed versions, not just trusting the
"fixAvailable: true" flag (that flag means "no `--force` needed," not "no major-version change of
a direct dependency" — see the `nodemailer` case below):

| Package                                                                           | Before  | After   | Closes                                                                                  |
| --------------------------------------------------------------------------------- | ------- | ------- | --------------------------------------------------------------------------------------- |
| `next`                                                                            | 15.5.23 | 15.5.27 | Critical: unauthenticated RCE (Windows hosts, AVIF image optimization), cache poisoning |
| `sharp` (via `next`)                                                              | 0.34.5  | 0.35.5  | libvips/libheif/librsvg CVEs                                                            |
| `multer` (via `@nestjs/platform-express`)                                         | 2.2.0   | 2.4.0   | 5 DoS/validation-bypass advisories                                                      |
| `proxy-addr` (via `express`)                                                      | 2.0.7   | 2.0.8   | Critical: IP-spoofing via IPv4-mapped IPv6 trust subnet                                 |
| `qs` (via `express`)                                                              | ≤6.15.3 | 6.16.0  | Array-limit bypass, DoS                                                                 |
| `shell-quote` (via `concurrently`, dev)                                           | ≤1.10.0 | 1.12.0  | Critical: command injection                                                             |
| `postcss`, `fast-uri`, `js-yaml`, `fast-copy`, `brace-expansion`, `source-map-js` | various | patched | Assorted high/moderate transitive advisories                                            |

**Fixed deliberately, with extra verification (`nodemailer`):** pinned `^9.0.5` → `^10.1.0` in
`apps/api/package.json`. This crosses nodemailer's own major version boundary — `npm audit fix`
could not do it on its own (it only bumped to the latest 9.x, 9.1.1, which is still vulnerable;
the fix needs ≥10.0.9) — so it was done deliberately and verified, not blindly applied:

- Fixes a cross-tenant SMTP credential-disclosure advisory (GHSA-6vj9) plus four DoS advisories.
- Our usage is the minimal, stable surface (`createTransport({host, port, secure, timeouts})` +
  `sendMail({...message, from})`, `apps/api/src/jobs/email-delivery.service.ts`) — no pooling, no
  DKIM, no custom transport plugins, nothing nodemailer's major-version migration guides call out
  as changed.
- Verified: `npm run typecheck`, `npm test` (all 201 API unit tests), and the full integration
  suite (`AI_MODE=off npm run test:integration`), which exercises real SMTP delivery through
  Mailpit for signup verification, password reset, and portal invitation emails.

**Deferred — no safe fix available, each build-time-only and not exploitable here:**

| Advisory                                                                                          | Severity      | Why not fixed now                                                                                                                                                  | Why not exploitable here                                                                                                                                                                          | Owner                                               |
| ------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `deepmerge-ts` via `@prisma/config` (stack-exhaustion DoS)                                        | High          | No fix exists yet even at the latest `prisma@6.19.3` we already run; `npm audit fix --force` would _downgrade_ to `prisma@6.12.0`, which is not a real fix         | `@prisma/config` is only loaded by the `prisma` CLI (`generate`/`migrate`), which processes our own trusted config files at build/dev time — never imported by the deployed API or worker process | Whoever next upgrades Prisma; re-check each bump    |
| `postcss` (bundled inside `next`'s own `node_modules`, XSS/path-traversal via `sourceMappingURL`) | High          | Needs `next@16.4.0` — a real framework major version, not a patch; out of scope for a review branch                                                                | PostCSS only processes our own trusted Tailwind/CSS source at `next build` time, never untrusted runtime input                                                                                    | Whoever schedules the Next.js 16 upgrade            |
| `uuid` via `exceljs` (missing buffer bounds check in v3/v5/v6 when `buf` is provided)             | Moderate      | Needs `exceljs@3.4.0` — a major version of a production dependency (XLSX report export); a behavior-risk framework bump doesn't belong in a security-review branch | We never call `uuid`'s buffer-based v3/v5/v6 API directly, and `exceljs`'s own usage doesn't pass a `buf` option either                                                                           | Whoever next does a reporting-stack dependency pass |
| `vitest`/`tinypool` (critical, prototype-pollution RCE), `@next/eslint-plugin-next` chain (high)  | Critical/High | Dev-only tooling, needs major bumps (`vitest@5`)                                                                                                                   | Never shipped; not present in the deployed API/worker/web processes                                                                                                                               | Whoever next does a tooling upgrade pass            |

**CI**: added a `Dependency scan` step to `.github/workflows/ci.yml` running
`npm audit --audit-level=high --omit=dev`, with `continue-on-error: true`. Two deliberate
deviations from "just add `npm audit --audit-level=high`," both explained inline in the workflow
file and here:

- `--omit=dev` scopes the gate to what's actually deployed. Dev/build tooling (`vitest`, the
  `eslint-plugin-next` chain) is never shipped, so scanning it is noise, not signal — and without
  this, the gate would be red from the `vitest`/`tinypool` critical alone, for a tool that never
  reaches production.
- `continue-on-error: true` is temporary. Even with `--omit=dev`, the gate still exits non-zero
  today because of the three build-time-only, currently-unfixable findings above (`deepmerge-ts`,
  the `postcss`-via-`next` one, and `uuid`/`exceljs`). `docs/adr/0011` explicitly warned that
  adding `npm audit` without a triage policy "becomes a permanently red step that trains everyone
  to ignore it." This is that triage policy — each finding above is documented, not exploitable in
  production, and owned. `continue-on-error` should come off the moment any one of those three
  advisories closes, so the gate starts actually blocking merges again.

**Dependabot**: added `.github/dependabot.yml` (npm ecosystem, root, weekly) for ongoing tracking
between manual reviews.

## 2. A real, currently-exploitable finding this review found: CSV formula injection

`docs/adr/0011` (§4) explicitly deferred this: _"ValueBooks does not export CSV yet... the
mitigation... belongs in the export writer... recorded as a Phase 9 requirement rather than
implemented against a writer that does not exist."_ CSV export exists now, in four places, and
none of them had the mitigation:

- `report-export.service.ts` (interactive report export)
- `report-artifact.service.ts` (stored/async report artifact, scheduled report delivery)
- `portals.service.ts` (customer portal statement export)
- `audit-log.service.ts` (audit log export)

Each had its own copy-pasted cell-escaping function that did RFC 4180 quoting (commas, quotes,
newlines) but nothing else. A cell value beginning `=`, `+`, `-`, `@`, or a tab — plausible from an
invoice line description, a payee name, a customer display name — executes as a formula the
moment the exported file is opened in Excel or Sheets (CWE-1236 / OWASP CSV injection). XLSX
export is not affected: `ExcelJS`'s `sheet.addRow()` writes plain JS strings as explicitly-typed
string cells, which Excel does not evaluate as formulas.

**Fixed**: one shared `apps/api/src/common/csv-cell.ts#escapeCsvCell`, replacing all four local
copies, prefixing a formula-triggering leading character with a single quote before the existing
RFC 4180 quoting. Covered by a new unit test (`apps/api/test/csv-cell.test.ts`) exercising safe
values, RFC 4180 quoting, formula-prefix injection, and the combination of both.

## 3. Rate limits

Already solid coverage via `AuthRateLimitService` (Redis `INCR`+`EXPIRE`, with an in-memory
fallback if Redis is unreachable):

| Surface                                                    | Limit                                              |
| ---------------------------------------------------------- | -------------------------------------------------- |
| Signup                                                     | 25/hour per IP + 5/hour per IP+email               |
| Login                                                      | 50/15min per IP + **8/15min per (IP, email) pair** |
| Resend verification                                        | 5/hour per IP                                      |
| Verify email                                               | 12/hour per IP                                     |
| Forgot password                                            | 25/hour per IP + 5/hour per IP+email               |
| Reset password                                             | 8/hour per IP                                      |
| Org invite / org create                                    | 60/hour per org, 10/hour per user                  |
| Portal invite preview/accept                               | 10/min                                             |
| Portal document/attachment download                        | 60/min per grant                                   |
| Portal statement export, profile update, attachment upload | 20/min per grant                                   |
| AI ask / explain-number                                    | 30/hour per actor + 100/hour per org               |

**Precision note**: the login limit is commonly described as "8 per account per 15 minutes," but
it is actually keyed by `(ipHash, email)` (`auth.controller.ts:78-82`), not by account alone. A
credential-stuffing attempt rotating source IPs gets a fresh 8-attempt bucket per IP against the
same account — the per-IP 50/15min cap is the only backstop against that. Worth knowing, not
fixed here: a true account-wide lockout would need its own tracked counter independent of IP, and
has its own tradeoffs (a trivial way to lock a victim's account by failing logins from anywhere).

**Fixed in this PR** — two portal write routes had no limit at all, unlike every sibling write
action in the same controller:

- `POST .../documents/:type/:id/comments` → 20/min per grant
- `POST .../quotes/:id/accept` and `.../decline` → 20/min per grant (shared bucket)

Each covered by a new integration test in `apps/api/test/portals.int.test.ts` asserting 429 after
the limit is exceeded.

## 4. Sessions and cookies

Sound design, no changes needed. `security-sessions.tsx` is the UI surface; the backing
implementation:

- Opaque, DB-backed tokens (`apps/api/src/auth/auth.crypto.ts#createOpaqueToken`), not JWTs — the
  raw token lives only in the cookie, only its SHA-256 hash is stored (`Session.tokenHash`).
- Cookie (`session-cookie.ts`): `httpOnly: true`, `sameSite: 'lax'`,
  `secure: NODE_ENV === 'production'`, 30-day `maxAge`.
- Session row: 30-day TTL matching the cookie, daily token rotation on use
  (`SESSION_ROTATION_MS`), a 10-session-per-user cap that revokes the oldest by `lastSeenAt`
  beyond it (`auth.service.ts`).
- Users can list and revoke sessions individually or in bulk (`GET/DELETE /auth/sessions*`).

## 5. CSRF

No explicit CSRF token (no changes made — see below for why). Two layered defenses:

- An Origin-header allowlist middleware (`app-setup.ts:21-31`) 403s any unsafe-method
  (non-GET/HEAD/OPTIONS) request whose `Origin` header doesn't match `WEB_APP_URL`.
- `SameSite=Lax` on the session cookie, plus CORS scoped to the single configured origin with
  `credentials: true` (not a wildcard, not reflecting arbitrary origins).

**Gap, not fixed here**: the Origin check only fires when an `Origin` header is present — a
request with no `Origin` header at all isn't checked by that middleware (though `SameSite=Lax`
still applies). Tightening this to reject unsafe methods with _no_ Origin header in production
would close it, but risks breaking legitimate same-origin traffic that happens to omit the header
(certain proxies, some non-browser clients) without dedicated testing — exactly the kind of change
this review is writing up rather than applying.

## 6. Secrets

- `@valuebooks/config` rejects, in production: missing or localhost `DATABASE_URL`, `REDIS_URL`,
  `S3_ENDPOINT`/`CLAMAV_HOST`; missing `S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`;
  `AI_HOSTED_API_KEY` when `AI_MODE=hosted_limited`; and an `AI_PRIVATE_ENDPOINT` that isn't
  https/host-allowlisted. All covered by existing tests in `packages/config/src/index.test.ts`.
- `SECURITY_PEPPER` additionally has a hard-coded denylist of known default/placeholder values
  (`DEFAULT_SECURITY_PEPPERS`) — stronger than a bare length check.
- **Open question for the owner**: there are no `SMTP_USER`/`SMTP_PASSWORD` config fields at all —
  only `SMTP_HOST`/`SMTP_PORT`/`EMAIL_FROM`. Either the production SMTP relay is genuinely
  unauthenticated/IP-allowlisted by design, or this is a real gap. Not something to guess at in a
  review; needs the owner to confirm intent.
- **Git history**: scanned all 93 commits (`git log --all -p`) for API-key, private-key, and
  password-literal patterns. Only `.env.example` was ever committed (confirmed via
  `git log --all --diff-filter=A -- '*.env' '.env*'`). Every password-shaped match is a synthetic
  test/demo-seed constant (`DEMO_PASSWORD`, `PASSWORD`/`NEW_PASSWORD` in integration tests) — no
  real secret found.

## 7. MFA — decision needed from the security owner

Current state: only the `security.mfa.manage` permission key exists
(`permission-catalog.ts:638`). No TOTP/2FA code anywhere — no schema columns on `User`/`Session`,
no TOTP/QR dependency installed. The product UI already tells users this directly:
`security-sessions.tsx:144-156` shows a "Multi-factor authentication" section badged **Planned**
with the copy _"The identity architecture is MFA-ready. Enrollment will be enabled in a later
security milestone."_

This is genuinely net-new work, not a stub to finish:

| Option                                | Effort                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Risk                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build TOTP for V1**                 | New migration (TOTP secret encrypted at rest, backup-code hashes, enrollment timestamp); a new TOTP dependency (e.g. `otpauth`) plus QR generation; a second login step inserted between password verification and session creation in `auth.service.ts#login`, likely reusing the existing `ActionToken` pattern for the pending-MFA intermediate state; new enroll/verify/recover endpoints; UI beyond today's placeholder badge. Rough: multi-day effort, touches the core login path. | Medium — the core session/opaque-token design doesn't need to change, but any login-path change needs the full integration suite and careful session-rotation/concurrency testing (10-session cap, daily rotation already in play) |
| **Ship without it, document post-V1** | None — already effectively the current state; just make the decision explicit and recorded                                                                                                                                                                                                                                                                                                                                                                                                | Low technical risk; the business risk is launching without MFA for a financial product, which is the actual decision being asked for here                                                                                          |

**Recommendation**: given the current state (permission key + UI placeholder only, zero
scaffolding) and that nothing else in this review found MFA's absence being exploited by a
specific attack this app is otherwise exposed to, defer to post-V1 — but this is explicitly the
owner's call, not a technical one. `docs/PENDING_WORK.md` item 15's MFA sub-task stays unchecked
until that decision is recorded here.

## 8. Sign-off checklist (security owner)

- [ ] MFA decision recorded (§7)
- [ ] SMTP credential gap confirmed intentional or filed as a follow-up (§6)
- [ ] CSRF no-Origin-header gap accepted as-is or scheduled for a dedicated fix (§5)
- [ ] `continue-on-error` removal on the CI dependency-scan step tracked against the three open
      advisories (§1)
- [ ] Reviewed and approved

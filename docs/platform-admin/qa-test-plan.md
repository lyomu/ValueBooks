# Platform Admin: QA test plan

**Scope:** the Platform Admin redesign on `feat/platform-admin-commercial-correctness` (master plan §22).
**Companion documents:** [implementation-backlog.md](implementation-backlog.md) (what was built, with evidence),
[release-checklist.md](release-checklist.md) (the gate), [uat-plan.md](uat-plan.md) (manual acceptance).

## 1. Test layers and where they run

| Layer | What | Where it runs | Command (from the repo root unless noted) |
|---|---|---|---|
| Unit | Pure logic, contracts, UI primitives | Jenkins **Test** | `npm test` |
| Integration | API over HTTP against real Postgres, Redis, S3, ClamAV and Mailpit; authorization, tenant isolation, billing, audit | Jenkins **Test (integration)**, mandatory before merge | `cd apps/api && npx vitest run --config vitest.integration.config.ts [files]` |
| Migration drift | `schema.prisma` matches the migrations | Jenkins **Test (integration)** (first step) | `prisma migrate diff --from-migrations … --exit-code` |
| Browser | `apps/web/e2e/phase12-platform.spec.ts`: access boundary, suspension, flags, read-only investigation pages | **Not in Jenkins** (see §4). Run locally before release. | see §4 |
| Manual acceptance | Layout, accessibility and responsive behaviour; flows that need provider sandbox state | Local drill in progress; focused desktop browser spec 4/4, F1–F16 not signed off | [uat-plan.md](uat-plan.md) |

## 2. Coverage of the master plan's acceptance lists

Status: **Automated** = a named test asserts it. **Browser** = the Playwright spec covers it. **UAT** = needs a
person or a sandbox state. **Gap** = no evidence yet.

### §22.1 Commercial and entitlements

| Criterion | Evidence | Status |
|---|---|---|
| Only the four plans are current; legacy identifiable | `plan-entitlements` (eight official plans ACTIVE; retired plan refused); tracker 4.1 | Automated |
| Prices match across pricing, admin, billing and backend | `plan-entitlements` (stored price, currency, interval); tracker 1.3 (`OFFICIAL_PLAN_CATALOG`, DB == constant) | Automated (backend); public page in UAT |
| Eight Paystack mappings; sandbox and live segregated | Tracker 1.9 (coverage on the Providers page), `platform-plan-code` | Mappings automated; **sandbox/live segregation: UAT** |
| Signatures, idempotent activation and renewal, no duplicates | `billing-enforcement`, `billing-webhook-claim`, `billing-renewals` | Automated |
| Trial: 336 h, no card, never auto-charges | `plan-entitlements` (cardless trial; 336-hour policy) | Automated |
| Trial: reminder 24 h before the end | No test found by name; the F3 fixture puts a trial 24 h from its end with no reminder sent | **Gap → UAT** |
| Trial expiry gives read-only, export and billing access | `billing-enforcement` (read-only matrix, tracker 4.5) | Automated |
| Entitlement caps (Growth: no active projects; Professional: 25 projects) | Tracker 1.1 (Professional unlimited quotes and sales orders); the F7 fixture stands one project below the limit | **Project caps: UAT** |
| Invoice counting and monthly reset on annual plans; archived contacts not counted | No test found by name | **Gap → UAT** |
| Upgrade or downgrade keeps records and historical terms | Tracker 4.x (scheduled downgrade); `billing_transaction_plan_snapshot` | UAT |
| New payments use Paystack; history retained | Webhook retry refuses retired-provider events; reconcile retires the old provider | Automated (refusal); UAT |

### §22.2 Platform Admin functional acceptance

| Criterion | Evidence | Status |
|---|---|---|
| Navigation groups, collapse, active state, mobile drawer, Escape | Tracker 2.1 | UAT (desktop, tablet, mobile) |
| Branding: ValueBooks only, no duplicate logo when collapsed | Tracker 2.1 | UAT |
| Shared primary/secondary cell | Tracker 2.4, 5.x | UAT |
| Overview KPIs documented, scoped, drillable | [metric-dictionary.md](metric-dictionary.md); `platform-operations` (analytics reconcile to direct counts) | Automated + UAT |
| No fake metrics; distinct loading, empty, error and zero | Tracker 3.2g, 5.3–5.5, 2.8 and 3.2e (both closed 2026-10-23) | UAT |
| Organization 360°: lifecycle separate from subscription | Tracker 3.3 | UAT |
| User detail: platform role vs memberships | `platform-operations` (separates platform access from organization roles) | Automated |
| Privileged actions: server authorization, reason, confirmation, audit | `platform-authorization` (every platform route has a role floor), `platform-audit` (actor, event, target, reason for every mutating action) | Automated |
| Billing suite investigates subscriptions, transactions, failures, webhooks, trials, refunds | Tracker 4.3, 4.4 | UAT |
| Flag preview equals runtime | `platform-feature-flags`, `platform-resolution` | Automated |
| Country packs cannot rewrite published versions | `country-packs` | Automated |
| Jobs disclose queue and time scope; retry safe and idempotent | `platform-jobs` (concurrent retries give one reset and one audit), browser spec | Automated + Browser |
| Security and audit show readable titles with the raw evidence | `platform-security-events`, `platform-audit-search`, browser spec | Automated + Browser |

### §22.3 Security and financial release gates

| Gate | Evidence | Status |
|---|---|---|
| Cross-tenant requests denied; roles distinct | `authorization-boundary` (same not-found for another tenant), `platform-authorization`, `tenant-isolation-egress`; browser spec (tenant user kept out of the console) | Automated |
| No secrets, OTPs, keys or bank payloads leaked | `platform-projections` (no tenant financial data on platform reads); `queue-diagnostics` (redacted reasons, no payloads); security events withhold session detail below Superadmin | Automated for these surfaces; **logs: Gap** |
| Payment, refund, replay and quota mutations concurrency-safe | `billing-webhook-claim`, `billing-renewals`, `platform-jobs` | Automated. **Known gaps:** webhook retry audit (tracker 5.x log), O8 |
| Audited changes keep actor, reason, target, time | `platform-audit`, `platform-audit-append-only` (database refuses edits and deletes) | Automated |
| Migrations rehearsed with backup and rollback | [release-checklist.md](release-checklist.md) §2 | **Release step** |
| Financial reports reconcile; recurring value vs cash | [metric-dictionary.md](metric-dictionary.md); tracker 4.3 | UAT |
| Accessible, responsive layouts | Browser passes at 1440px and 390px for every page changed (tracker log) | UAT for tablet and screen readers |
| UAT on representative synthetic tenants | [uat-plan.md](uat-plan.md); the four fixtures a person cannot click are seeded by `npm run uat:fixtures` | **In progress:** owner selected the local drill instead of staging deployment (O9). Desktop console spec 4/4; fixture-by-fixture sign-off remains. Payment scenarios await test-mode credentials; the available root setting is live mode and was not used. |

## 3. Focused checks for a change

Run the narrowest set that covers the change, once, after the change:

- **Platform API:** the matching `platform-*` integration file, plus `platform-authorization` and `platform-projections`
  whenever a route or a response shape changes.
- **Billing:** `billing-enforcement`, `billing-renewals`, `billing-webhook-claim`, `plan-entitlements`.
- **Web:** `npm --workspace @valuebooks/web run typecheck` and `run test`; ESLint and Prettier on the touched files.
- **Shared UI (`packages/ui`):** `npm --workspace @valuebooks/ui run test`, plus a browser look at every consumer of
  the changed primitive.

## 4. Browser tests and Jenkins (task 6.1: documented deferral)

**Decision: the Playwright spec is not added to Jenkins in this branch.** Reasons:

1. **Capacity.** The CI box (`devops-infra/docs/CI_BOX_CAPACITY.md`) runs 6 products on hardware sized for 3, with
   swap 100% used at idle and one executor. The Playwright web server does a production Next build with a 4 GiB
   Node heap, plus the API, on top of the five service containers that Test (integration) already starts. That does
   not fit in the ~4 GiB available.
2. **Unproven in CI.** No browser test has ever run in this pipeline (the Jenkinsfile is still marked "first draft"),
   and a first run would be debugged on the shared box.

**Until it is added, run the spec locally before each release** and record the result in the release checklist:

```sh
# Against an already running stack (dev or a local production build):
cd apps/web
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test phase12-platform --project=desktop
```

Without `PLAYWRIGHT_BASE_URL`, the config builds and starts its own stack on ports 3300 and 3401 against
`valuebooks_e2e`. The spec signs in as the demo users from the demo seed, so it must never be pointed at production.

**Last local run: 2026-10-23, 4/4 passed** (desktop project, against the dev stack). The run left one test flag
`e2e.platform.flag.*` and one suspend/reactivate pair in the local dev database.

**To revisit:** add a manually triggered or release-only stage once the CI box has headroom, or once ValueBooks has a
staging environment the browser stage can target with `PLAYWRIGHT_BASE_URL`, which avoids the build cost on the CI
box.

# Platform Admin: current-state audit (Phase 0)

Audited 2026-10-22 against branch `feat/brand-and-plan-picker` (HEAD `ff1884e`). Each finding is classified as a
**confirmed bug**, **legacy/seed mismatch**, **product gap** or **design refinement**, as spec §20 requires. File
references are relative to the repository root.

## 1. Routing and hosts

- **One Next.js app.** Hostname routing lives in `apps/web/src/proxy.ts`. This Next version uses the `proxy` convention, not
  `middleware.ts`. Host origins come from `NEXT_PUBLIC_{MARKETING,APP,CONSOLE}_URL` (`apps/web/src/lib/site-hosts.ts`).
  - `/platform*` → console host; marketing paths → marketing host; everything else → app host.
  - On the console host, `/` redirects to `/platform`.
- **Host routing is presentation only.** Authorization is enforced server-side by `PlatformGuard`.
- **One admin route tree:** `apps/web/src/app/platform/*`. There is no `/admin` tree and no duplicate legacy tree.

| Route | Component |
|---|---|
| `/platform` | `PlatformOverview` (`components/platform-overview.tsx`) |
| `/platform/organizations[/id]` | `platform-organizations.tsx` |
| `/platform/users[/id]` | `platform-users.tsx` |
| `/platform/plans`, `/platform/feature-flags` | `platform-catalog.tsx` |
| `/platform/country-packs` | `platform-country-packs.tsx` |
| `/platform/jobs`, `/security`, `/audit` | `platform-operations.tsx` |
| `/platform/billing` + 11 sub-pages | `platform-billing-overview.tsx`, `platform-billing.tsx` |

## 2. Backend

- **Module:** `apps/api/src/platform/` (`platform.controller.ts`, `platform-billing.controller.ts`).
- **Services:**
  - `platform-access`, `platform-tenants`, `platform-catalog`, `platform-operations`, `platform-billing`.
  - `entitlements`, `hosted-ai-egress-approval`.
  - Country packs: `apps/api/src/organizations/country-pack.admin.service.ts`.
- **Access control:** see [permissions-matrix.md](permissions-matrix.md).
- **Audit:** `PlatformAuditEvent` written in the same transaction by `platform-audit.ts`. Billing audit is the
  `billing.*` key prefix of the same table.
- **Security events:** the `SecurityEvent` model, with `severity` as free text (`INFO`, `WARNING`, …).
  - Emitted from `auth.service.ts`: `auth.login_failed`, MFA events, signup and verification events.
  - Emitted from organization services: member, invitation, period, ledger and tax events.
- **Queues (BullMQ):**
  - Queues: `automation`, `email-delivery`, `document-extraction`. All use `attempts: 5`, exponential backoff and
    `removeOnFail: false`.
  - The scheduler poller runs every 30s.
- **Feature flags:** precedence is organization → plan → country → global → default (`entitlements.service.ts:234`).
  Preview and runtime use the same `resolveFlag`, and nothing is cached.
- **Country packs:** `DRAFT → PUBLISHED → DEPRECATED`. Only drafts can be edited or deleted. Publishing is audited in the
  same transaction.
- **Lifecycles:**
  - Organizations: `DRAFT | ACTIVE | SUSPENDED`. Suspension requires a reason and deletes nothing.
  - Users: `PENDING_VERIFICATION | ACTIVE | SUSPENDED | CLOSED`. Any status other than ACTIVE revokes sessions.
  - Subscriptions: `TRIALING | TRIAL_EXPIRED | ACTIVE | PAST_DUE | CANCEL_SCHEDULED | CANCELLED`. This dimension is
    independent of organization status, which spec §8.4 already requires.

## 3. Commercial

See [plan-source-of-truth-audit.md](plan-source-of-truth-audit.md).

## 4. UI and design system

- **Shared library** (`packages/ui`):
  - Tables: `DataTable`, `PrimarySecondaryCell`, `DataTableToolbar/Search/Filters`, `RowActionMenu`.
  - Display: `StatusBadge`, `StatCard`, `PageHeader`, `Tabs`.
  - Overlays: `Dialog`/`DrawerContent`, `Dropdown`.
  - States: `EmptyState`/`ErrorState`/`ForbiddenState`, skeleton family, `Toast`.
  - Tokens: `tokens.css`. There is no Tailwind.
- **Admin duplicates of shared primitives** (design refinement):
  - `StatusPill`, `Row`, `Pager` (`platform-organizations.tsx:486-527`), imported by the users and operations pages.
  - `PlatformPage` (`platform-shell.tsx:354`) duplicates `PageHeader`.
  - `.rb-platform__stat` tiles and the overview `Metric/Panel/Distribution/Funnel/Bars` stand in for `StatCard`.
  - Loading and empty states are plain text.
  - Actions are inline forms instead of `Dialog`: billing trial-extend/retry, country-pack lifecycle confirmation,
    and three forms per feature-flag card.
  - A global `.rb-platform button` rule (`apps/web/src/app/styles.css` ~5673) restyles every button, including the
    shared `Button`.
- **Shell** (`platform-shell.tsx`):
  - Nav groups are "Workspace" and "Administration", with Billing collapsible.
  - The collapse chevron sits in the sidebar, and there is **no logo in the sidebar** when collapsed.
  - The header logo alt text is already "ValueBooks". The tab title is "Platform console | ValueBooks".
- **Duplicate session fetch:** every page that needs the role calls `usePlatformSession()` again, re-fetching
  `/platform/me`.

## 5. Defects and drift

| ID | Class | Finding | Location |
|---|---|---|---|
| D1 | **Confirmed bug (P0)** | Professional `quotes.max` and `sales_orders.enabled` are seeded `enabled=false, limit NULL`, and the resolver turns that into 0. Professional subscribers and every trial are blocked from quotes and sales orders, while Growth gets 50. | `migrations/20261014070000_seed_official_plan_catalog` L123-124; `apps/api/src/billing/usage-metering.service.ts:95` |
| D2 | **Confirmed bug (P0)** | The workflows gate checks `automation.enabled`, a key that exists only on retired placeholder plans, so it fails open for everyone. | `apps/api/src/automation/workflows.service.ts:54` |
| D3 | Legacy mismatch (P1) | The admin plan list returns RETIRED placeholders with no status filter, and the page renders them as current cards. Admin assign-plan accepts RETIRED plans and uses `plan.trialDays`. | `platform-catalog.service.ts:29`; `platform-tenants.service.ts:311` |
| D4 | Confirmed bug (P1) | Marketing prices are hand-typed, and the copy says invoices are "Unlimited" on every tier. The database caps them at 5/20/100/∞. | `apps/web/src/components/marketing/pricing-data.ts` |
| D5 | Confirmed bug (P1) | Contract `subscriptionStatusSchema` is missing TRIAL_EXPIRED and CANCEL_SCHEDULED. `platformPlanSchema` is missing the tier, most-popular and provider fields. | `packages/contracts/src/index.ts` |
| D6 | Confirmed bug (P0, security) | The webhook verifies re-serialised JSON when the raw body is missing. Two concurrent duplicate deliveries can both pass the PROCESSED check. | `billing-webhook.controller.ts:25`; `billing-webhook.service.ts` |
| D7 | Confirmed bug (P1) | If the Professional plan row is missing, signup silently creates no subscription. That organization is unlimited and never becomes read-only. | `apps/api/src/organizations/organization.service.ts` |
| D8 | Product gap (P1) | Paystack plan codes exist only in a handover doc. The admin cannot view or set `providerPriceId` from the UI. | `docs/DEPLOYMENT_HANDOVER_PAYSTACK.md` |
| D9 | Confirmed gap (P1) | The platform audit table is append-only by convention only. The `PlatformAdmin` foreign key cascades on delete. | `apps/api/prisma/schema.prisma` (`PlatformAuditEvent`) |
| D10 | Design refinement (P1) | Jobs page scopes are unlabeled. "Email failed" is the all-time BullMQ failed count; "Failed (24h)" is database scheduled executions only. | `platform-operations.service.ts:43-60` |
| D11 | Design refinement (P2) | Mojibake `â€”` on the flags page. | `apps/web/src/components/platform-catalog.tsx:456` |
| D12 | **Confirmed bug (P1, billing records), found 2026-10-22 in 4.5** | Paystack **renewal** payments are never applied. A renewal `charge.success` carries `customer`, `authorization` and `plan` but no `subscription_code` and no checkout metadata ([Paystack: Subscriptions](https://paystack.com/docs/payments/subscriptions/)). `normalizePaystackEvent` maps only `customer_code` and `metadata.clientReference`, and `applyToSubscription` needs a subscription code, a pending change or intent, or a client reference, so the renewal matches no subscription: a warning is logged and the event is marked **PROCESSED**. The follow-up `invoice.update`, which does carry `subscription.subscription_code`, falls to `default: {}`. Characterized against the real webhook service: after a renewal, 0 `BillingTransaction` rows, `lastPaymentAt` and `currentPeriodEnd` unchanged, event PROCESSED. **Effect:** customers keep access (ACTIVE never expires on period end), but renewal cash is missing from transactions, collections and revenue analytics, paid-through dates go stale, and "renewal upcoming" notices refer to the old date. **Fixed 2026-10-22 (owner approved, O6):** paid `invoice.update` is applied by subscription code; a renewal `charge.success` is matched by customer + plan code to exactly one linked subscription and refused when several fit; both keep the existing amount and currency checks and record one transaction per charge reference. Past drops are listed by the read-only [dropped-renewals report](runbooks/dropped-renewals-report.md); nothing is backfilled without approval. | `apps/api/src/billing/billing-webhook.controller.ts` (`normalizePaystackEvent`), `billing-webhook.service.ts` (`applyToSubscription`) |

## 6. Tests and CI

- **API:** `npm test` runs unit tests; `npm run test:integration` needs Postgres and Redis. The platform suites are
  `platform-authorization` (a route sweep), `-audit`, `-operations`, `-projections`, `-resolution`, `country-packs`,
  `phase13-feature-flags` and `plan-selection`. There are no billing-dedicated suites.
- **Web:** vitest, plus Playwright `e2e/phase12-platform.spec.ts`. Jenkins does not run the Playwright spec.
- **Jenkins stages:** Lint → Typecheck → Test → Test (integration) → images → smoke → approval → deploy.

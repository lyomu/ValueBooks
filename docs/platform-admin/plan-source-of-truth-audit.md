# Plan source-of-truth audit (Phase 0)

Audited 2026-10-22.

## Authority

The **database is the only billing authority**:
- The `plans` and `plan_entitlements` tables (Prisma `Plan` and `PlanEntitlement`).
- `GET /billing/plans` (`apps/api/src/billing/billing.service.ts`), which serves active plans only.
- Enforcement through `UsageMeteringService` (`apps/api/src/billing/usage-metering.service.ts`).

Plans are created only by migrations. The seed scripts create none.

| Migration | Effect |
|---|---|
| `20260908180000_add_phase12_platform_admin` | Placeholder `free` / `growth` / `scale` rows (price default 0, old entitlement keys, zero subscribers) |
| `20261014070000_seed_official_plan_catalog` | Retires the placeholders; inserts the 8 official rows and 27 entitlement keys per tier |
| `20261014080000_correct_advanced_unlimited_entitlements` | Fixes Advanced unlimited rows that were stored as disabled |
| `20261016100000_consolidate_paystack_billing` | Paystack only; clears Starter's old Paddle IDs; refuses to deploy while live Paddle subscriptions exist |

## Official catalog (DB rows match spec §4.1)

| Tier | Monthly (minor USD) | Yearly (minor USD) | Flags |
|---|---:|---:|---|
| Starter | 100 | 1,000 | default |
| Growth | 499 | 5,500 | |
| Professional | 999 | 10,000 | most popular |
| Advanced | 2,000 | 22,000 | |

All eight rows are PAYSTACK with `trialDays` 14. The quantitative limits match spec §4.2 exactly.

**Exceptions** (keys outside the §4.2 matrix):
- `quotes.max` / `sales_orders.enabled` on Professional are stored disabled and resolve to 0 (D1). The owner decided on
  2026-10-22 that these are unlimited.
- `automation.enabled` is missing from every official tier, so the workflows gate fails open (D2). The owner decided
  that this is Advanced only, through `approval_workflows.enabled`.

## Entitlement resolution

`resolveLimit` (`usage-metering.service.ts:76`) resolves a limit in this order:
1. An active override.
2. No subscription → unlimited (fails open; see D7).
3. Trial AI → 10.
4. A missing key → unlimited.
5. `enabled=false` → 0.
6. Otherwise `limitValue`, where NULL means unlimited.

## Trial

- `organization.service.ts:495-570` puts the organization on TRIALING with the Professional monthly plan for a fixed
  336 hours. The user's pick is kept in `intendedPlanId`.
- The reminder fires 24h before the end, and expiry is enforced (`trial-lifecycle.service.ts`, `billing-maintenance.service.ts`).
- Read-only after expiry is enforced in `organization.guard.ts:55-78`.

## Other copies of plan data (consumers)

| Location | Content | Risk |
|---|---|---|
| `apps/web/src/components/marketing/pricing-data.ts` | Hand-typed prices, taglines, feature groups | Drift; "unlimited invoices" copy is wrong (D4) |
| `apps/web/src/components/plan-picker.tsx` | Prices from the API, copy and ordering from `pricing-data` | Low |
| `apps/api/src/billing/billing-provider.ts` `BILLING_PROVIDER_ROUTING` | 4 tiers → PAYSTACK | Low |
| `billing.service.ts` `tierOrder`, `organization.service.ts` trial `tierKey: 'professional'` | Tier ordering, trial tier | Low |
| `billing-settings.tsx`, `billing-upgrade-prompt.tsx` | Entitlement display labels | Low |

## Paystack

- **Plan codes** (`PLN_…`) are recorded only in `docs/DEPLOYMENT_HANDOVER_PAYSTACK.md`. They must be stored in
  `plans.provider_price_id`. Checkout is blocked for any plan without one.
- **Checkout** fetches the Paystack plan first and refuses to charge if the amount, currency or interval differs from
  the DB row. Production checkout also requires `BILLING_LIVE_CHECKOUT_ENABLED=true`.
- **Webhooks** are verified with HMAC-SHA512 over the raw body using a timing-safe compare. Event IDs are a SHA-256 of
  the raw body. Remaining weaknesses are tracked as D6.
- **Paddle** has no active code paths. The enum value, legacy guards and labels stay as historical evidence.

## Production status

The owner reports that the admin Plans screenshot showing only Free/Growth/Scale came from production. The two
possible explanations:
- **The 10-14 migrations have not been applied in production.** The next deploy would then retire the placeholders and
  seed the official catalog.
- **The migrations ran but the page showed retired rows.** This is not possible with the screenshot as described,
  because the eight official rows would also appear.

Run the read-only check in [runbooks/plan-catalog-verification.md](runbooks/plan-catalog-verification.md) before any
Phase 1 deploy.

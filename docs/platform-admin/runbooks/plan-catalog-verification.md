# Runbook: production plan-catalog verification (read-only)

**Purpose:** confirm which plan catalog production actually serves before deploying any Phase 1 commercial fix. The
owner reported that the admin Plans page in production shows only the Free/Growth/Scale placeholders at $0.00.
**Safety:** every statement runs inside `BEGIN READ ONLY … ROLLBACK`. Postgres rejects any write, and nothing is changed.
**Who:** owner or ops, with production database access.

## Run

Start a `psql` session against the production database. Follow the access steps in `docs/BACKUP_RESTORE_RUNBOOK.md`,
for example `docker exec -it <postgres-container> psql -U <user> -d <db>`. Then paste:

```sql
BEGIN READ ONLY;

-- 1. Which billing-catalog migrations have been applied?
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name IN (
  '20260908180000_add_phase12_platform_admin',
  '20261014070000_seed_official_plan_catalog',
  '20261014080000_correct_advanced_unlimited_entitlements',
  '20261016100000_consolidate_paystack_billing'
)
ORDER BY migration_name;

-- 2. Every plan row with its status and subscriber count.
SELECT p.key, p.tier_key, p.status, p.is_default, p.price_minor, p.currency, p.billing_interval,
       p.billing_provider, p.provider_price_id,
       (SELECT count(*) FROM organization_subscriptions s WHERE s.plan_id = p.id) AS subscribers
FROM plans p
ORDER BY p.status, p.sort_order, p.key;

-- 3. Expected official catalog vs. actual (empty result = all eight match).
SELECT e.key, e.price_minor AS expected_price, p.price_minor AS actual_price,
       e.code AS expected_code, p.provider_price_id AS actual_code, p.status, p.billing_provider
FROM (VALUES
  ('starter_monthly',       100, 'PLN_a18l1jcni5xxcht'),
  ('starter_yearly',       1000, 'PLN_3bnv6vi7fjfxgvp'),
  ('growth_monthly',        499, 'PLN_h3rt0m0ocx48kqn'),
  ('growth_yearly',        5500, 'PLN_0dhscgqxzditary'),
  ('professional_monthly',  999, 'PLN_ew8fgqz9ejmfvxg'),
  ('professional_yearly', 10000, 'PLN_iol6chdqm1q0oj3'),
  ('advanced_monthly',     2000, 'PLN_rrmvw1cm6s631ir'),
  ('advanced_yearly',     22000, 'PLN_r85biwnmgccvfbb')
) AS e(key, price_minor, code)
LEFT JOIN plans p ON p.key = e.key
WHERE p.id IS NULL
   OR p.price_minor <> e.price_minor
   OR p.provider_price_id IS DISTINCT FROM e.code
   OR p.status <> 'ACTIVE'
   OR p.billing_provider IS DISTINCT FROM 'PAYSTACK';

-- 4. Subscriptions by plan status and subscription status (anything on a RETIRED plan needs review).
SELECT p.status AS plan_status, p.key, s.status AS subscription_status, s.billing_provider, count(*)
FROM organization_subscriptions s JOIN plans p ON p.id = s.plan_id
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3;

-- 5. Organizations with no subscription row (these resolve as unlimited; see defect D7).
SELECT count(*) AS organizations_without_subscription
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_subscriptions s WHERE s.organization_id = o.id);

-- 6. Professional quotes / sales-orders rows (defect D1; expect enabled=false before the fix).
SELECT p.key, e.key, e.enabled, e.limit_value
FROM plan_entitlements e JOIN plans p ON p.id = e.plan_id
WHERE p.tier_key = 'professional' AND e.key IN ('quotes.max', 'sales_orders.enabled');

ROLLBACK;
```

## Interpret

| Observation | Meaning | Next step |
|---|---|---|
| Query 1 lists only `20260908180000` | The billing catalog migrations were never deployed | The next deploy applies them: it retires the placeholders and seeds the official catalog. **Before deploying**, check that no live Paddle subscriptions exist, or the `20261016100000` migration will refuse to run. Then set the Paystack codes (query 3) and keep `BILLING_LIVE_CHECKOUT_ENABLED=false` until they are verified. |
| All four migrations applied, query 3 empty | The catalog is correct | The screenshot is stale or from another environment. Only the UI fix (task 4.1) is needed. |
| Query 3 shows `actual_code` NULL | Paystack codes are not configured, so checkout is blocked for those plans | Configure the codes through the controlled path (task 4.2), or through an approved, audited DB update. |
| Query 4 shows rows on RETIRED plans | Real subscribers are attached to legacy tiers | **Stop.** Escalate to the product owner with the list. Do not remap without approval (spec §4.4). |
| Query 5 > 0 | Some organizations have no subscription and are uncapped | Investigate before task 1.7 ships. Do not auto-create trials or charges. |

Record the date, who ran the check and the summarized output in `implementation-backlog.md` under task 1.0. Omit
organization identifiers.

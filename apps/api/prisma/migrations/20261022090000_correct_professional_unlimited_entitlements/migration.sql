-- The official catalog seeded Professional's quotes and sales orders as `enabled = false` with a
-- NULL limit, intending "unlimited". The quota resolver reads a disabled entitlement as 0, so every
-- Professional subscriber -- and every cardless trial, which runs on Professional -- was blocked
-- from quotes and sales orders while Growth allowed 50 of each. Product-owner decision 2026-10-22:
-- both are unlimited on Professional. Same correction pattern as
-- 20261014080000_correct_advanced_unlimited_entitlements; idempotent and scoped to the two rows.
UPDATE "plan_entitlements" AS entitlement
SET "enabled" = true, "updated_at" = now()
FROM "plans" AS plan
WHERE entitlement."plan_id" = plan."id"
  AND plan."tier_key" = 'professional'
  AND entitlement."enabled" = false
  AND entitlement."limit_value" IS NULL
  AND entitlement."key" IN ('quotes.max', 'sales_orders.enabled');

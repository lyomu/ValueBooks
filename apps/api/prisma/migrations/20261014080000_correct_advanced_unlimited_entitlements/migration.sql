-- The catalog uses NULL limit_value for unlimited resources. The original Advanced rows
-- mistakenly marked those resources disabled, which made the quota resolver return zero.
UPDATE "plan_entitlements" AS entitlement
SET "enabled" = true, "updated_at" = now()
FROM "plans" AS plan
WHERE entitlement."plan_id" = plan."id"
  AND plan."tier_key" = 'advanced'
  AND entitlement."enabled" = false
  AND entitlement."limit_value" IS NULL
  AND entitlement."key" IN (
    'customers.active.max', 'invoices.issued.max', 'expenses.max', 'vendors.max',
    'bills.enabled', 'purchase_orders.enabled', 'products.max', 'bank_accounts.max',
    'warehouses.enabled', 'projects.enabled', 'reports.saved.enabled',
    'quotes.max', 'sales_orders.enabled'
  );

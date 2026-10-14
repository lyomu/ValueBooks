-- Replace the Phase-12 placeholder catalog (free/growth/scale, all $0, zero subscribers — verified
-- before writing this migration) with the eight official commercial plan rows: four tiers x two
-- billing intervals, per the approved pricing in the billing/subscriptions specification.
-- Retire rather than delete the placeholders, so any future historical query against `plans` by id
-- still resolves.
UPDATE "plans" SET "status" = 'RETIRED', "is_default" = false WHERE "key" IN ('free', 'growth', 'scale');

INSERT INTO "plans"
  ("key", "tier_key", "name", "description", "status", "is_default", "is_most_popular",
   "trial_days", "price_minor", "currency", "billing_interval", "billing_provider", "sort_order")
VALUES
  ('starter_monthly', 'starter', 'Starter',
   'For solo owners getting invoices and expenses organized.',
   'ACTIVE', true, false, 14, 100, 'USD', 'MONTHLY', 'PADDLE', 10),
  ('starter_yearly', 'starter', 'Starter',
   'For solo owners getting invoices and expenses organized.',
   'ACTIVE', false, false, 14, 1000, 'USD', 'YEARLY', 'PADDLE', 11),
  ('growth_monthly', 'growth', 'Growth',
   'For small teams who need banking and multi-user access.',
   'ACTIVE', false, false, 14, 499, 'USD', 'MONTHLY', 'PAYSTACK', 20),
  ('growth_yearly', 'growth', 'Growth',
   'For small teams who need banking and multi-user access.',
   'ACTIVE', false, false, 14, 5500, 'USD', 'YEARLY', 'PAYSTACK', 21),
  ('professional_monthly', 'professional', 'Professional',
   'For growing businesses that need deeper reporting and roles.',
   'ACTIVE', false, true, 14, 999, 'USD', 'MONTHLY', 'PAYSTACK', 30),
  ('professional_yearly', 'professional', 'Professional',
   'For growing businesses that need deeper reporting and roles.',
   'ACTIVE', false, true, 14, 10000, 'USD', 'YEARLY', 'PAYSTACK', 31),
  ('advanced_monthly', 'advanced', 'Advanced',
   'For established businesses with complex workflows.',
   'ACTIVE', false, false, 14, 2000, 'USD', 'MONTHLY', 'PAYSTACK', 40),
  ('advanced_yearly', 'advanced', 'Advanced',
   'For established businesses with complex workflows.',
   'ACTIVE', false, false, 14, 22000, 'USD', 'YEARLY', 'PAYSTACK', 41)
ON CONFLICT ("key") DO NOTHING;

-- Entitlements are a property of the commercial tier, not the billing interval, so the same grants
-- are written for a tier's monthly and yearly rows alike.
--
-- Convention: a numeric entitlement uses key suffix ".max" with `limit_value` = the cap, or NULL for
-- unlimited; `enabled = false` with `limit_value = 0` means the resource is not included on that
-- tier at all (distinct from NULL/unlimited). A boolean entitlement uses suffix ".enabled" with
-- `limit_value` left NULL.
INSERT INTO "plan_entitlements" ("plan_id", "key", "enabled", "limit_value")
SELECT plans.id, grants.key, grants.enabled, grants.limit_value
FROM "plans"
CROSS JOIN LATERAL (
  VALUES
    -- Starter
    ('starter', 'customers.active.max', true, 10),
    ('starter', 'invoices.issued.max', true, 5),
    ('starter', 'seats.max', true, 1),
    ('starter', 'expenses.max', true, 20),
    ('starter', 'vendors.max', true, 10),
    ('starter', 'bills.enabled', false, 0),
    ('starter', 'purchase_orders.enabled', false, 0),
    ('starter', 'products.max', true, 20),
    ('starter', 'bank_accounts.max', true, 1),
    ('starter', 'warehouses.enabled', false, 0),
    ('starter', 'projects.enabled', false, 0),
    ('starter', 'reports.saved.enabled', false, 0),
    ('starter', 'reports.scheduled.enabled', false, 0),
    ('starter', 'ai_insights.max', false, 0),
    ('starter', 'quotes.max', true, 5),
    ('starter', 'sales_orders.enabled', false, 0),
    ('starter', 'recurring_invoices.enabled', false, NULL),
    ('starter', 'manual_journals.enabled', false, NULL),
    ('starter', 'bank_reconciliation.enabled', false, NULL),
    ('starter', 'multi_currency.enabled', false, NULL),
    ('starter', 'stock_tracking.enabled', false, NULL),
    ('starter', 'multiple_warehouses.enabled', false, NULL),
    ('starter', 'timesheets.enabled', false, NULL),
    ('starter', 'approval_workflows.enabled', false, NULL),
    ('starter', 'custom_roles.enabled', false, NULL),
    ('starter', 'cash_flow_reporting.enabled', false, NULL),
    ('starter', 'advanced_financial_reports.enabled', false, NULL),

    -- Growth
    ('growth', 'customers.active.max', true, 50),
    ('growth', 'invoices.issued.max', true, 20),
    ('growth', 'seats.max', true, 2),
    ('growth', 'expenses.max', true, 150),
    ('growth', 'vendors.max', true, 100),
    ('growth', 'bills.enabled', true, 100),
    ('growth', 'purchase_orders.enabled', true, 50),
    ('growth', 'products.max', true, 200),
    ('growth', 'bank_accounts.max', true, 3),
    ('growth', 'warehouses.enabled', true, 1),
    ('growth', 'projects.enabled', false, 0),
    ('growth', 'reports.saved.enabled', true, 5),
    ('growth', 'reports.scheduled.enabled', false, 0),
    ('growth', 'ai_insights.max', false, 0),
    ('growth', 'quotes.max', true, 50),
    ('growth', 'sales_orders.enabled', true, 50),
    ('growth', 'recurring_invoices.enabled', true, NULL),
    ('growth', 'manual_journals.enabled', true, NULL),
    ('growth', 'bank_reconciliation.enabled', true, NULL),
    ('growth', 'multi_currency.enabled', false, NULL),
    ('growth', 'stock_tracking.enabled', true, NULL),
    ('growth', 'multiple_warehouses.enabled', false, NULL),
    ('growth', 'timesheets.enabled', false, NULL),
    ('growth', 'approval_workflows.enabled', false, NULL),
    ('growth', 'custom_roles.enabled', false, NULL),
    ('growth', 'cash_flow_reporting.enabled', true, NULL),
    ('growth', 'advanced_financial_reports.enabled', false, NULL),

    -- Professional
    ('professional', 'customers.active.max', true, 100),
    ('professional', 'invoices.issued.max', true, 100),
    ('professional', 'seats.max', true, 5),
    ('professional', 'expenses.max', true, 1000),
    ('professional', 'vendors.max', true, 1000),
    ('professional', 'bills.enabled', true, 500),
    ('professional', 'purchase_orders.enabled', true, 250),
    ('professional', 'products.max', true, 2000),
    ('professional', 'bank_accounts.max', true, 10),
    ('professional', 'warehouses.enabled', true, 3),
    ('professional', 'projects.enabled', true, 25),
    ('professional', 'reports.saved.enabled', true, 25),
    ('professional', 'reports.scheduled.enabled', true, 5),
    ('professional', 'ai_insights.max', true, 30),
    ('professional', 'quotes.max', false, NULL),
    ('professional', 'sales_orders.enabled', false, NULL),
    ('professional', 'recurring_invoices.enabled', true, NULL),
    ('professional', 'manual_journals.enabled', true, NULL),
    ('professional', 'bank_reconciliation.enabled', true, NULL),
    ('professional', 'multi_currency.enabled', true, NULL),
    ('professional', 'stock_tracking.enabled', true, NULL),
    ('professional', 'multiple_warehouses.enabled', true, NULL),
    ('professional', 'timesheets.enabled', true, NULL),
    ('professional', 'approval_workflows.enabled', false, NULL),
    ('professional', 'custom_roles.enabled', false, NULL),
    ('professional', 'cash_flow_reporting.enabled', true, NULL),
    ('professional', 'advanced_financial_reports.enabled', true, NULL),

    -- Advanced
    ('advanced', 'customers.active.max', false, NULL),
    ('advanced', 'invoices.issued.max', false, NULL),
    ('advanced', 'seats.max', true, 10),
    ('advanced', 'expenses.max', false, NULL),
    ('advanced', 'vendors.max', false, NULL),
    ('advanced', 'bills.enabled', false, NULL),
    ('advanced', 'purchase_orders.enabled', false, NULL),
    ('advanced', 'products.max', false, NULL),
    ('advanced', 'bank_accounts.max', false, NULL),
    ('advanced', 'warehouses.enabled', false, NULL),
    ('advanced', 'projects.enabled', false, NULL),
    ('advanced', 'reports.saved.enabled', false, NULL),
    ('advanced', 'reports.scheduled.enabled', true, NULL),
    ('advanced', 'ai_insights.max', true, 150),
    ('advanced', 'quotes.max', false, NULL),
    ('advanced', 'sales_orders.enabled', false, NULL),
    ('advanced', 'recurring_invoices.enabled', true, NULL),
    ('advanced', 'manual_journals.enabled', true, NULL),
    ('advanced', 'bank_reconciliation.enabled', true, NULL),
    ('advanced', 'multi_currency.enabled', true, NULL),
    ('advanced', 'stock_tracking.enabled', true, NULL),
    ('advanced', 'multiple_warehouses.enabled', true, NULL),
    ('advanced', 'timesheets.enabled', true, NULL),
    ('advanced', 'approval_workflows.enabled', true, NULL),
    ('advanced', 'custom_roles.enabled', true, NULL),
    ('advanced', 'cash_flow_reporting.enabled', true, NULL),
    ('advanced', 'advanced_financial_reports.enabled', true, NULL)
) AS grants(tier_key, key, enabled, limit_value)
WHERE plans.tier_key = grants.tier_key
ON CONFLICT ("plan_id", "key") DO NOTHING;

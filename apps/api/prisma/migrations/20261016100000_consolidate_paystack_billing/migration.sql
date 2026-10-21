-- Paystack is the sole active provider. Historical provider references remain in subscriptions,
-- transactions, refunds and webhook audit records for accounting and reconciliation.
--
-- Do not silently retire a live legacy subscription: deployment stops if one exists so operations
-- can cancel or replace it under the approved controlled process before removing its adapter.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "organization_subscriptions"
    WHERE "billing_provider" = 'PADDLE'
      AND "status" IN ('ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED')
  ) THEN
    RAISE EXCEPTION 'Active Paddle subscriptions must be reconciled before Paystack-only deployment';
  END IF;
END $$;

-- Starter's old Paddle identifiers must never be interpreted as Paystack plan codes. They are
-- cleared so an operator must set distinct Paystack monthly/yearly plan codes through the existing
-- secured Platform Admin plan configuration before checkout becomes available.
UPDATE "plans"
SET "billing_provider" = 'PAYSTACK',
    "provider_product_id" = NULL,
    "provider_price_id" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "key" IN ('starter_monthly', 'starter_yearly')
  AND "status" = 'ACTIVE';

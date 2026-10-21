ALTER TABLE "billing_transactions"
  ADD COLUMN "plan_id" UUID,
  ADD COLUMN "plan_name_snapshot" VARCHAR(120),
  ADD COLUMN "billing_interval_snapshot" "BillingInterval";

CREATE INDEX "billing_transactions_plan_id_created_at_idx" ON "billing_transactions" ("plan_id", "created_at");

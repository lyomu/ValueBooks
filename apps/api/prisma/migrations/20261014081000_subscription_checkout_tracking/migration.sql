ALTER TABLE "subscription_changes"
  ADD COLUMN "idempotency_key" VARCHAR(120),
  ADD COLUMN "provider_checkout_id" VARCHAR(160),
  ADD COLUMN "checkout_url" VARCHAR(1000),
  ADD COLUMN "prior_provider_subscription_id" VARCHAR(160),
  ADD COLUMN "replacement_provider_subscription_id" VARCHAR(160),
  ADD COLUMN "old_cancellation_status" VARCHAR(40);

CREATE UNIQUE INDEX "subscription_changes_organization_id_idempotency_key_key"
  ON "subscription_changes" ("organization_id", "idempotency_key");

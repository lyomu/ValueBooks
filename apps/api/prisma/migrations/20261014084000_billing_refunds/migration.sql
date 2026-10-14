CREATE TYPE "BillingRefundStatus" AS ENUM ('REQUESTED', 'REJECTED', 'SUBMITTED', 'COMPLETED', 'FAILED');
CREATE TABLE "billing_refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "transaction_id" UUID NOT NULL REFERENCES "billing_transactions"("id") ON DELETE RESTRICT,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "BillingRefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "approval_reason" VARCHAR(500),
  "provider_reference" VARCHAR(160),
  "provider_status" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "billing_refunds_status_created_at_idx" ON "billing_refunds"("status", "created_at");
CREATE INDEX "billing_refunds_transaction_id_idx" ON "billing_refunds"("transaction_id");

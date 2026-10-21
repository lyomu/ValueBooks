CREATE TYPE "BillingOverrideStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED');
CREATE TABLE "billing_entitlement_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "entitlement_key" VARCHAR(60) NOT NULL,
  "limit_value" INTEGER,
  "unlimited" BOOLEAN NOT NULL DEFAULT FALSE,
  "enabled" BOOLEAN,
  "status" "BillingOverrideStatus" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(500) NOT NULL,
  "requested_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "effective_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "billing_entitlement_overrides_org_key_idx" ON "billing_entitlement_overrides"("organization_id", "entitlement_key", "status", "effective_at", "expires_at");

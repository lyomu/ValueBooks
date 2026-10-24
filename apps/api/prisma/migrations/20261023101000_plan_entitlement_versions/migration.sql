-- Existing subscriptions remain NULL, meaning the current published plan projection.
-- A first publication captures that projection as version 1 and pins the existing audience.
CREATE TYPE "PlanEntitlementVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TABLE "plan_entitlement_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PlanEntitlementVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMPTZ(6),
  "published_by_platform_admin_id" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_entitlement_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_entitlement_versions_plan_id_version_key" ON "plan_entitlement_versions"("plan_id", "version");
CREATE INDEX "plan_entitlement_versions_plan_id_status_idx" ON "plan_entitlement_versions"("plan_id", "status");
ALTER TABLE "plan_entitlement_versions" ADD CONSTRAINT "plan_entitlement_versions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_entitlement_versions" ADD CONSTRAINT "plan_entitlement_versions_published_by_platform_admin_id_fkey"
  FOREIGN KEY ("published_by_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "plan_entitlement_values" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "key" VARCHAR(60) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limit_value" INTEGER,
  CONSTRAINT "plan_entitlement_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_entitlement_values_version_id_key_key" ON "plan_entitlement_values"("version_id", "key");
ALTER TABLE "plan_entitlement_values" ADD CONSTRAINT "plan_entitlement_values_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "plan_entitlement_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_subscriptions" ADD COLUMN "entitlement_version_id" UUID;
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_entitlement_version_id_fkey"
  FOREIGN KEY ("entitlement_version_id") REFERENCES "plan_entitlement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
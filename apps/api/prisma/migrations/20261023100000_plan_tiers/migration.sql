-- Durable commercial tiers, including public presentation copy. Existing plan keys are
-- preserved; every distinct tier is backfilled before the restrictive foreign key is added.
CREATE TABLE "plan_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
  "is_most_popular" BOOLEAN NOT NULL DEFAULT false,
  "tagline" VARCHAR(300),
  "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_tiers_key_key" ON "plan_tiers"("key");
CREATE INDEX "plan_tiers_status_sort_order_idx" ON "plan_tiers"("status", "sort_order");
INSERT INTO "plan_tiers" ("key", "name", "description", "sort_order", "status", "is_most_popular")
SELECT "tier_key", MIN("name"), MIN("description"), MIN("sort_order"),
  CASE WHEN BOOL_OR("status" = 'ACTIVE') THEN 'ACTIVE'::"PlanStatus"
       ELSE 'RETIRED'::"PlanStatus" END,
  BOOL_OR("is_most_popular" AND "status" = 'ACTIVE')
FROM "plans" GROUP BY "tier_key";
ALTER TABLE "plans" ADD CONSTRAINT "plans_tier_key_fkey"
  FOREIGN KEY ("tier_key") REFERENCES "plan_tiers"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

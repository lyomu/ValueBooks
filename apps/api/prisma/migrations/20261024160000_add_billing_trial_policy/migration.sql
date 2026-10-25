CREATE TABLE "billing_trial_policy" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "reminder_lead_hours" SMALLINT NOT NULL DEFAULT 24,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_trial_policy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_trial_policy_singleton" CHECK ("id" = 1),
  CONSTRAINT "billing_trial_policy_reminder_range" CHECK ("reminder_lead_hours" BETWEEN 1 AND 72)
);

CREATE TABLE "provider_plan_provisions" (
  "plan_id" UUID NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "provider_code" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_plan_provisions_pkey" PRIMARY KEY ("plan_id"),
  CONSTRAINT "provider_plan_provisions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "provider_plan_provisions_status_check" CHECK ("status" IN ('PENDING', 'CREATED', 'NEEDS_RECONCILIATION', 'LINKED'))
);
CREATE UNIQUE INDEX "provider_plan_provisions_provider_code_key" ON "provider_plan_provisions"("provider_code");

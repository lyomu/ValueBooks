ALTER TYPE "MfaChallengePurpose" ADD VALUE IF NOT EXISTS 'SIGNUP';

CREATE TABLE "registration_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "user_id" UUID,
  "email" CITEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "payment_verified_at" TIMESTAMPTZ(6),
  "provider_reference" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_intents_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "registration_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "registration_intents_user_id_consumed_at_idx" ON "registration_intents"("user_id", "consumed_at");
CREATE INDEX "registration_intents_expires_at_idx" ON "registration_intents"("expires_at");

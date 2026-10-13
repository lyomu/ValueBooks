CREATE TYPE "MfaChallengePurpose" AS ENUM ('LOGIN', 'ENROLL', 'STEP_UP');

ALTER TABLE "users" ADD COLUMN "email_mfa_enabled_at" TIMESTAMPTZ(6);
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" TIMESTAMPTZ(6);

CREATE TABLE "mfa_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "session_id" UUID,
  "purpose" "MfaChallengePurpose" NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "resend_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_challenges_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "mfa_challenges_user_id_purpose_consumed_at_idx" ON "mfa_challenges"("user_id", "purpose", "consumed_at");
CREATE INDEX "mfa_challenges_expires_at_idx" ON "mfa_challenges"("expires_at");

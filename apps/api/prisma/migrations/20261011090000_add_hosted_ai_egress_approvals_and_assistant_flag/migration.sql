-- Hosted AI egress is an explicit per-tenant legal approval, not a generic rollout setting.
CREATE TYPE "HostedAiEgressApprovalStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "hosted_ai_egress_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "status" "HostedAiEgressApprovalStatus" NOT NULL DEFAULT 'ACTIVE',
  "provider" VARCHAR(40) NOT NULL,
  "data_scope" VARCHAR(80) NOT NULL,
  "jurisdiction_country_code" CHAR(2) NOT NULL,
  "signer_name" VARCHAR(180) NOT NULL,
  "signer_email" CITEXT NOT NULL,
  "signer_authority" VARCHAR(180) NOT NULL,
  "disclosure_version" VARCHAR(120) NOT NULL,
  "legal_decision_reference" VARCHAR(500) NOT NULL,
  "consent_document_reference" VARCHAR(500) NOT NULL,
  "consent_document_hash" CHAR(64) NOT NULL,
  "approved_by_platform_admin_id" UUID NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by_platform_admin_id" UUID,
  "revoked_at" TIMESTAMPTZ(6),
  "revocation_reason" VARCHAR(500),
  CONSTRAINT "hosted_ai_egress_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_ai_egress_approvals_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hosted_ai_egress_approvals_status_lifecycle"
    CHECK (("status" = 'ACTIVE' AND "revoked_at" IS NULL AND "revoked_by_platform_admin_id" IS NULL AND "revocation_reason" IS NULL)
      OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_by_platform_admin_id" IS NOT NULL AND "revocation_reason" IS NOT NULL)),
  CONSTRAINT "hosted_ai_egress_approvals_provider_scope"
    CHECK ("provider" = 'DEEPSEEK' AND "data_scope" = 'REPORT_EVIDENCE'),
  CONSTRAINT "hosted_ai_egress_approvals_hash_format"
    CHECK ("consent_document_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "hosted_ai_egress_approvals_organization_id_approved_at_idx"
  ON "hosted_ai_egress_approvals"("organization_id", "approved_at");
CREATE INDEX "hosted_ai_egress_approvals_status_idx" ON "hosted_ai_egress_approvals"("status");
CREATE UNIQUE INDEX "hosted_ai_egress_approvals_one_active_per_organization"
  ON "hosted_ai_egress_approvals"("organization_id") WHERE "status" = 'ACTIVE';

-- This is a broad assistant capability switch. It is default-on only for the internal Phase 13
-- rollout, and still cannot cause hosted egress because that needs the approval above.
INSERT INTO "feature_flags" ("key", "name", "description", "default_enabled", "status")
VALUES (
  'phase13.ai_assistant',
  'AI assistant capability',
  'Overarching kill switch for AI assistant ask and explain-number routes.',
  true,
  'ACTIVE'
)
ON CONFLICT ("key") DO NOTHING;

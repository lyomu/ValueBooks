-- A contact becomes a collaboration target, so a customer can carry comments and an activity
-- timeline of its own, and outbound document emails get a durable record to read back.

ALTER TYPE "CollaborationTargetType" ADD VALUE IF NOT EXISTS 'CONTACT';

CREATE TABLE "document_send_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "contact_id" UUID,
  "target_type" "CollaborationTargetType" NOT NULL,
  "target_id" UUID NOT NULL,
  "document_number" VARCHAR(64),
  "recipient_email" VARCHAR(320) NOT NULL,
  "subject" VARCHAR(320) NOT NULL,
  "sent_by_user_id" UUID,
  "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_send_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_send_logs_org_contact_sent_idx"
  ON "document_send_logs"("organization_id", "contact_id", "sent_at");

CREATE INDEX "document_send_logs_org_target_idx"
  ON "document_send_logs"("organization_id", "target_type", "target_id");

ALTER TABLE "document_send_logs"
  ADD CONSTRAINT "document_send_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_send_logs"
  ADD CONSTRAINT "document_send_logs_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_send_logs"
  ADD CONSTRAINT "document_send_logs_sent_by_user_id_fkey"
  FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

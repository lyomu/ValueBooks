CREATE TABLE "billing_notices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_key" VARCHAR(80) NOT NULL,
  "source_id" VARCHAR(160) NOT NULL,
  "recipient_email" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "body" TEXT NOT NULL,
  "queued_at" TIMESTAMPTZ(6),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "billing_notices_org_event_source_key" ON "billing_notices"("organization_id", "event_key", "source_id");
CREATE INDEX "billing_notices_queued_created_idx" ON "billing_notices"("queued_at", "created_at");

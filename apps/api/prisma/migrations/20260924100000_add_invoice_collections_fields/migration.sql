ALTER TABLE "invoices"
  ADD COLUMN "expected_payment_date" DATE,
  ADD COLUMN "reminders_stopped_at" TIMESTAMPTZ(6),
  ADD COLUMN "written_off_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "written_off_at" TIMESTAMPTZ(6),
  ADD COLUMN "write_off_journal_id" UUID;

CREATE UNIQUE INDEX "invoices_write_off_journal_id_key" ON "invoices"("write_off_journal_id");

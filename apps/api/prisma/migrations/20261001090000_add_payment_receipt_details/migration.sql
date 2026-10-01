-- Payment receipt detail: how the money arrived, what the bank took, and what the customer withheld.

CREATE TYPE "PaymentMode" AS ENUM (
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'MOBILE_MONEY',
  'CARD',
  'OTHER'
);

ALTER TABLE "payments_received"
  ADD COLUMN "bank_charges_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "withholding_tax_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
  ADD COLUMN "reference" VARCHAR(140),
  ADD COLUMN "notes" VARCHAR(2000);

-- Bind the two system keys the recording journal now resolves. `ensureStarterChart` only seeds an
-- organization whose chart is still empty, so organizations created before this migration need the
-- binding (and the receivable account) backfilled here.

UPDATE "ledger_accounts" AS a
SET "system_key" = 'bank_charges'
WHERE a."code" = '5130'
  AND a."system_seed" = true
  AND a."system_key" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ledger_accounts" b
    WHERE b."organization_id" = a."organization_id" AND b."system_key" = 'bank_charges'
  );

INSERT INTO "ledger_accounts" (
  "organization_id", "code", "name", "type", "normal_balance",
  "description", "system_seed", "system_key", "is_control"
)
SELECT
  o."id",
  '1410',
  'Withholding tax receivable',
  'ASSET'::"LedgerAccountType",
  'DEBIT'::"LedgerNormalBalance",
  'Tax customers withhold at source and remit to the revenue authority on our behalf.',
  true,
  'withholding_tax_receivable',
  false
FROM "organizations" o
WHERE EXISTS (
    SELECT 1 FROM "ledger_accounts" seeded
    WHERE seeded."organization_id" = o."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ledger_accounts" existing
    WHERE existing."organization_id" = o."id"
      AND (existing."system_key" = 'withholding_tax_receivable' OR existing."code" = '1410')
  );

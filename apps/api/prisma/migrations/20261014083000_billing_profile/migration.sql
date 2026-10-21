CREATE TABLE "billing_profiles" (
  "organization_id" UUID NOT NULL PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "contact_name" VARCHAR(180) NOT NULL,
  "contact_email" VARCHAR(255) NOT NULL,
  "address_line_1" VARCHAR(255),
  "address_line_2" VARCHAR(255),
  "city" VARCHAR(120),
  "region" VARCHAR(120),
  "postal_code" VARCHAR(40),
  "country_code" CHAR(2) NOT NULL,
  "tax_id" VARCHAR(100),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

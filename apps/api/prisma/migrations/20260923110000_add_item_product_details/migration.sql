ALTER TABLE "items"
  ADD COLUMN "image_data_url" TEXT,
  ADD COLUMN "sales_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sales_description" TEXT,
  ADD COLUMN "purchase_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "purchase_description" TEXT;

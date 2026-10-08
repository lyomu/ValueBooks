ALTER TABLE "users" ADD COLUMN "profile_completed_at" TIMESTAMPTZ(6);

UPDATE "users"
SET "profile_completed_at" = "created_at"
WHERE "profile_completed_at" IS NULL;

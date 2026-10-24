-- D9: the platform audit log is evidence of privileged actions, so the database enforces that it
-- is append-only. Additive and idempotent: no row changes, and running it again is a no-op.

-- 1. Deleting a platform admin grant no longer deletes that admin's audit history. Grants are
--    revoked by status and never deleted, so nothing that runs today is refused.
ALTER TABLE "platform_audit_events"
  DROP CONSTRAINT IF EXISTS "platform_audit_events_platform_admin_id_fkey";
ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_platform_admin_id_fkey"
  FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Rows cannot be edited or deleted. The one permitted UPDATE is the organization foreign key's
--    own ON DELETE SET NULL: it clears organization_id and changes nothing else, so an
--    organization can still be purged while its audit rows keep actor, reason and before/after.
--    TRUNCATE is not a row operation and is not blocked (the test harness resets with it).
CREATE OR REPLACE FUNCTION "platform_audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."organization_id" IS NOT NULL
    AND NEW."organization_id" IS NULL
    AND (to_jsonb(NEW) - 'organization_id') = (to_jsonb(OLD) - 'organization_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'platform_audit_events is append-only: % of audit record % refused', TG_OP, OLD."id"
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS "platform_audit_events_append_only" ON "platform_audit_events";
CREATE TRIGGER "platform_audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "platform_audit_events"
  FOR EACH ROW EXECUTE FUNCTION "platform_audit_events_append_only"();

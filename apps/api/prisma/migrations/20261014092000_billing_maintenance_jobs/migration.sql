INSERT INTO "scheduled_jobs" (
  "id", "organization_id", "created_by_user_id", "handler", "source_type", "source_id",
  "payload", "schedule", "time_zone", "misfire_policy", "status", "next_run_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), o."id", o."created_by_user_id", 'billing.maintenance',
  'ORGANIZATION_BILLING', o."id", '{}'::jsonb,
  '{"cadence":"DAILY","localTime":"03:00"}'::jsonb, 'UTC', 'RUN_ONCE', 'ACTIVE',
  now() + INTERVAL '1 day', now(), now()
FROM "organizations" o
WHERE EXISTS (SELECT 1 FROM "organization_subscriptions" s WHERE s."organization_id" = o."id")
ON CONFLICT ("organization_id", "handler", "source_type", "source_id") DO NOTHING;

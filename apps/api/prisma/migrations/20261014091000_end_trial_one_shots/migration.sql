-- Trial reminder and expiry handlers are one-shot. Earlier rows had a DAILY schedule without an
-- end date and would keep generating redundant executions after the first occurrence.
UPDATE "scheduled_jobs"
SET "schedule" = jsonb_set("schedule"::jsonb, '{endDate}',
  to_jsonb(to_char("next_run_at" AT TIME ZONE "time_zone", 'YYYY-MM-DD')))
WHERE "handler" IN ('billing.trial_reminder', 'billing.trial_expired')
  AND NOT ("schedule"::jsonb ? 'endDate');

-- Atomic per-delivery claim for billing webhooks. Two concurrent deliveries of the same signed
-- payload could previously both pass the "already PROCESSED?" check and apply the event twice.
-- A delivery now claims the row (state PROCESSING + start time) with a conditional update before
-- applying it; a stale claim from a crashed worker can be re-claimed after a timeout.
-- Additive only: no existing row changes state.
ALTER TYPE "WebhookProcessingState" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TABLE "billing_webhook_events" ADD COLUMN "processing_started_at" TIMESTAMPTZ(6);

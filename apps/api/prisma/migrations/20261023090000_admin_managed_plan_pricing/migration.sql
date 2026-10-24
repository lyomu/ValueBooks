-- Phase 7 (O5): administrator-managed plan pricing.
--
-- Owner decision, 23 Oct 2026: an administrator changes pricing from the console without a deploy,
-- and existing subscribers are repriced at their next renewal. A price change is therefore proposed,
-- previewed against current subscribers and published; publishing updates Paystack and records what
-- Paystack reported. Additive only: no existing row is read or written by this migration.
--
-- `plan_price_history` is what keeps an old charge explainable. Once Paystack's plan carries the new
-- amount, the provider no longer knows what a subscriber used to pay, so every price a plan has
-- carried is recorded here, opening with the price each plan holds today.

CREATE TYPE "PlanPriceChangeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISCARDED');

CREATE TABLE "plan_price_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "status" "PlanPriceChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "from_price_minor" BIGINT NOT NULL,
    "to_price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subscribers_at_proposal" INTEGER NOT NULL,
    "provider_affected_subscriptions" INTEGER,
    "provider_message" VARCHAR(500),
    "reason" VARCHAR(500) NOT NULL,
    "proposed_by_platform_admin_id" UUID NOT NULL,
    "published_by_platform_admin_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "discarded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_price_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plan_price_changes_plan_id_status_idx" ON "plan_price_changes"("plan_id", "status");
CREATE INDEX "plan_price_changes_status_created_at_idx" ON "plan_price_changes"("status", "created_at");

-- A plan may hold at most one change awaiting publication, so two administrators cannot each be
-- holding a different pending price for the same plan.
CREATE UNIQUE INDEX "plan_price_changes_one_draft_per_plan" ON "plan_price_changes"("plan_id")
    WHERE "status" = 'DRAFT';

ALTER TABLE "plan_price_changes" ADD CONSTRAINT "plan_price_changes_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not SET NULL: a published price change must always name the administrator who published
-- it, the same rule the platform audit log follows.
ALTER TABLE "plan_price_changes" ADD CONSTRAINT "plan_price_changes_proposed_by_platform_admin_id_fkey"
    FOREIGN KEY ("proposed_by_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_price_changes" ADD CONSTRAINT "plan_price_changes_published_by_platform_admin_id_fkey"
    FOREIGN KEY ("published_by_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "plan_price_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_interval" "BillingInterval" NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "price_change_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_price_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plan_price_history_plan_id_effective_from_idx" ON "plan_price_history"("plan_id", "effective_from");

ALTER TABLE "plan_price_history" ADD CONSTRAINT "plan_price_history_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: a history row must keep naming the change that produced it.
ALTER TABLE "plan_price_history" ADD CONSTRAINT "plan_price_history_price_change_id_fkey"
    FOREIGN KEY ("price_change_id") REFERENCES "plan_price_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The opening row for every plan that exists: the price it carries now, effective from when the
-- plan was created. `price_change_id` stays null, because these predate console-managed pricing.
INSERT INTO "plan_price_history" ("plan_id", "price_minor", "currency", "billing_interval", "effective_from", "price_change_id")
SELECT "id", "price_minor", "currency", "billing_interval", "created_at", NULL FROM "plans";

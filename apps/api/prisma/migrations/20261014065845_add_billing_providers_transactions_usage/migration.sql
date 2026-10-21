/*
  Warnings:

  - Added the required column `tier_key` to the `plans` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BillingProviderName" AS ENUM ('PADDLE', 'PAYSTACK');

-- CreateEnum
CREATE TYPE "BillingTransactionStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "WebhookProcessingState" AS ENUM ('RECEIVED', 'VERIFIED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionChangeStatus" AS ENUM ('PENDING', 'PAYMENT_PENDING', 'ACTIVE_NEW', 'CANCELLING_OLD', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'TRIAL_EXPIRED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'CANCEL_SCHEDULED';

-- AlterTable
ALTER TABLE "organization_subscriptions" ADD COLUMN     "billing_provider" "BillingProviderName",
ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "current_period_end" TIMESTAMPTZ(6),
ADD COLUMN     "current_period_start" TIMESTAMPTZ(6),
ADD COLUMN     "last_payment_at" TIMESTAMPTZ(6),
ADD COLUMN     "past_due_since" TIMESTAMPTZ(6),
ADD COLUMN     "provider_customer_id" VARCHAR(160),
ADD COLUMN     "provider_subscription_id" VARCHAR(160),
ADD COLUMN     "trial_reminder_sent_at" TIMESTAMPTZ(6);

-- AlterTable
-- `tier_key` is added nullable first and backfilled from `key` for the handful of placeholder
-- Phase-12 plan rows (free/growth/scale, zero price, no subscribers) that predate the real
-- commercial catalog. Those rows are retired by the plan-catalog seed that follows this
-- migration; no live subscription references them (verified before writing this migration).
ALTER TABLE "plans" ADD COLUMN     "billing_provider" "BillingProviderName",
ADD COLUMN     "is_most_popular" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider_price_id" VARCHAR(160),
ADD COLUMN     "provider_product_id" VARCHAR(160),
ADD COLUMN     "tier_key" VARCHAR(40);

UPDATE "plans" SET "tier_key" = "key" WHERE "tier_key" IS NULL;

ALTER TABLE "plans" ALTER COLUMN "tier_key" SET NOT NULL;

-- CreateTable
CREATE TABLE "billing_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "billing_provider" "BillingProviderName" NOT NULL,
    "provider_transaction_id" VARCHAR(160) NOT NULL,
    "status" "BillingTransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "fee_minor" BIGINT,
    "refunded_minor" BIGINT,
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "receipt_url" VARCHAR(500),
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_key" VARCHAR(60) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "billing_provider" "BillingProviderName" NOT NULL,
    "provider_event_id" VARCHAR(160) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "processing_state" "WebhookProcessingState" NOT NULL DEFAULT 'RECEIVED',
    "payload_json" JSONB NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1000),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "from_plan_id" UUID,
    "to_plan_id" UUID NOT NULL,
    "from_provider" "BillingProviderName",
    "to_provider" "BillingProviderName" NOT NULL,
    "status" "SubscriptionChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID,
    "effective_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "error_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_transactions_organization_id_created_at_idx" ON "billing_transactions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_transactions_status_created_at_idx" ON "billing_transactions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_transactions_billing_provider_provider_transaction__key" ON "billing_transactions"("billing_provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "usage_counters_organization_id_resource_key_idx" ON "usage_counters"("organization_id", "resource_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_organization_id_resource_key_period_start_key" ON "usage_counters"("organization_id", "resource_key", "period_start");

-- CreateIndex
CREATE INDEX "billing_webhook_events_processing_state_received_at_idx" ON "billing_webhook_events"("processing_state", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_billing_provider_provider_event_id_key" ON "billing_webhook_events"("billing_provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "subscription_changes_organization_id_created_at_idx" ON "subscription_changes"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_changes_status_idx" ON "subscription_changes"("status");

-- CreateIndex
CREATE INDEX "organization_subscriptions_provider_subscription_id_idx" ON "organization_subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "plans_tier_key_idx" ON "plans"("tier_key");

-- AddForeignKey
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "organization_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_from_plan_id_fkey" FOREIGN KEY ("from_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_to_plan_id_fkey" FOREIGN KEY ("to_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

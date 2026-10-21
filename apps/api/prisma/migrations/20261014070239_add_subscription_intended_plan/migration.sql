-- AlterTable
ALTER TABLE "organization_subscriptions" ADD COLUMN     "intended_plan_id" UUID;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_intended_plan_id_fkey" FOREIGN KEY ("intended_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

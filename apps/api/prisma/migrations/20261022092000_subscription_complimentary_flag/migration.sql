-- Platform Admin may grant an organization complimentary (unpaid) access to a plan, but such a
-- grant must never read as a paid subscription in MRR, ARR or active-paid counts. Additive; every
-- existing subscription keeps its meaning (false).
ALTER TABLE "organization_subscriptions" ADD COLUMN "complimentary" BOOLEAN NOT NULL DEFAULT false;

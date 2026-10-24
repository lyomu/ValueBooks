# Runbook: suspending and reactivating an organization

**Who:** Operations or Superadmin. Support can view but cannot act.
**Console:** Organizations → organization detail → Administration tab.

## What suspension does

- Every member's request to the organization returns **403 "This organization is suspended."** This covers reads
  too, not only writes. Members can still sign in, and organizations they belong to that are not suspended work as
  usual. A suspended organization is skipped when choosing a member's default organization.
- Nothing is deleted or changed in the organization's books, documents, users or subscription.
- **Billing continues.** Suspension does not cancel or pause the Paystack subscription. If the tenant should not be
  charged, that is a separate decision for the owner. Suspension is not a billing tool.
- The reason is stored on the organization and in the platform audit log (append-only).
- Grounds, who may authorise each, notice and the 30-day review: [suspension-policy.md](../suspension-policy.md).

## Suspend

1. Check the ground against [suspension-policy.md](../suspension-policy.md) (ratified 23 Oct 2026) and confirm who
   may authorise it: G1 and G2 are the owner's alone, G3 to G5 are yours within the limits stated there. If no
   ground fits, do not suspend — escalate to the owner. A payment failure is not a ground:
   [failed-subscription-payment.md](failed-subscription-payment.md) applies read-only mode automatically.
2. **Suspend organization** → enter a reason of at least 10 characters that a colleague would understand months
   later, then type the organization's slug to confirm.
3. Tell the organization owner through the agreed channel. The product does not notify them.

## Reactivate

**Reactivate organization** → enter a reason (recorded even though the API treats it as optional). The organization
returns to the state it was in: `ACTIVE` if it had finished onboarding, otherwise `DRAFT`. The stored suspension
reason is cleared from the organization, and the audit log keeps it.

## Check

- Operations & trust → Audit logs, filtered to *Organization suspended* or *Organization reactivated*: the
  administrator, reason and before/after status.
- The organization's detail page shows its lifecycle state separately from its subscription status.

## Escalate to the owner

Any request to delete the organization's data (deletion and retention are out of scope for the console), and any
suspension whose reason involves a legal request.

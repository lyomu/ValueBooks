# Tenant suspension policy (O11)

**Status: ratified by the owner, 23 Oct 2026.** The grounds in §2 are standing authority: Operations may act on
G3, G4 and G5 within the limits stated there, without a separate owner decision each time. G1 and G2 remain the
owner's alone. Changes to this policy are the owner's to make.

**Scope:** suspending and reactivating one organization through the Platform Admin console
(Organizations → organization detail → Administration). It does not cover account status changes on a person
(Users → account administration), data deletion or retention, or anything billing does on its own.

## 1. What suspension is, and what it is not

Suspension blocks every request from every member of that organization with **403 "This organization is
suspended."**, reads included. It changes nothing else: books, documents, members and the subscription are left
exactly as they are, and **Paystack keeps charging**. Reactivation restores the organization to the state it was in.

It follows that suspension is:

- **not a collections tool.** A failed renewal already applies read-only mode on its own, with a grace period
  ([failed-subscription-payment.md](runbooks/failed-subscription-payment.md)). Suspending a late payer removes their
  access to their own records while still billing them.
- **not a deletion or retention step.** Nothing is removed, and the console cannot delete tenant data at all.
- **not a support convenience.** It is visible to every member immediately and the product sends them no
  explanation.

## 2. Grounds

Suspension requires one of these, and nothing else is a ground on its own.

| # | Ground | Who may decide | Notice |
|---|---|---|---|
| G1 | A binding legal or regulatory order, or a credible notice from a regulator or law-enforcement body | Owner only | As the order requires; otherwise at the same time as the suspension |
| G2 | Confirmed fraud or abuse of the platform by the organization — payment fraud, impersonation of another business, using ValueBooks to defraud its own customers | Owner only | At the same time as the suspension |
| G3 | A live security compromise of that organization where leaving it reachable continues the harm (for example credentials in active use by an attacker and no other containment available) | Operations may act immediately; the owner is told the same day | At the same time as the suspension, with what is known |
| G4 | A written request from a verified owner or director of the organization to suspend their own tenant | Operations | Confirmation to the requester |
| G5 | Platform integrity: that one tenant's activity is demonstrably degrading the service for others and no narrower control (a feature flag, a limit, a queue change) is available | Operations, with the owner's agreement before acting unless the degradation is ongoing | At the same time as the suspension |

**Explicitly not grounds:** non-payment or an expired trial (G1–G5 aside, billing handles these); a support
investigation; an unverified complaint; a suspected breach of terms that is still being assessed; convenience during
maintenance or migration.

## 3. Before suspending

1. Identify which ground applies and who authorised it. If none fits, do not suspend; escalate to the owner.
2. Consider the narrower control first — a feature flag, a limit, or an account status change on one person
   (Users → account administration) where the problem is one individual rather than the organization.
3. Note what the organization will lose access to. Suspension is not partial: no member can read anything.

## 4. Doing it, and the record

Follow [tenant-suspension.md](runbooks/tenant-suspension.md). The reason field is mandatory and at least 10
characters; write the ground (`G1`–`G5`), who authorised it, and what a colleague would need to know in six months.
The reason and the before/after state are written to the append-only platform audit log and cannot be edited or
deleted afterwards.

Tell the organization as the table above requires. The product does not notify anyone.

## 5. Reactivation

Reactivate as soon as the ground no longer holds. The decision sits with whoever could authorise the ground: a G1 or
G2 suspension is lifted by the owner, G3–G5 by Operations. Give a reason even though the API treats it as optional,
so the audit log shows why the suspension ended. The organization returns to `ACTIVE`, or `DRAFT` if it had never
finished setup.

## 6. Review

Any suspension still in place after **30 days** is reviewed by the owner, who either confirms the ground in the
audit trail or lifts it. Suspensions are not a resting state.

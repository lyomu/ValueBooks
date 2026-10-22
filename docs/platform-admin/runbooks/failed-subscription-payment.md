# Runbook: failed subscription payment

**Who:** Support (investigate), Operations (compare with Paystack). Nothing in this runbook charges a card.
**Console:** Billing & subscriptions → Issues, Subscriptions, Transactions.

## What the system has already done

A renewal can fail in two ways, and both end in the same state:

- Paystack sends `invoice.payment_failed`. The webhook handler sets the subscription to `PAST_DUE`, stamps
  `pastDueSince`, and queues a "payment needs attention" notice to the organization.
- The nightly billing maintenance job asks Paystack about every linked subscription. If Paystack says `past_due`
  while ValueBooks still says `ACTIVE`, the job makes the same change and sends "update your payment method".

**What the tenant experiences:** reads are never blocked. Writes keep working for a grace period
(`BILLING_PAST_DUE_GRACE_DAYS`, default **3 days** from `pastDueSince`). After that, every tenant write except the
billing pages returns `SUBSCRIPTION_READ_ONLY` until the subscription is active again. Billing pages always stay
writable, so the owner can fix the payment method.

## Diagnose

1. **Issues → Failed payments** lists failed billing transactions (latest 100) with the organization.
2. Open the subscription (**Subscriptions**, filter status *Past due*). Check *Past due since* and *Renews*.
3. Press **Compare with Paystack** (Operations). It is read-only and lists discrepancies, such as:
   - "Provider is past due while local subscription is active": maintenance has not run yet for this tenant.
   - "Provider is canceled while local subscription is active": escalate (see below).
   - "Cancellation scheduling differs": escalate.
4. Check **Issues → Failed webhooks**. If the `invoice.payment_failed` or the later successful charge event failed
   to process, follow [webhook-recovery.md](webhook-recovery.md) first.

## Act

- **The customer pays again** (new card, retried charge in Paystack): Paystack sends a paid `invoice.update` or
  `charge.success`, the webhook returns the subscription to `ACTIVE`, and writes unlock. Confirm on the subscription
  page. Nothing else is needed.
- **The customer needs more time:** there is no console action that extends a paid grace period. Do not assign a
  plan or a complimentary grant to work around a payment failure. Escalate to the owner if an exception is warranted.
- **The payment succeeded at Paystack but ValueBooks still says past due:** check Failed webhooks and use
  [webhook-recovery.md](webhook-recovery.md). If no event arrived at all, escalate. Do not edit the subscription
  by hand.

## Do not

- Change subscription status, `pastDueSince` or periods in the database.
- Create a manual transaction to "mark as paid". Every payment must come from a verified Paystack event.

## Escalate to the owner

Paystack shows the subscription cancelled while ValueBooks shows it active, any amount or currency mismatch, or more
than one ValueBooks subscription matching one Paystack customer and plan (the renewal matcher refuses those by design).

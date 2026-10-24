# Runbook: billing webhook recovery

**Who:** Support (investigate), Operations (retry processing).
**Console:** Billing & subscriptions → Webhooks, and Issues → Failed webhooks.

## How webhooks are handled

Every Paystack webhook is signature-checked, then stored once per provider event id in `billing_webhook_events`
before it is applied. A single delivery *claims* the event (`PROCESSING`). Duplicates stand down, and a claim
left by a crashed worker goes stale and can be reclaimed. When processing throws, the event is marked `FAILED`
with `lastError`, and the API answers non-2xx so **Paystack redelivers it on its own schedule**. A redelivery or
a manual retry processes the same stored event, so neither can create a second payment or subscription.

States: `VERIFIED` (stored, not yet processed) → `PROCESSING` → `PROCESSED`, or `FAILED`.

## Diagnose

1. **Webhooks**, filter state *Failed*. Read the event type and the last error.
2. Causes the last error may show:
   - **The event refers to a plan or customer ValueBooks cannot match:** check the plan's provider codes
     (Billing → Plans) and the organization's subscription before retrying.
   - **More than one subscription matches** a renewal: refused on purpose. Escalate. Do not retry until the owner
     decides which subscription it belongs to.
   - **Amount or currency mismatch:** refused on purpose. Escalate.
   - **A transient error** (database or network): safe to retry.
3. Check the *Retries* count. Paystack may already be redelivering.

## Act

**Retry processing** (Operations, reason required) re-runs the stored, signature-verified event. Only `FAILED` or
`VERIFIED` Paystack events can be retried. Events from the retired provider are kept for audit and cannot be
replayed.

After a retry, reload the Webhooks page and confirm the event shows `PROCESSED`. Two known gaps, recorded in the
tracker and not yet fixed:

- If the retry itself fails, the dialog shows the error, but no platform audit row is written for the attempt.
- If a Paystack redelivery happens to hold the claim at the same moment, the retry reports success and is audited
  as `PROCESSED` although the redelivery did the work, or is still doing it. Always confirm the state on the page.

## Do not

- Edit `billing_webhook_events` or replay a payload with your own tooling. The signature check is the evidence
  that the payload came from Paystack.
- Retry an event that was refused for ambiguity or mismatch. It will fail the same way.

## Escalate to the owner

Repeated failures of one event type (a code change is likely needed), any ambiguity or mismatch refusal, or
webhooks that stop arriving at all. **Payment providers** shows *Last signed webhook*.

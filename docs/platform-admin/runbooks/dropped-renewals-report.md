# Runbook: dropped Paystack renewal payments (read-only report)

**Purpose:** list Paystack payments that reached ValueBooks but were never recorded as a
`BillingTransaction`. Defect D12 dropped renewal payments: a renewal `charge.success` matched no
subscription and was marked PROCESSED with nothing applied, and the paid `invoice.update` that
followed was ignored. The fix applies new renewals; it does not revisit past events, because a
PROCESSED event is never reprocessed. This report shows what was missed.

**Safety:** everything runs inside `BEGIN READ ONLY … ROLLBACK`. Postgres rejects any write.
**Nothing is backfilled.** Correcting a past renewal (recording its transaction, advancing the
paid-through date) needs the owner's approval for each row.

**Who:** owner or ops, with database access. Follow the access steps in
`docs/BACKUP_RESTORE_RUNBOOK.md`, e.g. `docker exec -it <postgres-container> psql -U <user> -d <db>`.

## Run

```sql
BEGIN READ ONLY;

-- Every Paystack payment report with a charge reference, and whether a transaction exists for it.
-- Renewals are reported twice (charge.success, then invoice.update) under the same reference.
WITH payments AS (
  SELECT
    e.received_at,
    e.event_type,
    e.processing_state,
    CASE WHEN e.event_type = 'charge.success'
      THEN COALESCE(e.payload_json -> 'data' ->> 'reference', e.payload_json -> 'data' ->> 'id')
      ELSE e.payload_json -> 'data' -> 'transaction' ->> 'reference' END        AS reference,
    CASE WHEN e.event_type = 'charge.success'
      THEN e.payload_json -> 'data' ->> 'amount'
      ELSE COALESCE(e.payload_json -> 'data' -> 'transaction' ->> 'amount',
                    e.payload_json -> 'data' ->> 'amount') END                  AS amount_minor,
    COALESCE(e.payload_json -> 'data' ->> 'currency',
             e.payload_json -> 'data' -> 'transaction' ->> 'currency')          AS currency,
    e.payload_json -> 'data' ->> 'paid_at'                                      AS paid_at,
    e.payload_json -> 'data' -> 'customer' ->> 'customer_code'                  AS customer_code,
    NULLIF(e.payload_json -> 'data' -> 'plan' ->> 'plan_code', '')              AS plan_code,
    e.payload_json -> 'data' -> 'subscription' ->> 'subscription_code'          AS subscription_code
  FROM billing_webhook_events e
  WHERE e.billing_provider = 'PAYSTACK'
    AND (e.event_type = 'charge.success'
      OR (e.event_type = 'invoice.update'
          AND e.payload_json -> 'data' ->> 'paid' = 'true'
          AND e.payload_json -> 'data' ->> 'status' = 'success'))
)
SELECT
  p.reference,
  string_agg(DISTINCT p.event_type || ':' || p.processing_state, ', ')        AS reports,
  min(p.received_at)                                                           AS first_received,
  max(p.amount_minor)                                                          AS amount_minor,
  max(p.currency)                                                              AS currency,
  max(p.paid_at)                                                               AS paid_at,
  max(p.customer_code)                                                         AS customer_code,
  max(p.plan_code)                                                             AS plan_code,
  max(p.subscription_code)                                                     AS subscription_code,
  -- Which subscription(s) the payment belongs to, by subscription code or else customer + plan.
  -- More than one candidate means a person must decide; none means it was not a renewal of a
  -- known subscription (for example an abandoned checkout).
  (SELECT string_agg(o.legal_name || ' [' || s.id || '] ' || pl.key || ' paid through '
                     || COALESCE(to_char(s.current_period_end, 'YYYY-MM-DD'), 'unknown'), '; ')
     FROM organization_subscriptions s
     JOIN plans pl ON pl.id = s.plan_id
     JOIN organizations o ON o.id = s.organization_id
    WHERE s.billing_provider = 'PAYSTACK'
      AND ((max(p.subscription_code) IS NOT NULL
            AND s.provider_subscription_id = max(p.subscription_code))
        OR (max(p.subscription_code) IS NULL
            AND s.provider_customer_id = max(p.customer_code)
            AND pl.provider_price_id = max(p.plan_code))))                    AS candidate_subscriptions
FROM payments p
WHERE p.reference IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM billing_transactions t
     WHERE t.billing_provider = 'PAYSTACK' AND t.provider_transaction_id = p.reference)
GROUP BY p.reference
ORDER BY first_received;

ROLLBACK;
```

## Reading the result

- **No rows:** every Paystack payment report has its transaction. Nothing was dropped.
- **`reports` contains `:PROCESSED` and `candidate_subscriptions` names one subscription:** a
  dropped renewal. The customer paid and kept access, but the payment is missing from transactions,
  collections and revenue, and the paid-through date is stale. Propose a correction to the owner.
- **`:FAILED`:** processing was refused (amount or currency mismatch, or several candidate
  subscriptions). These are already visible under Billing → Webhook events, with the reason.
- **No candidate subscription:** usually an abandoned or unrelated checkout. Check it in the
  Paystack dashboard before doing anything.

Amounts are in the currency's minor unit (cents for USD).

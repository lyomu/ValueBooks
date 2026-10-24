# Recurring occurrence claims before the retry fix

The retry fix stores a new invoice, bill or expense claim with `resource_type` of `INVOICE`,
`BILL` or `EXPENSE` and `resource_id` of that exact draft in the same transaction. Older claims
point to a recurring template instead. An older claim cannot establish whether the earlier run
created a document, so the retry fails closed with a reconciliation message.

## Read-only predeploy check

Run against production before enabling retries of failed recurring executions:

```sql
SELECT organization_id, operation, key, resource_type, resource_id AS template_id, created_at
FROM ledger_idempotency_keys
WHERE operation IN (
  'RECURRING_INVOICE_GENERATE',
  'RECURRING_BILL_GENERATE',
  'RECURRING_EXPENSE_GENERATE'
)
AND resource_type IN (
  'RECURRING_INVOICE_TEMPLATE',
  'RECURRING_BILL_TEMPLATE',
  'RECURRING_EXPENSE_TEMPLATE'
)
ORDER BY created_at DESC;
```

For each result, check the scheduled execution and tenant audit trail for the occurrence date
in `key`. Review candidate documents in that organization around `created_at`, matching the
template's contact or vendor, amount, lines and document dates. Record the evidence and exact
document ID before any correction. A matching issued or posted document must never be created
again. If no document can be proved, leave the claim and execution failed for manual review;
do not delete a claim based only on an empty date range or a missing audit row.

The production read-only check and any row-level correction need a release record. No automatic
claim deletion or document re-creation is authorized by this runbook.

Recurring invoice retries also need email history checked: document creation is protected against
duplicates, but a failure after queueing an email and before recording `sent_at` can queue that
email again. This is shown in the console's retry impact text.

# Automation Operations Runbook

## Scope

This runbook covers the ValueBooks automation, scheduled-report, recurring-work, reminder, and
transactional-email workers. It is for an operator responding to delayed, failed, or duplicated
background work.

## Runtime topology

| Worker              | Queue                 |                          Default concurrency | Retry and retention                                                                               |
| ------------------- | --------------------- | -------------------------------------------: | ------------------------------------------------------------------------------------------------- |
| Automation          | `automation`          |          4 (`AUTOMATION_WORKER_CONCURRENCY`) | 5 exponential attempts; completed jobs retained for 1 hour / 5,000 jobs; failed jobs retained     |
| Email               | `email`               |               4 (`EMAIL_WORKER_CONCURRENCY`) | Delivery retries are owned by the email job configuration; exhausted jobs remain inspectable      |
| Document extraction | `document-extraction` | 2 (`DOCUMENT_EXTRACTION_WORKER_CONCURRENCY`) | Extraction state is persisted on the document row; retries must not create a second expense draft |

All queues use `QUEUE_PREFIX` (default `valuebooks`) and the Redis connection in `REDIS_URL`.
Workers must run with the restricted application database role, not the migration owner.

## Automation job catalog

| Job                   | Idempotency boundary                      | Effect                                                            |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `domain-event`        | `(ruleId, eventId)` workflow-run row      | Evaluates active rules and creates notifications/tasks            |
| `scheduled-execution` | execution claim plus occurrence namespace | Runs recurring documents, scheduled reports, or invoice reminders |
| `email-delivery`      | delivery job identity                     | Sends a transactional or automation email                         |
| `document-extraction` | attachment/extraction state               | Scans, OCRs, and produces review-only candidates                  |

Unknown job names fail loudly. Do not acknowledge or delete an unknown job until its producer and
payload have been identified.

## Routine checks

1. Check the platform Jobs view for waiting, active, delayed, and failed automation jobs.
2. Check worker health and Redis connectivity before retrying anything.
3. Review the associated organization, user, audit event, and durable execution/run row.
4. Confirm the operation has not already committed before retrying. A completed workflow run,
   scheduled execution, sent document log, or posted journal means the retry must be a no-op.

## Retry procedure

1. Resolve the underlying dependency first: Redis, object storage, mail transport, malware/OCR
   service, or database connectivity.
2. For a failed scheduled execution, use the organization-scoped retry control. It removes only a
   terminal BullMQ job before re-enqueuing the same execution identity; it does not invent a new
   occurrence key.
3. For domain-event failures, inspect the `WorkflowRun` error and rule version. Reactivate or edit
   a rule only after it is made safe; active rules must be deactivated before edits.
4. For email failures, inspect the final delivery attempt and recipient preference. Do not retry a
   security/identity email by changing an automation preference.
5. Record the reason and outcome in the relevant audited operator action.

## Approval target lifecycle

| Target                                   | Editable before submit | Finalization gate                                          | Terminal behavior                                    |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| Quote, sales order, invoice, credit note | Draft/editable         | Issue/approve path checks pending approval                 | Issued, voided, converted, or rejected as applicable |
| Purchase order, bill, payment made       | Draft/editable         | Posting/issue path checks pending approval where supported | Posted, paid, voided, or rejected                    |
| Inventory adjustment, journal            | Draft/editable         | Posting path checks pending approval                       | Posted/reversed or rejected                          |

Submission freezes a snapshot and target version. A decision fails closed if the target changes,
the approver loses authority, or a required ordered step is not complete. Rejection returns control
to the maker; edits require resubmission and create a new frozen approval context.

## Misfire and recovery rules

- The database scheduler owns next-run state. Do not create ad-hoc cron jobs for recurring work.
- Occurrences use deterministic idempotency namespaces. A crash before commit may be retried; a
  committed occurrence must never be recreated.
- Month-end, DST, and downtime recovery are handled by the scheduler calendar and sweep logic.
- Retain failed jobs until their durable execution/run record has been reviewed and recovery is
  complete.

## Escalation

Escalate immediately when a queue failure could conceal a financial posting, expose tenant data,
or prevent a period-close operation. Suspend the affected rule or feature flag when necessary;
never manually mutate journal lines, approval snapshots, or outbox rows to clear a queue.

# Runbook: failed email and automation jobs

**Who:** Support (investigate). Engineering for infrastructure fixes.
**Console:** Operations & trust → Jobs & queues.

## What the figures mean

- **Queue health** shows BullMQ counts per queue (Automations, Emails): waiting, active, delayed, **Failed
  (retained)**, and the age of the oldest waiting job.
- Every job is attempted **5 times with backoff**. After that it is kept for inspection (`removeOnFail: false`).
  **Failed (retained) is therefore an all-time count, not a 24-hour figure.** It only falls when jobs are removed.
- **Scheduler** shows scheduled executions from the database (reports, reminders, recurring documents, billing
  tasks). It does not show queue jobs.

## Diagnose

1. **Failures and recovery → Email queue** (or Automation queue) lists the 25 most recent retained failures: job
   name, attempts, time, and the first line of the reason. Email addresses are hidden, and job contents are never
   shown.
2. Read the reason:
   - **SMTP or provider errors** ("Invalid status code 403", authentication or connection errors): a mail
     configuration or provider problem that affects every email, not one tenant. Hand to engineering with the time
     range.
   - **One tenant or document only:** check the organization (Organizations → detail) and the document state.
3. **Waiting grows and the oldest waiting age keeps rising:** the worker process is not consuming the queue. Engineering
   should check that the `worker` container is running (`docker-compose.prod.yml`).

## Act

- There is **no console retry for queue jobs**. A resend cannot be guaranteed to happen only once, so the console
  does not offer it.
- After the cause is fixed, the affected user re-sends from the document itself (for example, the quote or invoice
  *Send* action). Support tells the tenant which documents were affected, using the job names and times.
- Failed **scheduled executions** (Scheduled executions tab) can be retried by Operations, with a reason. Read the
  impact text first: reminder and report tasks may email twice, and recurring postings may create nothing if the
  failed run had already claimed its occurrence (tracker item O8).

## Do not

- Remove retained failures from Redis to make the count fall. They are the evidence. Removal is an engineering
  change with an owner's approval.
- Re-send documents on a tenant's behalf.

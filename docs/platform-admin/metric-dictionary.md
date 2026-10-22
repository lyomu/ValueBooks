# Platform Admin metric dictionary

Every figure on the Platform Admin overview, with its exact definition, source and limits
(master plan §7.3). A metric that is not defined here does not belong on the page.

**Sources.** Two endpoints, both requiring at least the SUPPORT platform role:
- `GET /platform/analytics` (`platform-operations.service.ts`) — tenant and product counts. It reads
  **no monetary column of any tenant's books**, by deliberate design: "how much has this tenant
  invoiced" is exactly the question a platform console must not answer casually.
- `GET /platform/billing/overview` (`platform-billing.service.ts`) — ValueBooks' own subscription
  figures. This is ValueBooks' revenue, not a tenant's business data.

**Time.** All timestamps are stored and compared in UTC; the browser renders local time.
`observedAt` is the moment the response was built, shown as "Updated HH:MM".

## Period and comparison

| Term | Definition |
|---|---|
| Period | `from`/`to` query parameters, defaulting to the last 30 days. Inclusive of both ends. |
| Grouping | Chosen by range: ≤31 days → day, ≤120 days → week, otherwise month. |
| Previous period | The immediately preceding window of the same length, ending one millisecond before `from`. |
| `previousPeriod.hasData` | False when that earlier window contains no organizations, users or activations. A KPI then shows **no change at all**, never a fabricated +100%. |

## Organization and user metrics

| Metric | Definition | Caveat |
|---|---|---|
| Total organizations | Every organization row at the moment of the query. | Includes DRAFT (signed up, setup unfinished). Not period-scoped. |
| Active organizations | `status = ACTIVE`. | A lifecycle state, **not** a proxy for recent engagement or for a paid subscription. |
| Still in setup | `status = DRAFT`. | |
| Suspended | `status = SUSPENDED`. | Suspension is administrative; it says nothing about the subscription. |
| Registered users | Every user row. | A user with no organization membership is legitimate, not an error. |
| New organizations / users in period | `createdAt` within the period. | Compared against the previous period for the change badge. |

## Activation and adoption

| Metric | Definition | Caveat |
|---|---|---|
| Onboarding completed | Organizations with `onboardingCompletedAt` set. | All-time, not period-scoped. |
| Reached first invoice | Distinct organizations with at least one non-draft invoice. | Counting the **existence** of an issued invoice, never its amount. |
| Module adoption (invoicing, banking, inventory, projects, portals, automation) | Distinct organizations that have performed a qualifying action in that module, all time. | Measures whether a module has been **used**, not whether the plan entitles it. |
| Recently engaged (30 / 90 days) | Distinct organizations with an audit event in the window. | A heartbeat proxy. The audit trail is the closest existing usage signal; it records state changes, not sign-ins. |

## Growth series

| Series | Definition |
|---|---|
| Registrations | Organizations created, bucketed by `grouping`. |
| Activated | Organizations whose `onboardingCompletedAt` falls in the period, bucketed the same way. |

Buckets with no rows are absent rather than zero-filled; the chart must render the real points, and
a short period with one tenant is shown as the sparse data it is.

## Requires attention

Each entry is a count with a drilldown to the records behind it. All are current state, not
period-scoped.

| Item | Definition | Links to |
|---|---|---|
| Failed jobs (24h) | `ScheduledJobExecution` rows with `status = FAILED` created in the last 24 hours. **Scheduled executions only** — it does not include the BullMQ email or automation queues (see defect D10). | Jobs & queues |
| Stalled onboarding | DRAFT organizations with no `onboardingCompletedAt`, created more than 7 days ago. | Organizations |
| Failed webhooks | `BillingWebhookEvent` with `processingState = FAILED`, all time. | Webhook events |
| High-severity security events (24h) | `SecurityEvent` with severity WARNING, ERROR or CRITICAL in the last 24 hours. | Security events |
| Trials expiring soon | TRIALING subscriptions whose `trialEndsAt` is within the next 24 hours. | Trials |
| Suspended organizations | `status = SUSPENDED`. | Organizations |

## Billing snapshot

From `GET /platform/billing/overview`. Its own `methodology` string is returned with the data and
is shown in the UI.

| Metric | Definition | Caveat |
|---|---|---|
| MRR | Each active recurring contract normalized to a monthly figure: a yearly plan's price ÷ 12, a monthly plan's price as-is. Grouped **by currency**. | Annual monthly-equivalents round to the nearest minor unit. Currencies are never converted or added together. |
| ARR | MRR × 12. | A run rate, not booked cash. |
| Active paid subscriptions | ACTIVE or CANCEL_SCHEDULED, **excluding complimentary grants**. | |
| Complimentary | ACTIVE subscriptions flagged `complimentary`: access granted by an administrator without payment. | Deliberately excluded from MRR, ARR and active-paid. |
| Trialing / expiring in 24h | TRIALING subscriptions, and those whose trial ends within a day. | |
| Trial conversion rate | Completed trials that became active paid, ÷ all completed trials. Excludes complimentary. | A trial still running is not counted as failed. |
| Past due | `status = PAST_DUE`. | |
| Cash collected | Successful `BillingTransaction` amounts by paid date, per currency. | Gross; distinct from MRR. No provider payout or fee estimate is implied. |

## Rules for anything added later

1. Define it here before it reaches the page.
2. State its time scope in the label when it is not the selected period, e.g. "(24h)", "all time".
3. Distinguish **Loading**, **Error**, **No data** and a true **0**. A failed query must never
   render as zero.
4. No metric may sum unconverted currencies, and no chart may be drawn from fabricated points.
5. Every KPI and segment links to the filtered records behind it; no dead-end numbers.

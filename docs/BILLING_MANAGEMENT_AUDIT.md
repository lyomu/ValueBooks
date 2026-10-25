# Platform Admin subscription and billing audit

Updated 2026-10-24. This records the implementation paths reviewed for the billing-management redesign.

## Source of truth and lifecycle

- `PlanTier` groups monthly and yearly `Plan` rows. Prices are integer minor units. An active Paystack plan code is required for recurring checkout; checkout reads the server catalog and compares Paystack amount, currency, and interval before initializing a transaction.
- Public pricing reads `/billing/plans` on each server request. If the catalog is unavailable, price cards are suppressed. Signup's plan picker reads the same public catalog. Checkout never trusts a browser-supplied amount.
- Onboarding starts a cardless Professional trial. `trialEndsAt` is stored on the subscription and scheduled reminder/expiry jobs use that date. Existing trials keep their stored dates when future reminder timing changes.
- Successful signed Paystack events activate or renew paid access. The webhook event processing claim and unique transaction reference provide replay protection. Scheduled maintenance reconciles provider state and retries failed notifications; it does not create charges.
- Cancellations keep paid access to the recorded period end. Past-due access uses `BILLING_PAST_DUE_GRACE_DAYS` (default 3) before write operations become read-only. Upgrade and downgrade changes are recorded in `SubscriptionChange`; old provider cancellation is retried after the replacement is confirmed.
- Live entitlements come from plan rows and published entitlement versions. Existing subscribers are pinned to sold entitlements until the governed renewal transition. Complimentary grants are excluded from active paid counts and MRR.
- Dashboard MRR is a forward recurring run rate using the current published price for each active paid subscription. Yearly prices are divided by 12 and rounded per subscription to the nearest minor unit; currencies are reported separately. A published repricing may appear in this run rate before the next renewal payment. It is not recognized revenue or a statement of past billed terms.

## Administration and authorization

- Support can read plan, subscription, provider, and billing history. Operations can run a read-only provider comparison. Superadmin can edit tier copy, publish or retire a tier, link a verified Paystack code, manage entitlements, propose prices, and set the future trial reminder lead. Controllers enforce roles; dialogs require reasons for privileged changes.
- Tier copy changes update the tier and its plan rows in one serializable transaction and write an append-only platform audit event. Prices, provider codes, entitlements, and lifecycle status use separate governed endpoints.
- The existing pricing service deliberately pauses price increases while checkout and Paystack publication can race. Administrators can propose and preview an increase, but publication remains blocked by the existing owner safety decision. A future release must coordinate checkout and publication before enabling that action; this redesign does not bypass the guard.
- Plan detail returns paginated organization subscriptions and administrative events. Price history and entitlement versions are preserved; retirement is refused while nonterminal subscriptions remain.
- The live provider diagnostic compares each active Paystack plan against the catalog without creating provider plans, initiating checkout, or exposing credentials. A linked code alone is labelled as such; it is not represented as a live verification.
- Paystack credentials remain in the API deployment secret store (`PAYSTACK_SECRET_KEY`, with `PAYSTACK_ENVIRONMENT` selecting the matching environment). Platform Admin shows connection and signed-webhook health and gives the webhook path; it never accepts or returns the secret. Credential rotation is an operator deployment action followed by live diagnostics.
- A Superadmin can create a missing Paystack plan from a ValueBooks plan. A provision record is written before the external call. A returned code is saved, read back, checked against price/currency/interval, and linked through the existing audited code-change path. An ambiguous provider response is marked for reconciliation and blocks another create; the administrator can recover by verifying and linking the provider code manually. No existing provider plan is recreated.

## Migration and operational settings

- `20261024160000_add_billing_trial_policy` adds one optional singleton row for `reminderLeadHours` with a database range check, and a provision ledger for Paystack plan creation. It does not backfill or reschedule existing trials. Before an administrator saves a value, scheduling still uses the existing `BILLING_TRIAL_REMINDER_LEAD_HOURS` deployment setting (default 24 hours). After save, the persisted value applies only when new reminder jobs are created.
- Trial duration remains 14 days on Professional with no card and an AI insight cap of 10. Past-due grace remains a deployment setting. Neither is presented as an editable control because changing either would require cross-surface versioning and a migration policy for affected customers.
- No existing plan, subscription, transaction, or provider identifier is rewritten by this migration. The provision ledger starts empty.

## Verification gates

- Focused web and API typechecks, pricing tests, and Paystack plan unit tests can run without external services.
- `platform-billing-management.int.test.ts` covers authorization, audited tier updates, trial reminder policy changes, nonmutating provider diagnostics, and safe Paystack plan provisioning. Existing integration suites cover webhook replay, renewal, entitlement enforcement, plan code validation, price publication, and plan selection.
- The PostgreSQL/Redis-backed integration suites and migration must pass the Jenkins integration stage before merge or deployment. No automated test should send a real customer charge; provider calls in integration tests are stubbed.

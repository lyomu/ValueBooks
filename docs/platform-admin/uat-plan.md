# Platform Admin: user acceptance test plan (task 6.3)

**Status: blocked. ValueBooks has no staging environment** (the Jenkinsfile and the go-live runbook both describe a
single production box). This plan is ready to run as soon as an environment exists. §4 sets out the choice the owner
needs to make.

**Rules for every UAT environment:**
- Synthetic tenants and users only, on `@example.test` addresses. No real business accounts.
- Paystack **test mode** keys only. No live charge is ever made by UAT.
- Resetting fixtures must not touch any organization that is not a fixture. The fixture seeder (§3) must refuse
  production outright. That is stricter than the demo seed, which runs in production when `ALLOW_DEMO_SEED=true`.

## 1. Who

| Role | Signs in as | Checks |
|---|---|---|
| Support operator | Platform role SUPPORT | Can investigate everything; every action button is absent or refused |
| Operations operator | OPERATIONS | Suspension, trial extension, webhook and job retry, Paystack comparison |
| Superadmin | SUPERADMIN | Plan codes, country-pack lifecycle, session detail on security events |
| Tenant owner | Organization owner, no platform role | Kept out of the console; read-only and billing behaviour in the app |

## 2. Fixtures (master plan §22.4) and what to verify

| # | Fixture | Produce it with | Verify in the console |
|---|---|---|---|
| F1 | User with no membership | Sign up and stop before creating an organization | Users: listed with no memberships; no platform role |
| F2 | Partially onboarded organization | Create an organization and stop before finishing | Organizations: setup filter "not finished"; status DRAFT, not "active" |
| F3 | Trial with 24 h remaining | Fixture seeder: `trialEndsAt` = now + 24 h | Trial reminder sent once (Jobs & queues, Emails); Billing → Trials |
| F4 | Expired unpaid trial | Seeder: `TRIAL_EXPIRED` | Tenant writes refused with `SUBSCRIPTION_READ_ONLY`; billing pages still writable; exports work |
| F5 | Starter active | Paystack test checkout | Subscription ACTIVE; Providers 8/8; transaction recorded once |
| F6 | Growth near its invoice limit | Seeder: issued invoices up to limit − 1 | One more succeeds, the next is refused; the count resets next month on an annual plan |
| F7 | Professional with projects | Seeder | Project limit 25 enforced; Growth cannot create active projects |
| F8 | Advanced active | Paystack test checkout | Approval workflows available (Advanced only) |
| F9 | Failed renewal | Paystack test: failing card on renewal | PAST_DUE with *Past due since*; writes refused after the grace days; [runbook](runbooks/failed-subscription-payment.md) works |
| F10 | Duplicate webhook | Replay the same signed test event | Recorded once; one transaction ([webhook-recovery.md](runbooks/webhook-recovery.md)) |
| F11 | Payment that does not match its subscription | Paystack test charge of the wrong amount | Refused; the webhook shows FAILED with the reason; nothing applied |
| F12 | Cancelled at period end | Cancel in the app | CANCEL_SCHEDULED; becomes CANCELLED after the period; records remain viewable |
| F13 | Suspended tenant | Console: suspend | Members get "This organization is suspended"; reactivation restores; audit shows both ([runbook](runbooks/tenant-suspension.md)) |
| F14 | Immutable published tax pack | Any published pack | No edit or delete offered; deprecating changes only what new organizations get ([runbook](runbooks/country-pack-rollback.md)) |
| F15 | Failed email queue job | Point SMTP at an invalid host and send a quote | Jobs & queues → Email queue shows it with a redacted reason; Failed (retained) increments |
| F16 | User with repeated failed sign-ins | Sign in with a wrong password several times | Security events: "Failed sign-in attempt" ×N with Warning severity; rate limit applies |

**Also verify on every page:** desktop 1440px, tablet 1024px and mobile 390px; keyboard-only navigation; Escape
closes drawers and dialogs; loading, empty, error and a true zero look different; no figure appears without its scope.

## 3. Fixture seeder (not built)

F3, F4, F6 and F7 need states that a person cannot reach quickly by clicking. They need a guarded, idempotent seeder
next to `apps/api/src/demo-seed.service.ts`. It should go through the real services, give each fixture a stable key,
and refuse production. **It has not been built**, pending the environment decision below. F1, F2, F5, F8 to F16 can
be produced by hand or with Paystack test mode.

## 4. Decision for the owner

| Option | What it takes | Trade-off |
|---|---|---|
| **A. Provision a staging environment** (recommended) | A small box or a second compose stack with its own database and Paystack test keys; a Jenkins deploy target | Closest to production; also gives the browser spec a target ([qa-test-plan.md §4](qa-test-plan.md)) |
| B. Local "drill" environment | `infrastructure/backup/setup-drill-db.js`, plus the fixture seeder, run on a developer machine | No infrastructure cost; webhooks need a tunnel; not production-like |
| C. Synthetic tenants in production | Not recommended | Paystack would be live, so payment fixtures are impossible without real charges, and fixtures would mix with customer data |

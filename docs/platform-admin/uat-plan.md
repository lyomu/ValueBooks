# Platform Admin: user acceptance test plan (task 6.3)

**Status: local UAT drill in progress.** The fixture seeder is built and verified locally. The owner decided on
23 Oct 2026 to skip staging deployment and use the documented local drill as the release acceptance check.
Fixture seeding alone does not pass UAT; the scenarios in §2 must be exercised and recorded. The focused Platform
Admin desktop browser spec passed 4/4 locally on 23 Oct 2026, but does not cover all sixteen fixtures.
The **nonpayment acceptance drill for F3, F4, F6 and F7 passed 4/4 in a browser on 23 Oct 2026** (§4a).
F5, F8, F9, F10 and F11 are **untested, not passed**: the owner deferred the Paystack payment scenarios.
F1, F2 and F12 to F16, and the three-viewport and keyboard sweep, have not been run.

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

## 3. Fixture seeder (built)

F3, F4, F6 and F7 need states a person cannot reach quickly by clicking. They are produced by
`apps/api/src/uat-fixture-seed.service.ts`, run with:

```
cd apps/api
ALLOW_UAT_FIXTURES=true npm run uat:fixtures
```

- **Local and staging only.** Production is refused outright, with no override flag (stricter than the demo seed),
  and the seeder also refuses an environment configured with a live Paystack secret key. `ALLOW_UAT_FIXTURES=true`
  is required, so it never runs as a side effect of starting the application. A staging deployment that needs
  fixtures must therefore not run with `NODE_ENV=production`.
- **Through the real services.** Signup, organization creation and finalization, the console's own audited plan
  assignment (`platform.plan_assigned`, reason naming the fixture), invoice issuing and project creation. Plan keys
  are looked up in the catalog and each limit is read back from the organization's entitlements and compared with
  `OFFICIAL_PLAN_CATALOG`; drift fails the run rather than producing a fixture against a number nobody ships.
- **Only two values are written directly**, because no service can express them: how much of a trial is left (F3)
  and that a trial has expired (F4). Both are time.
- **No console access is created.** The seeder acts as an administrator who already holds an active OPERATIONS or
  SUPERADMIN grant, and refuses to run if none exists.
- **Idempotent.** A second run adopts the same organizations and tops each fixture back up to its target. F3's trial
  end is re-based to 24 hours from the run, which is the point of that fixture.
- Owners sign in as `uat.f3@valuebooks.local` … `uat.f7@valuebooks.local`; the run prints the shared password.

F1, F2, F5, F8 to F16 are still produced by hand or with Paystack test mode.

### Verified locally, 23 Oct 2026

Run twice against the development database; the second run changed no counts.

| Fixture | Organization | State produced |
|---|---|---|
| F3 | UAT Trial Ending Ltd | `professional_monthly`, TRIALING, trial ends in 24 h, `trialReminderSentAt` null |
| F4 | UAT Trial Expired Ltd | `professional_monthly`, TRIAL_EXPIRED, trial ended 24 h ago |
| F6 | UAT Growth Invoices Ltd | `growth_monthly` ACTIVE complimentary; 19 issued invoices against a limit of 20, usage counter 19 for 1 Oct – 1 Nov |
| F7 | UAT Professional Projects Ltd | `professional_monthly` ACTIVE complimentary; 24 active projects against a limit of 25 |

Four `platform.plan_assigned` audit rows per run, each naming its fixture. What each fixture is then used to
*verify* is the UAT run itself, which has not happened: the enforcement behaviour behind F4, F6 and F7 is covered
meanwhile by `billing-enforcement.int.test.ts` and `plan-entitlements.int.test.ts`.

## 4. Environment decision (owner, 23 Oct 2026)

Run option B, the local drill, and skip staging deployment. Use isolated synthetic tenants, Paystack test mode,
and the fixtures in §3. Record which §2 scenarios pass and which remain blocked; do not infer a browser result from
integration tests or fixture counts.

### Local browser run, 23 Oct 2026

`phase12-platform.spec.ts --project=desktop` passed 4/4 against the isolated `valuebooks_e2e` database. It exercised
the tenant access boundary, suspend/reactivate, country feature flag targeting, and read-only investigation pages.
Playwright's configured default Postgres port was `55432` while this Compose stack exposed `5433`; the run used
explicit E2E database and maintenance URLs. The missing Playwright Chromium runtime was installed. Next.js 16.4.0
showed a security-upgrade recommendation during the first build attempt; a retry continued and the production web
build completed. This is browser evidence for those four flows, not sign-off for F1–F16 or the three viewport and
keyboard sweep. Paystack test-mode scenarios have not been run.

The available root Paystack configuration was confirmed to be **live mode** on 23 Oct 2026.
No payment UAT was attempted with it. F5, F8, F9, F10 and F11 need the location of test-mode
credentials before the local drill can complete; the owner has been asked for that location,
without requesting that a secret be pasted into chat.

| Option | What it takes | Trade-off |
|---|---|---|
| **A. Provision a staging environment** (recommended) | A small box or a second compose stack with its own database and Paystack test keys; a Jenkins deploy target | Closest to production; also gives the browser spec a target ([qa-test-plan.md §4](qa-test-plan.md)) |
| B. Local "drill" environment | `infrastructure/backup/setup-drill-db.js`, plus the fixture seeder, run on a developer machine | No infrastructure cost; webhooks need a tunnel; not production-like |
| C. Synthetic tenants in production | Not recommended | Paystack would be live, so payment fixtures are impossible without real charges, and fixtures would mix with customer data |

## 4a. Nonpayment acceptance drill, 23 Oct 2026 — passed 4/4

`apps/web/e2e/platform-uat-nonpayment.spec.ts --project=desktop`, against the isolated
`valuebooks_e2e` database. **This is the first browser run of these four scenarios**, so it is also the
first verification of the spec's own selectors.

| # | Scenario exercised in the browser | Result |
|---|---|---|
| F3 / F4 | Console → Billing → Trials: the state filter separates the two fixtures — "Expiring within 24 hours" lists *UAT Trial Ending Ltd*, "Expired" lists *UAT Trial Expired Ltd* | passed (6.3s) |
| F4 | The expired unpaid trial still reads customers (200) and its billing page (200), while a tenant write is refused 403 with `SUBSCRIPTION_READ_ONLY` | passed (4.3s) |
| F6 | Growth at 19 of 20 issued invoices: the 20th issues (200), the 21st is refused 403 with `PLAN_LIMIT_REACHED`, `feature: invoices.issued.max`, `limit: 20` | passed (4.0s) |
| F7 | Professional at 24 of 25 active projects: the 25th is created (201), the 26th is refused 403 with `PLAN_LIMIT_REACHED`, `feature: projects.enabled`, `limit: 25` | passed (3.8s) |

Fixture states seeded for the run: F3 trial ending 24 Oct 13:18Z; F4 trial ended 22 Oct 13:18Z; F6 limit 20 with
19 issued this period; F7 limit 25 with 24 active projects.

**Paystack was not contacted.** The run used the placeholder `PAYSTACK_SECRET_KEY=sk_test_local_nonpayment_drill`,
purely so the live key in the repository root `.env` could not be reached; these four scenarios make no provider
call. The API and seeds ran with their working directory at `apps/api`, whose `.env` holds no Paystack key.

**The drill consumes its own headroom, so it is one-shot per database reset.** After the run F6 sits at 20 of 20
issued and F7 at 25 of 25 active projects. The seeder tops a fixture *up* to its target and never reduces it, so
rerunning the spec without `resetDatabase()` fails at the step that is meant to succeed. Rerun the whole prepare
step, not the spec alone.

### How the run was performed, and two environment findings

1. **`e2e/prepare.mjs` ordering (fixed).** The opt-in `seedUatCatalog()` call moved from immediately after
   `resetDatabase()` to inside the `ALLOW_UAT_FIXTURES` block, after the ordinary demo seed and before the fixture
   seeder. With the official catalog restored *before* the demo seed, the demo tenant resolved to a tier without
   `approval_workflows.enabled` and the demo seed's approval-policy step
   (`demo-week-extras-seed.service.ts`, `approvals.createPolicy`) failed with `PLAN_LIMIT_REACHED` — which is D2's
   Advanced-only gate working correctly on a tenant the demo seed expects to be ungated. The demo seed now runs
   against the absent catalog exactly as it did before, and logs its existing D7 message that no cardless trial was
   started because no ACTIVE professional monthly plan is in the catalog at that point.
2. **The Next.js build gate blocks Playwright's managed web server.** `next build` aborts once with
   `SecurityFatalError` ("Your version of Next.js is affected by a known security vulnerability… Retry the same
   command to continue"). Playwright starts the API and web servers in parallel, so that abort killed the whole run
   before the API prepare finished — twice, and it recurred inside Playwright's environment after a successful
   standalone build. The drill was therefore run against a stack started by hand: `node e2e/prepare.mjs`, then the
   API and the standalone web server, with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300` so Playwright reuses them.
   **No upgrade was performed**; the recommendation stands and is a release-checklist item, not a UAT result.
   One further trap when starting the web server by hand: a failed `next build` leaves
   `.next/standalone/apps/web/.next/static` empty, every `_next/static` chunk 404s, the login page never hydrates
   and the Sign in button does nothing. `node scripts/copy-standalone-static.mjs` then a **server restart** fixes
   it; the server must be restarted after the copy, not before.

Commands used, from `apps/web`:

```
E2E_DATABASE_URL=postgresql://valuebooks:valuebooks@127.0.0.1:5433/valuebooks_e2e E2E_MAINTENANCE_URL=postgresql://valuebooks:valuebooks@127.0.0.1:5433/postgres ALLOW_UAT_FIXTURES=true PAYSTACK_SECRET_KEY=sk_test_local_nonpayment_drill DATABASE_URL=$E2E_DATABASE_URL DATABASE_MIGRATION_URL=$E2E_DATABASE_URL node e2e/prepare.mjs
# then the API (cwd apps/api, API_PORT=3401) and the web server (HOSTNAME=127.0.0.1 PORT=3300), then:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300 ALLOW_UAT_FIXTURES=true   npx playwright test e2e/platform-uat-nonpayment.spec.ts --project=desktop
```

### Still outstanding for 6.3

- F1, F2, F12, F13, F14, F15, F16 in a browser. F13 and F14 are partly covered by `phase12-platform.spec.ts` (4/4),
  which is browser evidence for suspend/reactivate and country packs but is not F-numbered sign-off.
- The viewport sweep (1440, 1024, 390) and keyboard-only navigation.
- F5, F8, F9, F10, F11: **untested**, payment scenarios deferred by the owner. Not passed, not failed.

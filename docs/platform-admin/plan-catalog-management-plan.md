# Phase 7 — Admin-managed plan catalog (O5)

**Status: in progress.** Written 23 Oct 2026 from the owner's decision on O5. §3 is resolved; §4.4, §4.7 and the
price-change backend, the console price flow, and the live-price wiring for the four authored marketing tiers are
built, and §4.7's durable 30-day customer notice now enforces the condition that replaced the blanket refusal of
every increase. New tiers, entitlement versioning and catalog governance remain.

**Goal, in the owner's words:** an administrator must be able to change pricing at any time from the dashboard,
without going through engineering.

## 1. Decisions already made (23 Oct 2026)

| Question | Decision |
|---|---|
| Scope of what is editable | **The full catalog, including creating and retiring tiers** |
| Existing subscribers when a price changes | **Repriced at their next renewal** |
| Who may publish | **A single superadmin**, with a reason and a typed confirmation, audited |
| How the change reaches Paystack | **The console calls Paystack**, creates the plan and verifies it before the price goes live |
| Notice before an increase affecting existing subscribers | **30 days by email**, enforced before publication (owner, 23 Oct 2026) |

Consistent with O7 (country packs), no second approver is required anywhere in the console.

## 2. The three constraints this phase exists to solve

1. **Paystack is the price of record for checkout.** `paystackPlanMismatches`
   (`apps/api/src/billing/paystack-billing.adapter.ts`) refuses to initialise a charge when the catalog price
   disagrees with the remote plan's amount. A price changed only in ValueBooks produces a plan nobody can buy, and
   the Providers page reports drift on every affected row.
2. **The public pricing page is compiled, not fetched.** `apps/web/src/components/marketing/pricing-data.ts` imports
   `OFFICIAL_PLAN_CATALOG` from `@valuebooks/contracts` at build time. Until that page reads live data, an admin
   price change is invisible to customers until the next deploy.
3. **`OFFICIAL_PLAN_CATALOG` is currently the source of truth, enforced by a test.**
   `plan-entitlements.int.test.ts` asserts the database equals the constant for all eight plans. Once prices are
   editable the constant can no longer be truth for price, and the invariant has to be rebuilt rather than deleted —
   otherwise nothing stands between a mistyped price and the public pricing page.

## 3. Dependency — resolved 23 Oct 2026

**Can a live Paystack subscription be repriced without new customer authorisation? Yes.**
[`PUT /plan/:id_or_code`](https://paystack.com/docs/api/plan/) accepts `amount` and takes
**`update_existing_subscriptions`**, which **defaults to `true`**; the response reports "N subscription(s)
affected". Existing subscribers are therefore charged the new amount on their next cycle, on the mandate they
already gave. There is no cancel-and-recreate, no customer re-authorisation and no plan-code migration.

Consequences taken into the build:

- The owner's "reprice at next renewal" maps onto Paystack's native behaviour, so **§4.6 collapsed** from a
  migration job into one flag on the publish call.
- The flag is **sent explicitly on every call and never left to the default**. Whether current subscribers are
  repriced is a commercial decision and must be stated at the call site, not inherited from a provider default that
  could change.
- The Paystack adapter also rejects a runtime call with a missing or non-boolean choice before
  making any provider request. A focused unit test verifies that an omitted flag cannot reach `fetch`.
- Paystack's reported count is **stored next to the count ValueBooks expected**, so a divergence is visible rather
  than assumed away. Paystack is the only thing that knows what it actually touched.
- Still to confirm in Paystack **test mode before the first real price change**: that an increase on an existing
  mandate is charged without customer action in practice, not only per the documentation.

Repricing existing customers remains a commercial act: it needs advance notice (§4.7), and the product has no
notification path for it today.

## 4. Work breakdown

### 4.1 Catalog as data (backend, P0)

- New tables: a **plan revision** (proposed → published, who, when, reason, the full catalog snapshot it publishes)
  and **price history** per plan, so what a subscriber was charged at a point in time is recoverable.
- `Plan.priceMinor` stays the current price; the revision carries the change and the audit trail explains it.
- Creating and retiring tiers means `tierKey` becomes data. Today four tier keys are compiled in
  (`OFFICIAL_PLAN_TIERS`), and the Providers coverage check derives its eight expected keys from them
  (`platform-billing.service.ts:229`). Both become queries over the catalog.

### 4.2 Governance that replaces the constant (P0)

- `OFFICIAL_PLAN_CATALOG` stops being the price invariant and becomes the **seed** for the initial catalog plus the
  **entitlement-key vocabulary** (which keys exist and what they mean). Keep `plan-entitlements.int.test.ts`
  asserting entitlement *keys* and the trial policy; replace its price assertions with a seed-time check.
- A published revision must be internally consistent before it can publish: every ACTIVE tier has both intervals,
  every row has a Paystack code that matches its price, yearly is not more than monthly × 12, no duplicate codes.
  These are the checks the removed inline editor never had.

### 4.3 Entitlement versioning (P0, the expensive part)

Full-catalog scope includes limits. A published change must not retroactively shrink what an existing subscriber
already holds, so resolution has to read *the entitlement set the subscriber is on*, not the plan's current row.
`usage-metering.service.ts` `resolveLimit` and `assertWithinConcurrentLimit` are the two chokepoints; every
`projects.enabled`-style check goes through them, which is what makes this tractable.

### 4.4 Paystack integration on publish — **built**

- `PaystackBillingAdapter.updatePlanAmount` sends `amount`, `currency` and `update_existing_subscriptions`
  explicitly, and parses the affected-subscription count out of Paystack's message (null when the wording changes,
  never reported as zero). `createPlan` is in place for §4.1's new tiers.
- Publishing calls Paystack **first**, then reads the plan back and runs the existing `paystackPlanMismatches`
  check. ValueBooks stores the new price only once the provider agrees, so the failure that is left is the safe one:
  Paystack holds the new price and ValueBooks does not, which leaves checkout working on the old price until it is
  reconciled. The reverse — ValueBooks ahead of Paystack — would stop every charge.
- Verification that cannot complete (Paystack accepted but the read-back failed) proceeds with a logged warning and
  `providerVerified: false` in the response and the audit row, rather than silently claiming verification.

### 4.5 Console (P1)

- Plans & Pricing grows a **propose → preview → publish** flow on `AdminActionDialog`: the preview states, per tier,
  the old and new price, how many organizations are affected and when each would be repriced.
- Creating and retiring a tier, with the retire path refusing while subscribers remain on it.
- Price history per plan, and the revision that changed it, linked from the plan row.

### 4.6 Repricing existing subscribers — **superseded by §3**

No job is needed: Paystack reprices the subscriptions itself when `update_existing_subscriptions` is true. What
remains is reporting, not mechanism — the preview states how many subscriptions will be repriced and that trials are
unaffected, and publication records what Paystack said it touched.

### 4.7 Customer notice (P0, commercial) — **built**

The owner chose **30 days by email** before an increase affects existing subscribers (23 Oct 2026). The interim
blanket refusal of every increase is now replaced by the condition itself.

**The notice is a per-organization durable record, not a flag on the change.** It reuses the existing
`billing_notices` ledger, which is already unique on `(organizationId, eventKey, sourceId)`: the event key is
`billing.plan_price_increase_notice` and the source is the price-change id. So "has this subscriber been told, and
when?" is answered by the same row that recorded the email. Nothing was added to the schema.

- `POST platform/plans/:planId/price-changes/:changeId/notice` (SUPERADMIN) sends, or tops up, the notice to every
  live mandate on the plan — `ACTIVE`, `PAST_DUE`, `CANCEL_SCHEDULED`. Trials are not notified: they are not being
  charged and convert at the new price.
- **Idempotent, and it never buys time back.** An organization already holding a queued notice is skipped and its
  30 days are not restarted. Running it again after new subscribers join notifies only those, which is why
  publication waits on the *newest* notice rather than the first.
- **The clock runs from `queuedAt`, not from the button press.** A notice row whose delivery failed has
  `queuedAt` null and starts nobody's 30 days, so a failed send cannot be mistaken for notice given.
- **Publication condition, checked before Paystack is contacted:** every current repriceable subscriber has a
  queued notice older than 30 days. The refusal names what is missing — how many are unnotified, or when the
  notified ones come out of the period — so a refusal is actionable and changes nothing at the provider.
- **New subscribers during the window are handled by the same rule.** They appear as `awaitingNotice`, which
  refuses publication until they too have had 30 days. The consequence is deliberate and worth stating: a plan
  taking a steady stream of new subscribers will keep deferring an increase until the operator stops topping up
  and lets the window close. Fail-closed was chosen over repricing somebody who was never told.
- **An organization with no billing contact and no owner email cannot be notified at all.** It gets no ledger row,
  so it can never be covered, and publication stays refused. The send reports it as
  `withoutDeliverableAddress` and the console says an address has to be added first — otherwise this would look
  like an unexplained permanent refusal.
- **`update_existing_subscriptions` is still always explicit, and now carries the real decision:** `true` for a
  notified increase and for any reduction; `false` for an increase on a plan with no live mandate. That `false`
  also closes the only remaining race — a customer subscribing between the notice check and the provider call
  keeps the old price instead of being raised without ever being told.
- A monthly reduction still cannot make the active yearly price exceed twelve monthly payments.

**Console (§4.5).** The publish dialog no longer says increases are paused; it states the notice position and
disables confirmation while the condition fails. A **Send notice** action appears beside *Review and publish*
whenever the pending change is an increase, and reports how many notices it queued, how many subscribers are now
covered, the earliest publication date, and any subscriber it could not reach.

**Observed checks, 23 Oct 2026:** API and web `npx tsc --noEmit` (exit 0); targeted
`platform-plan-pricing.int.test.ts` **13/13**, with Paystack stubbed at `fetch` and nobody charged — covering the
refusal while unnotified, the durable ledger row and its copy, idempotency, the audit rows, one day short of 30,
publication at 31 days with `update_existing_subscriptions: true`, a latecomer re-refusing publication, an
undeliverable subscriber, the no-subscriber case publishing with `false`, and the SUPERADMIN floor;
`platform-authorization.int.test.ts` 3/3, which discovers routes dynamically and so confirms the new endpoint
declares a guard and a role floor. **Not done:** a browser pass over the new console flow, and confirming in
Paystack test mode that an increase on an existing mandate is actually charged without customer action.

### 4.8 Public pricing page on live data (P1)

`pricing-data.ts` moves from the compiled constant to a cached read of the public catalog endpoint. Decide the cache
window: it is the delay between an admin publishing and a customer seeing the new price.

## 4a. Built so far (23 Oct 2026)

- Migration `20261023090000_admin_managed_plan_pricing`: `plan_price_changes` (one DRAFT per plan, enforced by a
  partial unique index) and `plan_price_history`, seeded with the price every existing plan carries. Additive; no
  existing row is read or written. Migration drift clean against a shadow database.
- `PlanPricingService`: propose, preview, publish, discard, and a pricing read for one plan. Publishing is
  conditional on the price the proposal was made against, so two administrators cannot overwrite each other; a
  change the plan has moved past is refused and reported as stale in the preview.
- A price increase of more than 50% must be confirmed by repeating the figure. A misplaced decimal point is the
  realistic mistake here, and it would reach every current subscriber at their next renewal.
- Routes: `GET plans/:id/pricing` (SUPPORT), and propose / preview / publish / discard (SUPERADMIN), each audited —
  `platform.plan_price_change_proposed`, `platform.plan_price_published`, `platform.plan_price_change_discarded`.
- **Found and fixed while building:** `createPlan` wrote no opening price-history row, so any plan created after the
  migration would have had a history beginning at its first change rather than at what it launched with, and an old
  charge would have been unexplainable. It now writes the opening row in the same transaction.
- `platform-plan-pricing.int.test.ts` 6/6, Paystack stubbed at `fetch`. Regression: `platform-authorization` 3/3
  (the five new routes declare guards and floors), `platform-audit` 1/1, `platform-plan-code` 5/5,
  `plan-entitlements` 17/17.
- §4.1 groundwork: Providers coverage now includes expected monthly/yearly pairs from the four launch tiers and
  active catalog tiers (the launch baseline remains until durable tier data can expose a wholly missing tier), and
  the verified plan-code action accepts any active Paystack plan. Targeted API typecheck and
  `platform-plan-code.int.test.ts` 6/6 passed on 23 Oct 2026 (Paystack stubbed at `fetch`). This does not yet
  provide a controlled create/retire workflow or show new tiers in the console catalog or public pricing cards.

**Not built yet:** creating and retiring tiers (§4.1 remainder), entitlement versioning (§4.3), the invariant rework
(§4.2), and customer notice (§4.7). The §4.5 console price flow is built but has not had a browser pass. For §4.8,
the homepage teaser and `/pricing` now read the public catalog through `fetchLivePlans()` with 300-second revalidation;
the four authored cards use live prices and fall back to compiled approved prices if the API read fails. New tiers do
not yet appear as marketing cards. The live pages have not had a browser pass. `apps/web` typecheck passed and web
Vitest passed 34/34 (23 Oct 2026); full checks are deferred to Jenkins, including mandatory **Test (integration)**
for Phase 7 billing and authorization work.

## 5. What this phase does not change

Trial length stays `OFFICIAL_TRIAL` (336 hours, Professional access) and is not part of the editable catalog;
`organization.service.ts` and `platform-tenants.service.ts` both read it directly. The console still never mints a
paid subscription (O2): publishing a price does not activate anybody.

## 6. Sequencing

§3 first — it can invalidate §4.6 and the repricing decision itself. Then 4.1 → 4.2 → 4.3 (backend and invariants
before any UI), then 4.4, then 4.5 and 4.8 together so an admin change is visible where customers see it, with 4.6
and 4.7 before the first real price change rather than before merge.

Every step keeps the existing rule: billing, authorization and entitlement changes get integration coverage before
merge, and Jenkins **Test (integration)** is mandatory on this work.

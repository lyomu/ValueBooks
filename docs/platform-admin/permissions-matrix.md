# Platform Admin permissions matrix (Phase 0)

## Roles

Platform roles live in `PlatformAdmin.role`, ordered `SUPPORT < OPERATIONS < SUPERADMIN`. This model is separate from
`OrganizationMember` roles; see `apps/api/src/platform/platform-context.ts`.

Every route uses class-level `SessionGuard` + `PlatformGuard`. Each route can raise the floor with
`@RequirePlatformRole`; the default floor is SUPPORT. The test `apps/api/test/platform-authorization.int.test.ts` sweeps
the registered routes for this metadata.

The frontend `platformRoleAtLeast` (`apps/web/src/lib/platform.ts`) only hides controls. It is not a security boundary.

## `/platform` (`platform.controller.ts`)

| Endpoint | Minimum role | Audited event |
|---|---|---|
| GET `me` | any grant | — |
| GET/POST `admins`, DELETE `admins/:id` | SUPERADMIN | `platform.admin_granted` / `_revoked` |
| GET `organizations[/:id]`, GET `organizations/:id/entitlements` | SUPPORT | — |
| POST `organizations/:id/suspend` / `reactivate` | OPERATIONS | `platform.organization_suspended` / `_reactivated` |
| POST `organizations/:id/plan` | SUPERADMIN | `platform.plan_assigned` |
| GET `users[/:id]` | SUPPORT | — |
| PATCH `users/:id/status` | OPERATIONS | `platform.user_status_changed` |
| GET `plans` | SUPPORT | — |
| POST `plans`, PATCH `plans/:id`, POST/DELETE `plans/:id/entitlements` | SUPERADMIN | `platform.plan_*`, `platform.entitlement_*` |
| PUT `plans/:id/provider-code` | SUPERADMIN | `platform.plan_provider_code_changed` (reason required; old and new code plus Paystack's verified amount, currency and interval). PATCH `plans/:id` refuses a code change |
| GET `feature-flags`, `feature-flags/:flagId` (with history), `feature-flags/audience`, `feature-flags/:key/preview` | SUPPORT | — |
| POST/PATCH flags, POST/DELETE rules | SUPERADMIN | `platform.feature_flag_*` with reason (required except on create) and full before/after state. Rule targets must exist. The approval-governed `phase13.hosted_ai_egress` refuses rule and default changes here (archive still allowed) |
| Hosted-AI egress: GET | SUPPORT | — |
| Hosted-AI egress: approve, revoke | SUPERADMIN | `platform.hosted_ai_egress_*` |
| GET `jobs/health`, `jobs/failed` | SUPPORT | — |
| POST `jobs/:id/retry` | OPERATIONS | `platform.job_retried` |
| GET `security-events`, `audit`, `analytics` | SUPPORT | — |

## `/platform/billing` (`platform-billing.controller.ts`)

| Endpoint | Minimum role | Audited event |
|---|---|---|
| GET `overview`, `subscriptions[/:id]`, `tenants/:id`, `transactions[/:id]`, `trials`, `providers`, `webhooks` | SUPPORT | — |
| GET `revenue`, `issues`, `audit`, `refunds`, GET `tenants/:id/overrides` | OPERATIONS | — |
| POST `trials/:id/extend` | OPERATIONS | `billing.trial_extended` |
| POST `webhooks/:id/retry` | OPERATIONS | `billing.webhook_retried` |
| POST `subscriptions/:id/reconcile` | OPERATIONS | yes |
| POST `transactions/:id/refunds` | OPERATIONS | `billing.refund_requested` |
| POST `tenants/:id/overrides` | OPERATIONS | `billing.override_*` |
| POST `refunds/:id/approve` | SUPERADMIN | `billing.refund_approved` |
| POST `overrides/:id/approve` / `revoke` | SUPERADMIN | `billing.override_*` |

## Country packs (`/localization/country-packs`, `country-packs.controller.ts`)

The admin routes add `PlatformGuard` with SUPERADMIN.

| Endpoint | Audited event |
|---|---|
| GET `admin/all` (with pinned-organization counts and the current version), GET `admin/:code/versions/:version` (with versions and audit history) | — |
| POST create | `platform.country_pack_created` |
| PATCH a version | `platform.country_pack_updated` |
| POST `publish` / `deprecate` (reason required) | `platform.country_pack_published` / `_deprecated` |
| DELETE a draft (reason required) | `platform.country_pack_deleted` |

## Gaps (tracked)

- **Audit append-only is not enforced in the database** (D9, task 5.6).
- **Security events have no role gating beyond SUPPORT.** IP data is stored only as `ipHash`, which is acceptable.
  Revisit if raw network metadata is ever added.
- **There is no time-limited support access to tenant financial data, by design.** Platform reads use metadata and
  aggregates only (`analytics` reads no money columns).

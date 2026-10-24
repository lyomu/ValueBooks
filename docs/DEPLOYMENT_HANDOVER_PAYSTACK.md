# ValueBooks deployment handoff

## Architecture

- Web: Next.js (`apps/web`)
- API: NestJS (`apps/api`)
- Background worker: `apps/api` worker process
- Required services: PostgreSQL, Redis, S3-compatible object storage, SMTP, and ClamAV
- Optional/separate: document-extraction worker

Use Node.js 24+ and npm 11+.

## Production domains

```env
WEB_APP_URL=https://valuebooks.co
NEXT_PUBLIC_API_URL=https://api.valuebooks.co
```

`NEXT_PUBLIC_API_URL` is embedded during the web build, so set it before building the web artifact.
Expose the API over HTTPS at `https://api.valuebooks.co`.

The Paystack webhook endpoint is:

```text
POST https://api.valuebooks.co/api/v1/billing/webhooks/paystack
```

## Required production configuration

Store secrets in the deployment secret manager; never commit them to Git.

```env
NODE_ENV=production
DATABASE_URL=postgresql://<restricted-runtime-role>:<password>@<host>:5432/valuebooks
DATABASE_MIGRATION_URL=postgresql://<migration-owner>:<password>@<host>:5432/valuebooks
REDIS_URL=redis://<host>:6379
S3_ENDPOINT=https://<object-storage-endpoint>
S3_REGION=<region>
S3_ACCESS_KEY=<secret>
S3_SECRET_KEY=<secret>
S3_BUCKET=<production-bucket>
SMTP_HOST=<host>
SMTP_PORT=<port>
EMAIL_FROM=ValueBooks <hello@valuebooks.co>
SECURITY_PEPPER=<unique-random-32+-character-secret>
PAYSTACK_SECRET_KEY=<live-secret>
PAYSTACK_ENVIRONMENT=production
BILLING_LIVE_CHECKOUT_ENABLED=false
```

Use `infrastructure/postgres-runtime-role.sql` as the baseline for the restricted API role. Run
Prisma migrations with the separate migration-owner connection only.

## Deployment order

1. Provision PostgreSQL, Redis, object storage, SMTP, and ClamAV.
2. Configure DNS/TLS for `valuebooks.co` and `api.valuebooks.co`.
3. Build application artifacts:

   ```bash
   npm ci
   npm run build
   ```

4. Run migrations once with the migration-owner credential:

   ```bash
   npm --workspace @valuebooks/api run db:deploy
   ```

5. Start separate long-running processes:

   ```bash
   npm --workspace @valuebooks/api run start
   npm --workspace @valuebooks/web run start
   npm --workspace @valuebooks/api run start:worker
   npm --workspace @valuebooks/api run start:document-extraction-worker
   ```

6. Confirm API health at `https://api.valuebooks.co/api/v1/health`.
7. Add the Paystack webhook after the API is publicly reachable.

## Paystack webhook events

Enable these events only:

```text
charge.success
subscription.create
subscription.disable
subscription.not_renew
invoice.update
invoice.payment_failed
all Refund events
```

`invoice.update` is how a renewal names its subscription: Paystack sends it after each renewal
charge, and ValueBooks records a paid one against that subscription with Paystack's billing
period. A renewal `charge.success` is also matched (by customer and plan), so renewals are still
recorded without it, but `invoice.update` is the more precise signal.

Do not select unrelated card-verification, dispute, payment-request, direct-debit,
pre-authorization, or subscription-expiring-card events.

## Billing configuration

Paddle is retired from active processing. Paystack is the only active provider.

The production plan catalog must contain these eight Paystack codes after migrations. Configure
them in Platform Admin → Billing → Plans & pricing → **Change code** (SUPERADMIN). That action asks
Paystack for the plan first and saves nothing unless its amount, currency and interval match the
catalog row; it requires a reason and records the old and new code in the platform audit log. The
generic plan update no longer accepts a code. Use a controlled database update only if the console
is unavailable, and record why:

| Plan key | Paystack plan code |
| --- | --- |
| `starter_monthly` | `PLN_a18l1jcni5xxcht` |
| `starter_yearly` | `PLN_3bnv6vi7fjfxgvp` |
| `growth_monthly` | `PLN_h3rt0m0ocx48kqn` |
| `growth_yearly` | `PLN_0dhscgqxzditary` |
| `professional_monthly` | `PLN_ew8fgqz9ejmfvxg` |
| `professional_yearly` | `PLN_iol6chdqm1q0oj3` |
| `advanced_monthly` | `PLN_rrmvw1cm6s631ir` |
| `advanced_yearly` | `PLN_r85biwnmgccvfbb` |

The provider-consolidation migration blocks deployment if active Paddle subscriptions exist.
Historical Paddle records remain for audit and are not active checkout or webhook records.

## Controlled checkout rollout

Keep checkout disabled during the first deployment:

```env
BILLING_LIVE_CHECKOUT_ENABLED=false
```

After confirming webhook delivery, signature verification, and all eight catalog mappings, enable
checkout deliberately:

```env
BILLING_LIVE_CHECKOUT_ENABLED=true
```

Run a controlled internal checkout (never a customer charge) and verify successful payment,
subscription activation, entitlements, payment history, cancellation/non-renewal, failed-invoice
handling, and receipt availability.

## Card-data handling

ValueBooks creates a Paystack hosted checkout URL. Customers enter card details on Paystack's
hosted checkout; ValueBooks must not collect or store raw card number, CVV, or expiry details.

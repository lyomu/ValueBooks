import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { AsyncReportExportService } from '../src/reporting/async-report-export.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'tenant-isolation-egress-test',
  userAgent: 'ValueBooks integration test',
};

/**
 * Every way tenant data leaves the main API, and where its isolation is proven:
 *
 * - Sync report export (CSV/XLSX/PDF, `report-export.service.ts`): org-scoped via
 *   `request.organization.id`; covered generically by `authorization-boundary.int.test.ts`
 *   (route carries `:organizationId`).
 * - Async report export request + status (`async-report-export.service.ts`): route-shape
 *   covered generically too, but only against a placeholder id. THIS FILE proves it against a
 *   real execution that reaches `SUCCEEDED` with a real artifact.
 * - Export file download: a signed URL minted only by `status()` once it has confirmed the
 *   caller's own org matches the execution's org. THIS FILE proves org B's `status()` call
 *   never mints one for org A's execution.
 * - Attachment download links (`attachments.service.ts`): route-shape covered generically.
 *   THIS FILE proves it against a real attachment, not a placeholder id.
 * - The 20 portal routes: covered in `portals.int.test.ts` (most are invisible to the generic
 *   matrix -- no `:organizationId` segment).
 * - AI evidence: already covered by `ai.int.test.ts` (Postgres RLS proof + cross-tenant
 *   citation-forgery rejection). Nothing new needed.
 * - Workflow worker (`workflows.service.ts`): covered in `workflow-rules.int.test.ts`
 *   (cross-tenant `UPDATE_AUTOMATION_TASK` payload).
 * - Document-extraction worker: covered in `phase13-document-extraction-pipeline.int.test.ts`
 *   (cross-tenant vendor/category matching, duplicate detection).
 * - Scheduler worker (`scheduler.service.ts`): `beginExecution`/`completeExecution`/
 *   `failExecution` carry no `organizationId` filter at all -- by design, they're reachable only
 *   from the internal worker on a server-generated execution id, never from attacker-supplied
 *   org context. THIS FILE proves acting on one org's execution never mutates another's.
 *
 * Every table above except `ai_runs`/`ai_evidence` relies on application-level
 * `WHERE organizationId = ...` filtering rather than Postgres RLS, and the entire integration
 * suite already runs against the restricted `valuebooks_app` runtime role by default
 * (`test/support/setup-env.ts`), matching the production-style role these tests must run as.
 */
describe('tenant isolation for data egress: exports, attachments, and the scheduler worker', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let expenses: ExpensesService;
  let asyncExports: AsyncReportExportService;
  let scheduler: SchedulerService;

  let ownerA: PublicUser;
  let orgA: OrganizationContext;
  let cookieA: string;
  let ownerB: PublicUser;
  let orgB: OrganizationContext;
  let cookieB: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    expenses = harness.app.get(ExpensesService);
    asyncExports = harness.app.get(AsyncReportExportService);
    scheduler = harness.app.get(SchedulerService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    ({
      owner: ownerA,
      context: orgA,
      cookie: cookieA,
    } = await createOrganization('egress-owner-a@example.test', 'Egress Org A Ltd'));
    ({
      owner: ownerB,
      context: orgB,
      cookie: cookieB,
    } = await createOrganization('egress-owner-b@example.test', 'Egress Org B Ltd'));
  });

  describe('async report exports', () => {
    it("never lets org B read org A's export execution, status, or download URL", async () => {
      const queued = await asyncExports.request(orgA.id, ownerA.id, 'financial.trial-balance', {
        format: 'pdf',
      });
      await asyncExports.execute(queued.executionId);

      const ownStatus = await harness
        .http()
        .get(`${API}/organizations/${orgA.id}/reports/exports/${queued.executionId}`)
        .set('Cookie', cookieA)
        .expect(200);
      const ownBody = (ownStatus.body as { data: { status: string; downloadUrl?: string } }).data;
      expect(ownBody.status).toBe('SUCCEEDED');
      expect(ownBody.downloadUrl).toMatch(/^https?:\/\//);

      const crossTenant = await harness
        .http()
        .get(`${API}/organizations/${orgB.id}/reports/exports/${queued.executionId}`)
        .set('Cookie', cookieB)
        .expect(404);
      expect(crossTenant.body).not.toHaveProperty('data.downloadUrl');

      const unknown = await harness
        .http()
        .get(`${API}/organizations/${orgB.id}/reports/exports/00000000-0000-4000-8000-000000000099`)
        .set('Cookie', cookieB)
        .expect(404);
      expect(crossTenant.body).toEqual(unknown.body);
    });
  });

  describe('attachment downloads', () => {
    it("never lets org B download org A's attachment, even by its real id", async () => {
      const bankAccountA = await ledger.accountBySystemKey(orgA.id, 'bank_default');
      const expenseA = await expenses.createDraft(
        orgA,
        ownerA,
        {
          payeeName: 'Org A vendor',
          expenseDate: '2026-02-01',
          paidThroughAccountId: bankAccountA.id,
          amountMinor: '500',
        },
        metadata,
      );
      const uploadResponse = await harness
        .http()
        .post(`${API}/organizations/${orgA.id}/expenses/${expenseA.id}/attachments`)
        .set('Cookie', cookieA)
        .attach('file', Buffer.from('not a real receipt, just test bytes'), {
          filename: 'receipt.txt',
          contentType: 'text/plain',
        })
        .expect(201);
      const attachmentId = (uploadResponse.body as { data: { id: string } }).data.id;

      // Org B's own download route (its own organizationId passes `OrganizationGuard`), but
      // pointed at org A's real expense and attachment ids. `AttachmentsService#download`
      // filters by `{ id: attachmentId, organizationId, entityType, entityId }` together, so
      // every one of org A's real ids must still 404 under org B's own scope.
      await harness
        .http()
        .get(
          `${API}/organizations/${orgB.id}/expenses/${expenseA.id}/attachments/${attachmentId}/download`,
        )
        .set('Cookie', cookieB)
        .expect(404);

      // Sanity: org A's own download still works.
      const ownDownload = await harness
        .http()
        .get(
          `${API}/organizations/${orgA.id}/expenses/${expenseA.id}/attachments/${attachmentId}/download`,
        )
        .set('Cookie', cookieA)
        .expect(200);
      expect((ownDownload.body as { data: { downloadUrl: string } }).data.downloadUrl).toMatch(
        /^https?:\/\//,
      );
    });
  });

  describe('scheduler execution isolation', () => {
    it("never lets acting on one organization's execution mutate another's", async () => {
      const queuedA = await asyncExports.request(orgA.id, ownerA.id, 'financial.trial-balance', {
        format: 'pdf',
      });
      const queuedB = await asyncExports.request(orgB.id, ownerB.id, 'financial.trial-balance', {
        format: 'pdf',
      });

      const beganA = await scheduler.beginExecution(queuedA.executionId);
      expect(beganA?.organizationId).toBe(orgA.id);
      await scheduler.completeExecution(queuedA.executionId, { marker: 'org-a-result' });

      // Org B's execution must still be untouched by anything done to org A's.
      const stillQueuedB = await harness.prisma.scheduledJobExecution.findUniqueOrThrow({
        where: { id: queuedB.executionId },
      });
      expect(stillQueuedB.status).toBe('QUEUED');
      expect(stillQueuedB.result).toEqual({});

      const beganB = await scheduler.beginExecution(queuedB.executionId);
      expect(beganB?.organizationId).toBe(orgB.id);
      await scheduler.failExecution(queuedB.executionId, new Error('synthetic failure for org B'));

      // Org A's completed execution must still be untouched by org B's failure.
      const stillSucceededA = await harness.prisma.scheduledJobExecution.findUniqueOrThrow({
        where: { id: queuedA.executionId },
      });
      expect(stillSucceededA.status).toBe('SUCCEEDED');
      expect(stillSucceededA.result).toMatchObject({ marker: 'org-a-result' });
    });
  });

  async function createOrganization(
    email: string,
    legalName: string,
  ): Promise<{ owner: PublicUser; context: OrganizationContext; cookie: string }> {
    const user = await harness.prisma.user.create({
      data: {
        email,
        displayName: legalName,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const created = await organizations.create(
      owner,
      { legalName, businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    const context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId: owner.id,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return { owner, context, cookie: `rb_session=${rawToken}` };
  }
});

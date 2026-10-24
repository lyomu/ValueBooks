import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessType } from '@prisma/client';
import { OFFICIAL_PLAN_CATALOG, type OfficialEntitlementKey } from '@valuebooks/contracts';

import { hashIdentifier } from './auth/auth.crypto.js';
import { AuthService, type PublicUser } from './auth/auth.service.js';
import type { RequestMetadata } from './auth/request-context.js';
import { PrismaService } from './database/prisma.service.js';
import { FiscalPeriodsService } from './organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from './organizations/organization-access.service.js';
import type { OrganizationContext } from './organizations/organization-context.js';
import { OrganizationService } from './organizations/organization.service.js';
import type { PlatformContext } from './platform/platform-context.js';
import { PlatformTenantsService } from './platform/platform-tenants.service.js';
import { ProjectsService } from './projects/projects.service.js';
import { CustomersService } from './sales/customers.service.js';
import { InvoicesService } from './sales/invoices.service.js';

const UAT_PASSWORD = 'UatValueBooks1!';
const UAT_CUSTOMER = 'UAT Fixture Customer';

/**
 * The four UAT fixtures (task 6.3, master plan §22.4) that a person cannot reach by clicking:
 * F3 a trial with 24 hours left, F4 an expired unpaid trial, F6 a Growth tenant one invoice below
 * its monthly limit, F7 a Professional tenant one project below its limit.
 *
 * Everything a service can do is done through that service — signup, organization creation and
 * finalization, the console's plan assignment, invoice issuing, project creation — so each fixture
 * carries the real entitlements, the real cardless-trial policy and the real usage counters, and
 * the platform audit log records how it was produced. Only two states are written directly, and
 * only because no service can express them: how much of a trial is left, and that a trial has
 * expired. Both are time, and the clock is not an API.
 *
 * Plans, prices and limits are never invented here. The plan row is looked up by its official
 * catalog key and the limit is read back from the organization's own entitlements and compared with
 * `OFFICIAL_PLAN_CATALOG`, so a fixture that no longer matches the catalog fails loudly instead of
 * testing a number nobody ships.
 *
 * **Local and staging only** — see {@link assertSafeEnvironment}. Idempotent: a second run adopts
 * the organizations it created before and tops each fixture up to its target.
 */
@Injectable()
export class UatFixtureSeedService {
  private readonly logger = new Logger(UatFixtureSeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly organizations: OrganizationService,
    private readonly access: OrganizationAccessService,
    private readonly periods: FiscalPeriodsService,
    private readonly customers: CustomersService,
    private readonly invoices: InvoicesService,
    private readonly projects: ProjectsService,
    private readonly tenants: PlatformTenantsService,
  ) {}

  async run() {
    this.assertSafeEnvironment();
    const metadata: RequestMetadata = {
      ipHash: hashIdentifier('uat-fixture-seed', this.auth.pepper),
      userAgent: 'ValueBooks UAT fixture seed',
    };
    const actor = await this.platformActor();
    return {
      actor: actor.email,
      password: UAT_PASSWORD,
      fixtures: {
        F1: await this.userWithoutMembership(metadata),
        F2: await this.partialOrganization(metadata),
        F3: await this.trialWithOneDayLeft(metadata, actor),
        F4: await this.expiredUnpaidTrial(metadata, actor),
        F6: await this.growthNearInvoiceLimit(metadata, actor),
        F7: await this.professionalNearProjectLimit(metadata, actor),
        F12: await this.cancelAtPeriodEndFixture(metadata, actor),
      },
    };
  }

  /**
   * Production is refused outright, with no override flag — unlike the demo seed — because these
   * fixtures move subscriptions and issue documents. The opt-in variable is required as well, so
   * the seeder can never run as a side effect of starting the application.
   */
  private assertSafeEnvironment(): void {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new Error(
        'UAT fixtures are for local and staging only and are refused in production. A staging deployment that needs them must not run with NODE_ENV=production.',
      );
    }
    if (this.config.get('ALLOW_UAT_FIXTURES') !== 'true') {
      throw new Error('Set ALLOW_UAT_FIXTURES=true to seed the UAT fixtures.');
    }
    if ((this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '').startsWith('sk_live_')) {
      throw new Error(
        'A live Paystack secret key is configured. Refusing to seed fixtures in an environment wired to live payments.',
      );
    }
  }

  /**
   * Acts as an administrator who already exists rather than granting itself console access: a
   * seeding script must not be able to create a way into the Platform Admin console.
   */
  private async platformActor(): Promise<PlatformContext> {
    const grant = await this.prisma.platformAdmin.findFirst({
      where: { status: 'ACTIVE', role: { in: ['OPERATIONS', 'SUPERADMIN'] } },
      orderBy: { grantedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { email: true, displayName: true } },
      },
    });
    if (!grant) {
      throw new Error(
        'No active OPERATIONS or SUPERADMIN platform grant exists. Grant one first; the seeder deliberately does not create console access.',
      );
    }
    return {
      id: grant.id,
      userId: grant.userId,
      email: grant.user.email,
      displayName: grant.user.displayName,
      role: grant.role,
    };
  }

  // --- Fixtures -------------------------------------------------------------------------------

  private async userWithoutMembership(metadata: RequestMetadata) {
    const user = await this.auth.provisionVerifiedUserForBootstrap({
      displayName: 'UAT F1 No Membership', email: 'uat.f1@valuebooks.local', password: UAT_PASSWORD,
    }, metadata);
    if (await this.prisma.organizationMember.count({ where: { userId: user.id } }))
      throw new Error('F1 must not have an organization membership.');
    return { userId: user.id };
  }

  private async partialOrganization(metadata: RequestMetadata) {
    const owner = await this.auth.provisionVerifiedUserForBootstrap({
      displayName: 'UAT F2 Owner', email: 'uat.f2@valuebooks.local', password: UAT_PASSWORD,
    }, metadata);
    let organization = await this.prisma.organization.findFirst({ where: {
      legalName: 'UAT Partial Setup Ltd', createdByUserId: owner.id,
    }, select: { id: true, status: true } });
    if (!organization) {
      const created = await this.organizations.create(owner, {
        legalName: 'UAT Partial Setup Ltd', businessType: BusinessType.LIMITED_COMPANY, countryCode: 'KE',
      }, metadata);
      organization = { id: created.id, status: created.status };
    }
    if (organization.status !== 'DRAFT') throw new Error('F2 must remain a draft organization.');
    return { organizationId: organization.id };
  }

  private async cancelAtPeriodEndFixture(metadata: RequestMetadata, actor: PlatformContext) {
    const { organizationId } = await this.tenant('F12', 'UAT Cancellation Ltd', metadata);
    const existing = await this.prisma.organizationSubscription.findUnique({ where: { organizationId } });
    if (existing?.status === 'CANCEL_SCHEDULED') return { organizationId, status: existing.status };
    if (!existing?.providerSubscriptionId) await this.assignPlan(actor, organizationId, 'growth_monthly', 'ACTIVE', 'F12');
    // The remote mandate is synthetic and resolved only by e2e/stub-paystack.cjs at fetch.
    // Never give this fixture a real provider subscription identifier.
    await this.prisma.organizationSubscription.update({ where: { organizationId }, data: {
      billingProvider: 'PAYSTACK', providerSubscriptionId: 'SUB_uat_f12', providerCustomerId: 'CUS_uat_f12',
      currentPeriodStart: new Date(Date.UTC(2026, 9, 1)), currentPeriodEnd: new Date(Date.UTC(2026, 11, 1)),
    } });
    return { organizationId, status: 'ACTIVE' };
  }

  /** F3: the trial-ending reminder is due, and has not been sent. */
  private async trialWithOneDayLeft(metadata: RequestMetadata, actor: PlatformContext) {
    const { organizationId } = await this.tenant('F3', 'UAT Trial Ending Ltd', metadata);
    await this.assignPlan(actor, organizationId, 'professional_monthly', 'TRIALING', 'F3');
    const trialEndsAt = new Date(Date.now() + 24 * 3_600_000);
    // Direct: the console takes a calendar date for a trial end, and this fixture is a time of
    // day. `trialReminderSentAt` is cleared so the scheduled reminder can send exactly once.
    await this.prisma.organizationSubscription.update({
      where: { organizationId },
      data: { trialEndsAt, trialReminderSentAt: null },
    });
    return { organizationId, trialEndsAt: trialEndsAt.toISOString() };
  }

  /** F4: the trial is over and was never paid, so tenant writes are refused. */
  private async expiredUnpaidTrial(metadata: RequestMetadata, actor: PlatformContext) {
    const { organizationId } = await this.tenant('F4', 'UAT Trial Expired Ltd', metadata);
    await this.assignPlan(actor, organizationId, 'professional_monthly', 'TRIALING', 'F4');
    const trialEndsAt = new Date(Date.now() - 24 * 3_600_000);
    // Direct: only the passage of time produces TRIAL_EXPIRED, and the sweep that sets it runs on
    // a schedule rather than on demand.
    await this.prisma.organizationSubscription.update({
      where: { organizationId },
      data: { status: 'TRIAL_EXPIRED', trialEndsAt },
    });
    return { organizationId, trialEndsAt: trialEndsAt.toISOString() };
  }

  /**
   * F6: Growth, one issued invoice below the monthly limit, so the next one succeeds and the one
   * after it is refused.
   */
  private async growthNearInvoiceLimit(metadata: RequestMetadata, actor: PlatformContext) {
    const { organizationId, owner } = await this.tenant('F6', 'UAT Growth Invoices Ltd', metadata);
    await this.assignPlan(actor, organizationId, 'growth_monthly', 'ACTIVE', 'F6');
    const limit = await this.entitlementLimit(organizationId, 'invoices.issued.max', 'growth');
    const context = await this.readyContext(organizationId, owner, metadata);
    const contactId = await this.fixtureCustomer(context, owner, metadata);

    const target = limit - 1;
    for (
      let issued = await this.usedThisPeriod(organizationId, 'invoices.issued.max');
      issued < target;
      issued += 1
    ) {
      const draft = await this.invoices.createDraft(
        context,
        owner,
        {
          contactId,
          lines: [{ description: 'UAT fixture line', quantity: '1', unitPriceMinor: '10000' }],
        },
        metadata,
      );
      await this.invoices.issueInvoice(context, owner, draft.id, metadata);
    }
    return {
      organizationId,
      limit,
      issuedThisPeriod: await this.usedThisPeriod(organizationId, 'invoices.issued.max'),
    };
  }

  /** F7: Professional, one active project below its limit. */
  private async professionalNearProjectLimit(metadata: RequestMetadata, actor: PlatformContext) {
    const { organizationId, owner } = await this.tenant(
      'F7',
      'UAT Professional Projects Ltd',
      metadata,
    );
    await this.assignPlan(actor, organizationId, 'professional_monthly', 'ACTIVE', 'F7');
    const limit = await this.entitlementLimit(organizationId, 'projects.enabled', 'professional');
    const context = await this.readyContext(organizationId, owner, metadata);

    const activeProjects = () =>
      this.prisma.project.count({
        where: { organizationId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
    const target = limit - 1;
    for (let active = await activeProjects(); active < target; active += 1) {
      await this.projects.create(
        context,
        owner,
        { name: `UAT fixture project ${active + 1}` },
        metadata,
      );
    }
    return { organizationId, limit, activeProjects: await activeProjects() };
  }

  // --- Shared steps ---------------------------------------------------------------------------

  /** One owner and one finalized organization per fixture, adopted on a second run. */
  private async tenant(fixture: string, legalName: string, metadata: RequestMetadata) {
    const owner = await this.auth.provisionVerifiedUserForBootstrap(
      {
        displayName: `UAT ${fixture} Owner`,
        email: `uat.${fixture.toLowerCase()}@valuebooks.local`,
        password: UAT_PASSWORD,
      },
      metadata,
    );
    let organization = await this.prisma.organization.findFirst({
      where: { legalName, createdByUserId: owner.id },
      select: { id: true, status: true },
    });
    if (!organization) {
      const created = await this.organizations.create(
        owner,
        { legalName, businessType: BusinessType.LIMITED_COMPANY, countryCode: 'KE' },
        metadata,
      );
      organization = { id: created.id, status: created.status };
    }
    if (organization.status === 'SUSPENDED') {
      throw new Error(`Fixture ${fixture} (${legalName}) is suspended and cannot be reseeded.`);
    }
    if (organization.status === 'DRAFT') {
      await this.organizations.finalize(
        await this.access.requireMembership(owner.id, organization.id),
        owner,
        metadata,
      );
    }
    this.logger.log(`Fixture ${fixture}: organization ${organization.id} (${legalName}).`);
    return { organizationId: organization.id, owner };
  }

  /** The console's own plan assignment, so each state is produced and audited as an operator would. */
  private async assignPlan(
    actor: PlatformContext,
    organizationId: string,
    planKey: string,
    status: 'TRIALING' | 'ACTIVE',
    fixture: string,
  ): Promise<void> {
    const plan = await this.prisma.plan.findUnique({
      where: { key: planKey },
      select: { id: true, status: true },
    });
    if (!plan || plan.status !== 'ACTIVE') {
      throw new Error(
        `The official plan ${planKey} is missing or not ACTIVE in this database. Apply the catalog migrations before seeding fixtures.`,
      );
    }
    await this.tenants.assignPlan(
      actor,
      organizationId,
      {
        planId: plan.id,
        status,
        ...(status === 'ACTIVE' ? { complimentary: true } : {}),
        reason: `UAT fixture ${fixture}: ${planKey} ${status.toLowerCase()} for acceptance testing.`,
      },
      null,
    );
  }

  /** A finalized organization with a fiscal year, which invoicing needs and projects report against. */
  private async readyContext(
    organizationId: string,
    owner: PublicUser,
    metadata: RequestMetadata,
  ): Promise<OrganizationContext> {
    const context = await this.access.requireMembership(owner.id, organizationId);
    const startsOn = `${new Date().getUTCFullYear()}-01-01`;
    const exists = await this.prisma.fiscalYear.findFirst({
      where: { organizationId, startsOn: new Date(`${startsOn}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (!exists) {
      await this.periods.generateFiscalYear(context, owner, { startsOn }, metadata);
    }
    return context;
  }

  private async fixtureCustomer(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
  ): Promise<string> {
    const existing = await this.prisma.contact.findFirst({
      where: { organizationId: context.id, displayName: UAT_CUSTOMER },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.customers.create(
      context,
      owner,
      { displayName: UAT_CUSTOMER },
      metadata,
    );
    return created.id;
  }

  /** Read back from the organization's own entitlements, and checked against the official catalog. */
  private async entitlementLimit(
    organizationId: string,
    key: OfficialEntitlementKey,
    expectedTier: 'growth' | 'professional',
  ): Promise<number> {
    const row = await this.prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId },
      select: {
        plan: {
          select: {
            tierKey: true,
            entitlements: { where: { key }, select: { enabled: true, limitValue: true } },
          },
        },
      },
    });
    if (row.plan.tierKey !== expectedTier) {
      throw new Error(`Expected the ${expectedTier} tier for ${key}, found ${row.plan.tierKey}.`);
    }
    const entitlement = row.plan.entitlements[0];
    if (!entitlement?.enabled || entitlement.limitValue === null) {
      throw new Error(
        `${key} carries no limit on the ${expectedTier} tier, so this fixture has nothing to approach.`,
      );
    }
    const official = OFFICIAL_PLAN_CATALOG[expectedTier].limits[key];
    if (entitlement.limitValue !== official) {
      throw new Error(
        `${key} on the ${expectedTier} tier is ${entitlement.limitValue} in the database but ${String(official)} in the official catalog. Resolve the drift before seeding fixtures.`,
      );
    }
    return entitlement.limitValue;
  }

  /** The usage counter the enforcement path itself reads, for the period it is counting. */
  private async usedThisPeriod(
    organizationId: string,
    resourceKey: OfficialEntitlementKey,
  ): Promise<number> {
    const counter = await this.prisma.usageCounter.findFirst({
      where: { organizationId, resourceKey, periodEnd: { gt: new Date() } },
      orderBy: { periodStart: 'desc' },
      select: { usedCount: true },
    });
    return counter?.usedCount ?? 0;
  }
}

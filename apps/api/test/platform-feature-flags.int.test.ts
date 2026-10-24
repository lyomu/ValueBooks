import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { EntitlementsService } from '../src/platform/entitlements.service.js';
import { PHASE13_FEATURE_FLAGS } from '../src/platform/phase13-feature-flags.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-flags-test', userAgent: 'platform-flags-test' };
const REASON = 'Pilot rollout agreed with product.';

/**
 * Phase 5.1: flag changes carry a reason, rule targets must exist, the approval-governed egress
 * flag cannot be retargeted from the generic console, and preview gives the same answer as runtime.
 */
describe('platform feature-flag management', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let entitlements: EntitlementsService;
  let organizationId: string;
  let planId: string;
  let superadminCookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    entitlements = harness.app.get(EntitlementsService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'flags-owner@example.test',
        displayName: 'Flags Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const organization = await organizations.create(
      owner,
      { legalName: 'Flag Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, organization.id),
      owner,
      metadata,
    );
    organizationId = organization.id;
    await harness.prisma.planTier.create({ data: { key: 'flags', name: 'Flags', status: 'ACTIVE' } });
    const plan = await harness.prisma.plan.create({
      data: { key: 'flags', tierKey: 'flags', name: 'Flags', status: 'ACTIVE', priceMinor: 0n },
    });
    planId = plan.id;
    // finalize() may already have started a trial on the seeded default plan; pin this test's own
    // plan so the PLAN rule below targets a known subscription.
    await harness.prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId,
        status: 'TRIALING',
        trialEndsAt: new Date('2099-01-01T00:00:00Z'),
      },
      update: { planId, intendedPlanId: null },
    });

    const superadmin = await harness.prisma.user.create({
      data: {
        email: 'flags-superadmin@example.test',
        displayName: 'Flags Superadmin',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.create({
      data: { userId: superadmin.id, role: 'SUPERADMIN' },
    });
    superadminCookie = await cookieFor(superadmin.id);
  });

  it('requires a reason for every change after creation', async () => {
    const flag = await createFlag('reasons.flag');
    await http()
      .patch(`${API}/platform/feature-flags/${flag.id}`)
      .send({ defaultEnabled: true })
      .expect(400);
    await http()
      .post(`${API}/platform/feature-flags/${flag.id}/rules`)
      .send({ scope: 'GLOBAL', enabled: true, reason: 'short' })
      .expect(400);
    const rule = await setRule(flag.id, { scope: 'GLOBAL', enabled: true });
    await http().delete(`${API}/platform/feature-flags/rules/${rule.id}`).expect(400);
    await expect(
      harness.prisma.featureFlag.findUniqueOrThrow({ where: { id: flag.id } }),
    ).resolves.toMatchObject({ defaultEnabled: false });
    await expect(harness.prisma.featureFlagRule.count({ where: { id: rule.id } })).resolves.toBe(1);
  });

  it('refuses rules whose country, plan or organization does not exist', async () => {
    const flag = await createFlag('targets.flag');
    for (const target of [
      { scope: 'COUNTRY', countryCode: 'QQ' },
      { scope: 'PLAN', planId: '00000000-0000-4000-8000-000000000001' },
      { scope: 'ORGANIZATION', organizationId: '00000000-0000-4000-8000-000000000002' },
    ]) {
      await http()
        .post(`${API}/platform/feature-flags/${flag.id}/rules`)
        .send({ ...target, enabled: true, reason: REASON })
        .expect(400);
    }
    await expect(
      harness.prisma.featureFlagRule.count({ where: { flagId: flag.id } }),
    ).resolves.toBe(0);
    await setRule(flag.id, { scope: 'COUNTRY', countryCode: 'KE', enabled: true });
  });

  it('keeps the approval-governed egress flag out of generic retargeting but lets it be archived', async () => {
    const egress = await harness.prisma.featureFlag.findUniqueOrThrow({
      where: { key: PHASE13_FEATURE_FLAGS.HOSTED_AI_EGRESS },
    });
    await http()
      .post(`${API}/platform/feature-flags/${egress.id}/rules`)
      .send({ scope: 'ORGANIZATION', organizationId, enabled: true, reason: REASON })
      .expect(400);
    await http()
      .patch(`${API}/platform/feature-flags/${egress.id}`)
      .send({ defaultEnabled: true, reason: REASON })
      .expect(400);
    await expect(
      harness.prisma.featureFlagRule.count({ where: { flagId: egress.id } }),
    ).resolves.toBe(0);

    // A rule written by the approval workflow cannot be removed around it either.
    const governed = await harness.prisma.featureFlagRule.create({
      data: { flagId: egress.id, scope: 'ORGANIZATION', organizationId, enabled: true },
    });
    await http()
      .delete(`${API}/platform/feature-flags/rules/${governed.id}`)
      .send({ reason: REASON })
      .expect(400);

    await http()
      .patch(`${API}/platform/feature-flags/${egress.id}`)
      .send({ status: 'ARCHIVED', reason: 'Kill switch drill for egress.' })
      .expect(200);
    const listed = (await http().get(`${API}/platform/feature-flags`).expect(200)).body as {
      data: Array<{ key: string; governedBy: string | null }>;
    };
    expect(listed.data.find((flag) => flag.key === egress.key)?.governedBy).toBe(
      'HOSTED_AI_EGRESS_APPROVAL',
    );
  });

  it('previews an organization exactly as runtime resolves it, including archived flags', async () => {
    const flag = await createFlag('parity.flag');
    await setRule(flag.id, { scope: 'COUNTRY', countryCode: 'KE', enabled: true });
    await setRule(flag.id, { scope: 'PLAN', planId, enabled: false });

    const preview = async () =>
      (
        (
          await http()
            .get(
              `${API}/platform/feature-flags/parity.flag/preview?organizationId=${organizationId}`,
            )
            .expect(200)
        ).body as { data: { enabled: boolean; decidedBy: string; audience: unknown } }
      ).data;

    // The plan rule beats the country rule; the operator supplied neither, only the organization.
    expect(await preview()).toEqual({
      key: 'parity.flag',
      enabled: false,
      decidedBy: 'PLAN',
      audience: { countryCode: 'KE', planId, organizationId },
    });
    await expect(entitlements.isFlagEnabled(organizationId, 'parity.flag')).resolves.toBe(false);

    await setRule(flag.id, { scope: 'ORGANIZATION', organizationId, enabled: true });
    expect(await preview()).toMatchObject({ enabled: true, decidedBy: 'ORGANIZATION' });
    await expect(entitlements.isFlagEnabled(organizationId, 'parity.flag')).resolves.toBe(true);

    await http()
      .patch(`${API}/platform/feature-flags/${flag.id}`)
      .send({ status: 'ARCHIVED', reason: 'Feature shipped to everyone.' })
      .expect(200);
    expect(await preview()).toMatchObject({ enabled: false, decidedBy: 'ARCHIVED' });
    await expect(entitlements.isFlagEnabled(organizationId, 'parity.flag')).resolves.toBe(false);

    await http()
      .get(
        `${API}/platform/feature-flags/parity.flag/preview?organizationId=${organizationId}&countryCode=KE`,
      )
      .expect(400);
  });

  it('records history with reasons and before/after state, and counts a rule audience', async () => {
    const flag = await createFlag('history.flag');
    const rule = await setRule(flag.id, { scope: 'COUNTRY', countryCode: 'KE', enabled: true });
    await http()
      .delete(`${API}/platform/feature-flags/rules/${rule.id}`)
      .send({ reason: 'Pilot ended in Kenya.' })
      .expect(204);

    const detail = (await http().get(`${API}/platform/feature-flags/${flag.id}`).expect(200))
      .body as {
      data: {
        rules: unknown[];
        history: Array<{
          eventKey: string;
          reason: string | null;
          before: unknown;
          after: unknown;
        }>;
      };
    };
    expect(detail.data.rules).toEqual([]);
    // The removed rule is still in the flag's history, found through the flag id it recorded.
    expect(detail.data.history.map((event) => event.eventKey)).toEqual([
      'platform.feature_flag_rule_removed',
      'platform.feature_flag_rule_set',
      'platform.feature_flag_created',
    ]);
    expect(detail.data.history[0]).toMatchObject({
      reason: 'Pilot ended in Kenya.',
      before: { flagId: flag.id, scope: 'COUNTRY', countryCode: 'KE', enabled: true },
    });
    expect(detail.data.history[1]).toMatchObject({
      reason: REASON,
      after: { flagId: flag.id, scope: 'COUNTRY', countryCode: 'KE', enabled: true },
    });

    const listed = (await http().get(`${API}/platform/feature-flags`).expect(200)).body as {
      data: Array<{ id: string; lastChange: { eventKey: string } | null }>;
    };
    expect(listed.data.find((candidate) => candidate.id === flag.id)?.lastChange).toMatchObject({
      eventKey: 'platform.feature_flag_rule_removed',
    });

    const kenyan = await harness.prisma.organization.count({ where: { countryCode: 'KE' } });
    const audience = (
      await http()
        .get(`${API}/platform/feature-flags/audience?scope=COUNTRY&countryCode=KE`)
        .expect(200)
    ).body as { data: { organizations: number } };
    expect(audience.data.organizations).toBe(kenyan);
    expect(kenyan).toBeGreaterThan(0);
  });

  function http() {
    const agent = harness.http();
    const withCookie = (request: ReturnType<typeof agent.get>) =>
      request.set('Cookie', superadminCookie);
    return {
      get: (path: string) => withCookie(agent.get(path)),
      post: (path: string) => withCookie(agent.post(path)),
      patch: (path: string) => withCookie(agent.patch(path)),
      delete: (path: string) => withCookie(agent.delete(path)),
    };
  }

  async function createFlag(key: string): Promise<{ id: string }> {
    return (
      (await http().post(`${API}/platform/feature-flags`).send({ key, name: key }).expect(201))
        .body as { data: { id: string } }
    ).data;
  }

  async function setRule(flagId: string, rule: Record<string, unknown>): Promise<{ id: string }> {
    return (
      (
        await http()
          .post(`${API}/platform/feature-flags/${flagId}/rules`)
          .send({ ...rule, reason: REASON })
          .expect(200)
      ).body as { data: { id: string } }
    ).data;
  }

  async function cookieFor(userId: string): Promise<string> {
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${token}`;
  }
});

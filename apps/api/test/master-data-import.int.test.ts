import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import {
  MasterDataImportService,
  MAX_MASTER_DATA_IMPORT_BYTES,
} from '../src/master-data-import/master-data-import.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'master-data-import-test', userAgent: 'ValueBooks integration test' };

function upload(csv: string, filename = 'import.csv') {
  const buffer = Buffer.from(csv, 'utf8');
  return { originalname: filename, mimetype: 'text/csv', size: buffer.length, buffer };
}

describe('master-data CSV imports (GAPS #15)', () => {
  let harness: TestHarness;
  let imports: MasterDataImportService;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    imports = harness.app.get(MasterDataImportService, { strict: false });
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });
  afterAll(async () => harness.close());
  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'import-owner@example.test',
        displayName: 'Import Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const organization = await organizations.create(
      owner,
      { legalName: 'Import Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, organization.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, organization.id);
  });

  it('previews and commits valid customers, vendors, and catalog items', async () => {
    const customer = upload('displayName,email\nAcme Customer,acme@example.test');
    const vendor = upload('displayName,email\nAcme Vendor,vendor@example.test');
    const item = upload('sku,name,itemType\nSKU-1,Imported service,SERVICE');
    for (const [kind, file, mapping] of [
      ['customers', customer, { displayName: 'displayName', email: 'email' }],
      ['vendors', vendor, { displayName: 'displayName', email: 'email' }],
      ['items', item, { sku: 'sku', name: 'name', itemType: 'itemType' }],
    ] as const) {
      const preview = await imports.run(
        kind,
        context,
        owner,
        file,
        JSON.stringify(mapping),
        undefined,
        true,
        undefined,
        metadata,
      );
      expect(preview.createCount).toBe(1);
      const committed = await imports.run(
        kind,
        context,
        owner,
        file,
        JSON.stringify(mapping),
        undefined,
        false,
        `${kind}-commit`,
        metadata,
      );
      expect(committed.createCount).toBe(1);
    }
    expect(await harness.prisma.contact.count({ where: { organizationId: context.id } })).toBe(1);
    expect(await harness.prisma.vendor.count({ where: { organizationId: context.id } })).toBe(1);
    expect(await harness.prisma.item.count({ where: { organizationId: context.id } })).toBe(1);
  });

  it('reports invalid rows and does not write them', async () => {
    const result = await imports.run(
      'customers',
      context,
      owner,
      upload('displayName,email\n,not-an-email'),
      JSON.stringify({ displayName: 'displayName', email: 'email' }),
      undefined,
      true,
      undefined,
      metadata,
    );
    expect(result.invalidCount).toBe(1);
    expect(result.rows[0]?.errors.join(' ')).toContain('email');
  });

  it('requires duplicate choices and replays an idempotent commit', async () => {
    await harness.prisma.contact.create({
      data: {
        organizationId: context.id,
        type: 'CUSTOMER',
        displayName: 'Existing',
        currency: 'KES',
      },
    });
    const file = upload('displayName,email\nExisting,changed@example.test');
    const mapping = JSON.stringify({ displayName: 'displayName', email: 'email' });
    const preview = await imports.run(
      'customers',
      context,
      owner,
      file,
      mapping,
      undefined,
      true,
      undefined,
      metadata,
    );
    expect(preview.rows[0]?.action).toBe('SKIP');
    const actions = JSON.stringify({ 2: 'UPDATE' });
    const first = await imports.run(
      'customers',
      context,
      owner,
      file,
      mapping,
      actions,
      false,
      'replay-me',
      metadata,
    );
    const replay = await imports.run(
      'customers',
      context,
      owner,
      file,
      mapping,
      actions,
      false,
      'replay-me',
      metadata,
    );
    expect(replay).toEqual(first);
    expect(await harness.prisma.contact.count({ where: { organizationId: context.id } })).toBe(1);
    expect(
      (await harness.prisma.contact.findFirstOrThrow({ where: { organizationId: context.id } }))
        .email,
    ).toBe('changed@example.test');
  });

  it('rejects oversized files before parsing', async () => {
    const buffer = Buffer.alloc(MAX_MASTER_DATA_IMPORT_BYTES + 1, 'a');
    await expect(
      imports.run(
        'customers',
        context,
        owner,
        { originalname: 'too-large.csv', mimetype: 'text/csv', size: buffer.length, buffer },
        '{}',
        undefined,
        true,
        undefined,
        metadata,
      ),
    ).rejects.toThrow('8MB');
  });

  it("never treats another organization's records as import targets", async () => {
    const other = await organizations.create(
      owner,
      { legalName: 'Other Import Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const existing = await harness.prisma.contact.create({
      data: { organizationId: other.id, type: 'CUSTOMER', displayName: 'Private', currency: 'KES' },
    });
    const result = await imports.run(
      'customers',
      context,
      owner,
      upload('displayName,receivableAccountId\nPrivate,'),
      JSON.stringify({ displayName: 'displayName', receivableAccountId: 'receivableAccountId' }),
      undefined,
      true,
      undefined,
      metadata,
    );
    expect(result.createCount).toBe(1);
    expect(result.rows[0]?.match).toBeUndefined();
    expect(existing.organizationId).toBe(other.id);
  });
});

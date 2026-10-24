import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { PrismaService } from '../database/prisma.service.js';

/** The occurrence key and draft document commit together. A legacy template-only claim cannot
 * prove whether an earlier run created a document, so it requires manual reconciliation. */
export async function findOrCreateRecurringDocument(
  prisma: PrismaService,
  organizationId: string,
  operation: string,
  templateId: string,
  occurrenceDate: string,
  resourceType: 'INVOICE' | 'BILL' | 'EXPENSE',
  create: (tx: Prisma.TransactionClient) => Promise<{ id: string }>,
): Promise<string> {
  const key = `${templateId}:${occurrenceDate}`;
  return prisma.$transaction(async (tx) => {
    const lockKey = `${organizationId}:${operation}:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
    const existing = await tx.ledgerIdempotencyKey.findUnique({
      where: { organizationId_operation_key: { organizationId, operation, key } },
    });
    if (existing) {
      if (existing.resourceType !== resourceType) {
        throw new ConflictException(
          'This recurring occurrence has an older claim without a linked document. Reconcile it before retrying.',
        );
      }
      return existing.resourceId;
    }

    const document = await create(tx);
    await tx.ledgerIdempotencyKey.create({
      data: { organizationId, operation, key, resourceType, resourceId: document.id },
    });
    return document.id;
  });
}

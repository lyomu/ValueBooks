import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getCookie } from '../auth/request-context.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { OrganizationAccessService } from './organization-access.service.js';
import { PERMISSION_KEY, type OrganizationRequest } from './organization-context.js';
import { ACTIVE_ORGANIZATION_COOKIE } from './organization-cookie.js';
import type { PermissionKey } from './permission-catalog.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Runs after `SessionGuard`. The client may name an organization through the route, a header, or
 * the active-organization cookie, but the identifier is never trusted on its own: access is
 * resolved from the authenticated user's membership, and a non-member is answered as if the
 * organization does not exist.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new UnauthorizedException('Sign in to continue.');

    const requested =
      singleValue(request.params.organizationId) ??
      singleValue(request.headers['x-organization-id']) ??
      getCookie(request, ACTIVE_ORGANIZATION_COOKIE);

    if (!requested) throw new NotFoundException('Organization not found.');

    const organization = await this.access.requireMembership(request.auth.user.id, requested);
    (request as OrganizationRequest).organization = organization;

    const requiredPermission = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredPermission && !organization.permissions.has(requiredPermission)) {
      throw new ForbiddenException('Your role does not allow this action.');
    }

    // A trial or paid term ending never hides records. Apply the boundary to every tenant write
    // instead of relying on individual modules to remember it. Existing organizations without a
    // subscription row retain their pre-billing access until explicitly migrated.
    const billingAction = /^\/api\/v1\/organizations\/[^/]+\/billing(?:\/|$)/.test(request.originalUrl ?? request.url);
    if (!billingAction && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const subscription = await this.prisma.organizationSubscription.findUnique({
        where: { organizationId: organization.id },
        select: { status: true, trialEndsAt: true, currentPeriodEnd: true, pastDueSince: true },
      });
      const now = Date.now();
      const trialEnded = subscription?.status === 'TRIAL_EXPIRED' ||
        (subscription?.status === 'TRIALING' && subscription.trialEndsAt !== null && subscription.trialEndsAt.getTime() <= now);
      const paidEnded = subscription?.status === 'CANCELLED' ||
        (subscription?.status === 'CANCEL_SCHEDULED' && subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd.getTime() <= now);
      const graceDays = Math.max(0, Number(process.env.BILLING_PAST_DUE_GRACE_DAYS ?? 3));
      const pastDueEnded = subscription?.status === 'PAST_DUE' && subscription.pastDueSince !== null &&
        subscription.pastDueSince.getTime() + graceDays * 86_400_000 <= now;
      if (trialEnded || paidEnded || pastDueEnded) {
        throw new ForbiddenException({
          code: 'SUBSCRIPTION_READ_ONLY',
          message: 'Your subscription is in read-only mode. Your records remain available; choose a plan to continue editing.',
        });
      }
    }

    return true;
  }
}

/** Express allows repeated params and headers; a repeated organization id is treated as absent. */
function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

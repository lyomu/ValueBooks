import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { EntitlementsService } from './entitlements.service.js';
import { PlatformAccessService } from './platform-access.service.js';
import { writePlatformAudit } from './platform-audit.js';
import { PlanPricingService } from './plan-pricing.service.js';
import { PlanEntitlementVersionsService } from './plan-entitlement-versions.service.js';
import { PlatformCatalogService } from './platform-catalog.service.js';
import { HostedAiEgressApprovalService } from './hosted-ai-egress-approval.service.js';
import { RequirePlatformRole, type PlatformRequest } from './platform-context.js';
import { PlatformOperationsService } from './platform-operations.service.js';
import { PlatformTenantsService } from './platform-tenants.service.js';
import { PlatformGuard } from './platform.guard.js';
import {
  AssignPlanDto,
  CreateFeatureFlagDto,
  CreateHostedAiEgressApprovalDto,
  CreatePlanDto,
  CreateTierDto,
  EntitlementDraftValueDto,
  FailedJobSearchDto,
  FlagAudienceDto,
  FlagPreviewDto,
  GrantPlatformAdminDto,
  OrganizationSearchDto,
  PlatformAuditSearchDto,
  PlatformAnalyticsQueryDto,
  QueueNameDto,
  ReactivateOrganizationDto,
  RemoveFlagRuleDto,
  RetryJobDto,
  RevokeHostedAiEgressApprovalDto,
  SecurityEventSearchDto,
  SuspendOrganizationDto,
  UpdateFeatureFlagDto,
  PlanPriceReasonDto,
  ProposePlanPriceDto,
  SetProviderPlanCodeDto,
  UpdatePlanDto,
  UpdateUserStatusDto,
  UpsertEntitlementDto,
  UpsertFlagRuleDto,
  UserSearchDto,
} from './platform.dto.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * The platform-administration console API.
 *
 * Every route sits behind `SessionGuard` then `PlatformGuard`, and declares the minimum platform
 * role it needs with `@RequirePlatformRole`. Declaring it on the route rather than checking inside
 * the service is deliberate: it puts the boundary where a test that walks the registered
 * controllers can see it, which is the same lesson the organization boundary matrix already
 * encodes after Phases 5 and 6 shipped uncovered endpoints.
 *
 * Nothing here reads a tenant's books. Reads are standing and adoption; writes are status, plans,
 * flags, and reference data.
 */
@Controller('platform')
@UseGuards(SessionGuard, PlatformGuard)
export class PlatformController {
  constructor(
    private readonly access: PlatformAccessService,
    private readonly tenants: PlatformTenantsService,
    private readonly catalog: PlatformCatalogService,
    private readonly entitlementVersions: PlanEntitlementVersionsService,
    private readonly pricing: PlanPricingService,
    private readonly hostedEgressApprovals: HostedAiEgressApprovalService,
    private readonly operations: PlatformOperationsService,
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private ipHash(request: PlatformRequest): string | null {
    return requestMetadata(request, this.auth.pepper).ipHash;
  }

  // --- Session -----------------------------------------------------------------------------

  /** Who the console is talking to, and what they may do. The console's first call. */
  @Get('me')
  me(@Req() request: PlatformRequest) {
    return {
      data: {
        userId: request.platform.userId,
        email: request.platform.email,
        displayName: request.platform.displayName,
        role: request.platform.role,
      },
    };
  }

  // --- Administrators ----------------------------------------------------------------------

  @Get('admins')
  @RequirePlatformRole('SUPERADMIN')
  async admins() {
    return { data: await this.access.listAdmins() };
  }

  @Post('admins')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async grantAdmin(@Body() input: GrantPlatformAdminDto, @Req() request: PlatformRequest) {
    const granted = await this.access.grant(request.platform, input.email, input.role, input.note);
    // Non-disclosure: an address without a ValueBooks account fails the same way as one the
    // caller simply mistyped. This endpoint does not confirm who has an account.
    if (!granted) throw new BadRequestException('That address cannot be granted platform access.');
    await this.prisma.$transaction((tx) =>
      writePlatformAudit(tx, request.platform, {
        eventKey: 'platform.admin_granted',
        targetType: 'platform_admin',
        targetId: granted.id,
        after: { role: granted.role },
        reason: input.note ?? null,
        ipHash: this.ipHash(request),
      }),
    );
    return { data: granted };
  }

  @Delete('admins/:platformAdminId')
  @HttpCode(204)
  @RequirePlatformRole('SUPERADMIN')
  async revokeAdmin(
    @Param('platformAdminId', new ParseUUIDPipe()) platformAdminId: string,
    @Req() request: PlatformRequest,
  ) {
    // Losing the last superadmin locks the platform out of its own console, and the only way back
    // would be to reinstate the bootstrap allowlist. Refuse rather than rely on care.
    if (platformAdminId === request.platform.id && (await this.access.activeSuperadmins()) <= 1) {
      throw new BadRequestException('Grant another superadmin before revoking your own access.');
    }
    if (!(await this.access.revoke(platformAdminId))) {
      throw new BadRequestException('That platform grant is not active.');
    }
    await this.prisma.$transaction((tx) =>
      writePlatformAudit(tx, request.platform, {
        eventKey: 'platform.admin_revoked',
        targetType: 'platform_admin',
        targetId: platformAdminId,
        ipHash: this.ipHash(request),
      }),
    );
  }

  // --- Organizations -----------------------------------------------------------------------

  @Get('organizations')
  @RequirePlatformRole('SUPPORT')
  async organizations(@Query() query: OrganizationSearchDto) {
    return this.tenants.searchOrganizations(query);
  }

  @Get('organizations/:organizationId')
  @RequirePlatformRole('SUPPORT')
  async organization(@Param('organizationId', new ParseUUIDPipe()) organizationId: string) {
    return { data: await this.tenants.organizationDetail(organizationId) };
  }

  @Post('organizations/:organizationId/suspend')
  @HttpCode(200)
  @RequirePlatformRole('OPERATIONS')
  async suspend(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: SuspendOrganizationDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.suspendOrganization(
        request.platform,
        organizationId,
        input.reason,
        this.ipHash(request),
      ),
    };
  }

  @Post('organizations/:organizationId/reactivate')
  @HttpCode(200)
  @RequirePlatformRole('OPERATIONS')
  async reactivate(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: ReactivateOrganizationDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.reactivateOrganization(
        request.platform,
        organizationId,
        input.reason,
        this.ipHash(request),
      ),
    };
  }

  @Post('organizations/:organizationId/plan')
  @HttpCode(200)
  @RequirePlatformRole('SUPERADMIN')
  async assignPlan(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: AssignPlanDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.assignPlan(
        request.platform,
        organizationId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Get('organizations/:organizationId/entitlements')
  @RequirePlatformRole('SUPPORT')
  async organizationEntitlements(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return { data: await this.entitlements.forOrganization(organizationId) };
  }

  // --- Users -------------------------------------------------------------------------------

  @Get('users')
  @RequirePlatformRole('SUPPORT')
  async users(@Query() query: UserSearchDto) {
    return this.tenants.searchUsers(query);
  }

  @Get('users/:userId')
  @RequirePlatformRole('SUPPORT')
  async user(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return { data: await this.tenants.userDetail(userId) };
  }

  @Patch('users/:userId/status')
  @RequirePlatformRole('OPERATIONS')
  async updateUserStatus(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateUserStatusDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.updateUserStatus(
        request.platform,
        userId,
        input,
        this.ipHash(request),
      ),
    };
  }

  // --- Plans and entitlements ---------------------------------------------------------------

  @Get('plan-tiers')
  @RequirePlatformRole('SUPPORT')
  async planTiers() { return { data: await this.catalog.listTiers() }; }

  @Get('plans/health')
  @RequirePlatformRole('SUPPORT')
  async catalogHealth() { return { data: await this.catalog.catalogHealth() }; }

  @Post('plan-tiers')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async createTier(@Body() input: CreateTierDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.createTier(request.platform, input, this.ipHash(request)) };
  }

  @Post('plan-tiers/:key/activate')
  @RequirePlatformRole('SUPERADMIN')
  async activateTier(@Param('key') key: string, @Body() input: PlanPriceReasonDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.activateTier(request.platform, key, input.reason, this.ipHash(request)) };
  }

  @Post('plan-tiers/:key/retire')
  @RequirePlatformRole('SUPERADMIN')
  async retireTier(@Param('key') key: string, @Body() input: PlanPriceReasonDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.retireTier(request.platform, key, input.reason, this.ipHash(request)) };
  }

  @Get('plans')
  @RequirePlatformRole('SUPPORT')
  async plans() {
    return { data: await this.catalog.listPlans() };
  }

  @Post('plans')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async createPlan(@Body() input: CreatePlanDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.createPlan(request.platform, input, this.ipHash(request)) };
  }

  @Patch('plans/:planId')
  @RequirePlatformRole('SUPERADMIN')
  async updatePlan(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: UpdatePlanDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.updatePlan(request.platform, planId, input, this.ipHash(request)),
    };
  }

  @Put('plans/:planId/provider-code')
  @RequirePlatformRole('SUPERADMIN')
  async setProviderPlanCode(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: SetProviderPlanCodeDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.setProviderPlanCode(
        request.platform,
        planId,
        input,
        this.ipHash(request),
      ),
    };
  }

  // --- Plan pricing (phase 7, O5) -------------------------------------------------------------
  //
  // Price changes are proposed, previewed and published rather than edited in place: `updatePlan`
  // above still refuses to reprice a plan that has subscribers. Owner decision, 23 Oct 2026: a
  // single superadmin may publish, and existing subscribers are repriced at their next renewal.

  @Get('plans/:planId/pricing')
  @RequirePlatformRole('SUPPORT')
  async planPricing(@Param('planId', new ParseUUIDPipe()) planId: string) {
    return { data: await this.pricing.planPricing(planId) };
  }

  @Post('plans/:planId/price-changes')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async proposePlanPrice(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: ProposePlanPriceDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.pricing.proposePriceChange(
        request.platform,
        planId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Get('plans/:planId/price-changes/:changeId/preview')
  @RequirePlatformRole('SUPERADMIN')
  async previewPlanPrice(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('changeId', new ParseUUIDPipe()) changeId: string,
  ) {
    return { data: await this.pricing.previewPriceChange(planId, changeId) };
  }

  @Post('plans/:planId/price-changes/:changeId/notice')
  @RequirePlatformRole('SUPERADMIN')
  async sendPlanPriceNotice(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('changeId', new ParseUUIDPipe()) changeId: string,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.pricing.sendPriceIncreaseNotice(
        request.platform,
        planId,
        changeId,
        this.ipHash(request),
      ),
    };
  }

  @Post('plans/:planId/price-changes/:changeId/publish')
  @RequirePlatformRole('SUPERADMIN')
  async publishPlanPrice(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('changeId', new ParseUUIDPipe()) changeId: string,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.pricing.publishPriceChange(
        request.platform,
        planId,
        changeId,
        this.ipHash(request),
      ),
    };
  }

  @Post('plans/:planId/price-changes/:changeId/discard')
  @RequirePlatformRole('SUPERADMIN')
  async discardPlanPrice(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('changeId', new ParseUUIDPipe()) changeId: string,
    @Body() input: PlanPriceReasonDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.pricing.discardPriceChange(
        request.platform,
        planId,
        changeId,
        input.reason,
        this.ipHash(request),
      ),
    };
  }

  @Post('plans/:planId/entitlements')
  @HttpCode(200)
  @RequirePlatformRole('SUPERADMIN')
  async upsertEntitlement(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: UpsertEntitlementDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.upsertEntitlement(
        request.platform,
        planId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Get('plans/:planId/entitlement-versions')
  @RequirePlatformRole('SUPPORT')
  async planEntitlementVersions(@Param('planId', new ParseUUIDPipe()) planId: string) {
    return { data: await this.entitlementVersions.list(planId) };
  }

  @Post('plans/:planId/entitlement-versions')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async createEntitlementDraft(@Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: PlanPriceReasonDto, @Req() request: PlatformRequest) {
    return { data: await this.entitlementVersions.createDraft(request.platform, planId, input.reason, this.ipHash(request)) };
  }

  @Put('plans/:planId/entitlement-versions/:versionId/values')
  @RequirePlatformRole('SUPERADMIN')
  async setEntitlementDraftValue(@Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string, @Body() input: EntitlementDraftValueDto,
    @Req() request: PlatformRequest) {
    return { data: await this.entitlementVersions.setDraftValue(request.platform, planId, versionId, input, this.ipHash(request)) };
  }

  @Get('plans/:planId/entitlement-versions/:versionId/preview')
  @RequirePlatformRole('SUPERADMIN')
  async previewEntitlementDraft(@Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string) {
    return { data: await this.entitlementVersions.preview(planId, versionId) };
  }

  @Post('plans/:planId/entitlement-versions/:versionId/publish')
  @RequirePlatformRole('SUPERADMIN')
  async publishEntitlementDraft(@Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string, @Body() input: PlanPriceReasonDto,
    @Req() request: PlatformRequest) {
    return { data: await this.entitlementVersions.publish(request.platform, planId, versionId, input.reason, this.ipHash(request)) };
  }

  @Delete('plans/:planId/entitlements/:key')
  @HttpCode(204)
  @RequirePlatformRole('SUPERADMIN')
  async removeEntitlement(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('key') key: string,
    @Req() request: PlatformRequest,
  ) {
    await this.catalog.removeEntitlement(request.platform, planId, key, this.ipHash(request));
  }

  // --- Feature flags -------------------------------------------------------------------------

  @Get('feature-flags')
  @RequirePlatformRole('SUPPORT')
  async flags() {
    return { data: await this.catalog.listFlags() };
  }

  /** Declared before `feature-flags/:flagId` so the static segment is not parsed as an id. */
  @Get('feature-flags/audience')
  @RequirePlatformRole('SUPPORT')
  async flagAudience(@Query() query: FlagAudienceDto) {
    return { data: await this.catalog.flagAudience(query) };
  }

  @Get('feature-flags/:flagId')
  @RequirePlatformRole('SUPPORT')
  async flag(@Param('flagId', new ParseUUIDPipe()) flagId: string) {
    return { data: await this.catalog.getFlag(flagId) };
  }

  @Post('feature-flags')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async createFlag(@Body() input: CreateFeatureFlagDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.createFlag(request.platform, input, this.ipHash(request)) };
  }

  @Patch('feature-flags/:flagId')
  @RequirePlatformRole('SUPERADMIN')
  async updateFlag(
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
    @Body() input: UpdateFeatureFlagDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.updateFlag(request.platform, flagId, input, this.ipHash(request)),
    };
  }

  @Post('feature-flags/:flagId/rules')
  @HttpCode(200)
  @RequirePlatformRole('SUPERADMIN')
  async upsertFlagRule(
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
    @Body() input: UpsertFlagRuleDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.upsertFlagRule(
        request.platform,
        flagId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Delete('feature-flags/rules/:ruleId')
  @HttpCode(204)
  @RequirePlatformRole('SUPERADMIN')
  async removeFlagRule(
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: RemoveFlagRuleDto,
    @Req() request: PlatformRequest,
  ) {
    await this.catalog.removeFlagRule(request.platform, ruleId, input.reason, this.ipHash(request));
  }

  /** Explains what a given audience would see, before any tenant matches it. */
  @Get('feature-flags/:key/preview')
  @RequirePlatformRole('SUPPORT')
  async previewFlag(@Param('key') key: string, @Query() query: FlagPreviewDto) {
    return { data: await this.entitlements.preview({ flagKey: key, ...query }) };
  }

  // --- Hosted AI egress ---------------------------------------------------------------------

  /** Support can determine the current status without receiving signer or legal-artifact data. */
  @Get('organizations/:organizationId/hosted-ai-egress-approval')
  @RequirePlatformRole('SUPPORT')
  async hostedAiEgressStatus(@Param('organizationId', new ParseUUIDPipe()) organizationId: string) {
    return { data: await this.hostedEgressApprovals.status(organizationId) };
  }

  /** Full consent metadata is restricted to superadmins. */
  @Get('organizations/:organizationId/hosted-ai-egress-approval/records')
  @RequirePlatformRole('SUPERADMIN')
  async hostedAiEgressRecords(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return { data: await this.hostedEgressApprovals.listRecords(organizationId) };
  }

  @Post('organizations/:organizationId/hosted-ai-egress-approval')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async approveHostedAiEgress(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateHostedAiEgressApprovalDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.hostedEgressApprovals.approve(
        request.platform,
        organizationId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Post('organizations/:organizationId/hosted-ai-egress-approval/:approvalId/revoke')
  @RequirePlatformRole('SUPERADMIN')
  async revokeHostedAiEgress(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('approvalId', new ParseUUIDPipe()) approvalId: string,
    @Body() input: RevokeHostedAiEgressApprovalDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.hostedEgressApprovals.revoke(
        request.platform,
        organizationId,
        approvalId,
        input,
        this.ipHash(request),
      ),
    };
  }

  // --- Operations ----------------------------------------------------------------------------

  @Get('jobs/health')
  @RequirePlatformRole('SUPPORT')
  async queueHealth() {
    return { data: await this.operations.queueHealth() };
  }

  @Get('jobs/failed')
  @RequirePlatformRole('SUPPORT')
  async failedJobs(@Query() query: FailedJobSearchDto) {
    return this.operations.failedJobs(query);
  }

  @Get('jobs/queues/:queue/failed')
  @RequirePlatformRole('SUPPORT')
  async queueFailures(@Param() params: QueueNameDto) {
    return { data: await this.operations.queueFailures(params.queue) };
  }

  @Post('jobs/:executionId/retry')
  @HttpCode(200)
  @RequirePlatformRole('OPERATIONS')
  async retryJob(
    @Param('executionId', new ParseUUIDPipe()) executionId: string,
    @Body() input: RetryJobDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.operations.retryJob(
        request.platform,
        executionId,
        input.reason,
        this.ipHash(request),
      ),
    };
  }

  @Get('security-events')
  @RequirePlatformRole('SUPPORT')
  async securityEvents(@Query() query: SecurityEventSearchDto, @Req() request: PlatformRequest) {
    return this.operations.securityEvents(request.platform, query);
  }

  @Get('audit')
  @RequirePlatformRole('SUPPORT')
  async platformAudit(@Query() query: PlatformAuditSearchDto) {
    return this.operations.platformAudit(query);
  }

  @Get('analytics')
  @RequirePlatformRole('SUPPORT')
  async analytics(@Query() query: PlatformAnalyticsQueryDto) {
    return { data: await this.operations.analytics(query) };
  }
}

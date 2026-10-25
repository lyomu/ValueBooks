import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

import { SessionGuard } from '../auth/session.guard.js';
import { PlatformBillingService } from './platform-billing.service.js';
import { RequirePlatformRole, type PlatformRequest } from './platform-context.js';
import { PlatformGuard } from './platform.guard.js';

class ReasonDto { @IsString() @Length(5, 1000) reason!: string; }
class TrialReminderPolicyDto extends ReasonDto {
  @IsInt() @Min(1) reminderLeadHours!: number;
}
class TrialExtensionDto extends ReasonDto { @IsString() @MaxLength(40) newEnd!: string; }
class RefundRequestDto extends ReasonDto { @IsString() @MaxLength(30) amountMinor!: string; }
class EntitlementOverrideDto extends ReasonDto {
  @IsString() @MaxLength(120) entitlementKey!: string;
  @IsOptional() @IsInt() @Min(0) limitValue?: number | null;
  @IsOptional() @IsBoolean() unlimited?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsString() @MaxLength(40) expiresAt!: string;
}

@Controller('platform/billing')
@UseGuards(SessionGuard, PlatformGuard)
export class PlatformBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  @Get('overview')
  @RequirePlatformRole('SUPPORT')
  async overview() { return { data: await this.billing.overview() }; }

  @Get('revenue')
  @RequirePlatformRole('OPERATIONS')
  async revenue() { return { data: await this.billing.revenue() }; }

  @Get('issues')
  @RequirePlatformRole('OPERATIONS')
  async issues() { return { data: await this.billing.issues() }; }

  @Get('subscriptions')
  @RequirePlatformRole('SUPPORT')
  subscriptions(@Query() query: { page?: string; pageSize?: string; search?: string; status?: string; provider?: string; plan?: string; interval?: string }) {
    return this.billing.subscriptions(query);
  }

  @Get('tenants/:tenantId')
  @RequirePlatformRole('SUPPORT')
  async organizationBilling(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) {
    return { data: await this.billing.organizationBilling(tenantId) };
  }

  @Get('subscriptions/:id')
  @RequirePlatformRole('SUPPORT')
  async subscription(@Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.billing.subscription(id) }; }

  @Get('transactions')
  @RequirePlatformRole('SUPPORT')
  transactions(@Query() query: { page?: string; pageSize?: string; search?: string; status?: string; provider?: string }) {
    return this.billing.transactions(query);
  }

  @Get('transactions/:id')
  @RequirePlatformRole('SUPPORT')
  async transaction(@Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.billing.transaction(id) }; }

  @Get('trials')
  @RequirePlatformRole('SUPPORT')
  trials(@Query() query: { page?: string; pageSize?: string; state?: string }) { return this.billing.trials(query); }

  @Post('trials/:id/extend')
  @RequirePlatformRole('OPERATIONS')
  async extendTrial(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: TrialExtensionDto, @Req() request: PlatformRequest) {
    return { data: await this.billing.extendTrial(id, body.newEnd, body.reason, request.platform) };
  }

  @Get('providers')
  @RequirePlatformRole('SUPPORT')
  async providers() { return { data: await this.billing.providers() }; }

  @Get('configuration')
  @RequirePlatformRole('SUPPORT')
  async configuration() { return { data: await this.billing.configuration() }; }

  @Post('configuration/trial-reminder')
  @RequirePlatformRole('SUPERADMIN')
  async updateTrialReminder(@Body() body: TrialReminderPolicyDto, @Req() request: PlatformRequest) {
    return { data: await this.billing.updateTrialReminder(body.reminderLeadHours, body.reason, request.platform) };
  }

  @Post('providers/diagnostics')
  @RequirePlatformRole('OPERATIONS')
  async providerDiagnostics() { return { data: await this.billing.providerDiagnostics() }; }

  @Get('webhooks')
  @RequirePlatformRole('SUPPORT')
  webhooks(@Query() query: { page?: string; pageSize?: string; state?: string }) { return this.billing.webhooks(query); }

  @Post('webhooks/:id/retry')
  @RequirePlatformRole('OPERATIONS')
  async retryWebhook(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReasonDto, @Req() request: PlatformRequest) {
    return { data: await this.billing.retryWebhook(id, body.reason, request.platform) };
  }

  @Post('subscriptions/:id/reconcile')
  @RequirePlatformRole('OPERATIONS')
  async reconcileSubscription(@Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.billing.reconcileSubscription(id) };
  }

  @Get('audit')
  @RequirePlatformRole('OPERATIONS')
  audits(@Query() query: { page?: string; pageSize?: string; organizationId?: string }) { return this.billing.audits(query); }

  @Get('refunds')
  @RequirePlatformRole('OPERATIONS')
  refunds(@Query() query: { page?: string; pageSize?: string; status?: string }) { return this.billing.refunds(query); }

  @Post('transactions/:id/refunds')
  @RequirePlatformRole('OPERATIONS')
  async requestRefund(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RefundRequestDto, @Req() request: PlatformRequest) {
    return { data: await this.billing.requestRefund(id, body.amountMinor, body.reason, request.platform) };
  }

  @Post('refunds/:id/approve')
  @RequirePlatformRole('SUPERADMIN')
  async approveRefund(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReasonDto, @Req() request: PlatformRequest) {
    return { data: await this.billing.approveRefund(id, body.reason, request.platform) };
  }

  @Get('tenants/:tenantId/overrides')
  @RequirePlatformRole('OPERATIONS')
  async overrides(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) {
    return { data: await this.billing.overrides(tenantId) };
  }

  @Post('tenants/:tenantId/overrides')
  @RequirePlatformRole('OPERATIONS')
  async requestOverride(@Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() body: EntitlementOverrideDto,
    @Req() request: PlatformRequest) {
    return { data: await this.billing.requestOverride({ ...body, organizationId: tenantId }, request.platform) };
  }

  @Post('overrides/:id/approve')
  @RequirePlatformRole('SUPERADMIN')
  async approveOverride(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: PlatformRequest) {
    return { data: await this.billing.approveOverride(id, request.platform) };
  }

  @Post('overrides/:id/revoke')
  @RequirePlatformRole('SUPERADMIN')
  async revokeOverride(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReasonDto, @Req() request: PlatformRequest) {
    return { data: await this.billing.revokeOverride(id, body.reason, request.platform) };
  }
}

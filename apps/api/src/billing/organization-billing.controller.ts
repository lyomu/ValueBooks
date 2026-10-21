import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { SessionGuard } from '../auth/session.guard.js';
import { RequirePermission, type OrganizationRequest } from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { BillingService } from './billing.service.js';

class OrganizationCheckoutDto {
  @IsString() @MaxLength(40) planKey!: string;
  @IsString() @MaxLength(120) idempotencyKey!: string;
  @IsString() @MaxLength(500) successUrl!: string;
  @IsString() @MaxLength(500) cancelUrl!: string;
}
class CancellationDto { @IsString() @MaxLength(500) reason!: string; }
class BillingProfileDto {
  @IsString() @Length(1, 180) contactName!: string;
  @IsEmail() @MaxLength(255) contactEmail!: string;
  @IsString() @Length(2, 2) countryCode!: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
  @IsOptional() @IsString() @MaxLength(40) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(100) taxId?: string;
}

@Controller('organizations/:organizationId/billing')
@UseGuards(SessionGuard, OrganizationGuard)
export class OrganizationBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('organization.view')
  async summary(@Req() request: OrganizationRequest) {
    return { data: await this.billing.organizationSummary(request.organization.id) };
  }

  @Get('transactions')
  @RequirePermission('organization.view')
  async transactions(@Req() request: OrganizationRequest,
    @Query() query: { page?: string; pageSize?: string; status?: string }) {
    return this.billing.transactionHistory(request.organization.id, query.page, query.pageSize, query.status);
  }

  @Get('transactions/:transactionId/document')
  @RequirePermission('organization.view')
  async transactionDocument(@Req() request: OrganizationRequest,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string) {
    return { data: await this.billing.transactionDocument(request.organization.id, transactionId) };
  }

  @Put('details')
  @RequirePermission('organization.update')
  async details(@Req() request: OrganizationRequest, @Body() input: BillingProfileDto) {
    return { data: await this.billing.saveBillingProfile(request.organization.id, request.auth.user.id, input) };
  }

  @Post('checkout')
  @RequirePermission('organization.update')
  async checkout(@Req() request: OrganizationRequest, @Body() input: OrganizationCheckoutDto) {
    return { data: await this.billing.startOrganizationCheckout({
      organizationId: request.organization.id,
      userId: request.auth.user.id,
      userEmail: request.auth.user.email,
      ...input,
    }) };
  }

  @Post('payment-method-link')
  @RequirePermission('organization.update')
  async paymentMethodLink(@Req() request: OrganizationRequest) {
    return { data: await this.billing.paymentMethodUrl(request.organization.id) };
  }

  @Post('cancel')
  @RequirePermission('organization.update')
  async cancel(@Req() request: OrganizationRequest, @Body() input: CancellationDto) {
    return { data: await this.billing.cancelAtPeriodEnd(request.organization.id, request.auth.user.id, input.reason) };
  }

  @Post('resume')
  @RequirePermission('organization.update')
  async resume(@Req() request: OrganizationRequest) {
    return { data: await this.billing.resumeCancellation(request.organization.id, request.auth.user.id) };
  }
}

import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { BillingService } from './billing.service.js';

class PlanIntentDto {
  @IsString() @MaxLength(40) planKey!: string;
}
class IntentDto {
  @IsString() intentId!: string;
  // Only required when the plan has a configured provider and `checkout` actually opens a hosted
  // checkout; `checkout/development-confirm` never reaches that branch.
  @IsOptional() @IsString() @MaxLength(500) successUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) cancelUrl?: string;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('plans') plans() {
    return this.billing.publicPlans().then((data) => ({ data }));
  }
  @Post('registration-intents') @HttpCode(201) intent(@Body() body: PlanIntentDto) {
    return this.billing.createIntent(body.planKey).then((data) => ({ data }));
  }
  @Post('checkout') @UseGuards(SessionGuard) checkout(
    @Body() body: IntentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing
      .checkout(
        body.intentId,
        request.auth.user.id,
        request.auth.user.email,
        body.successUrl,
        body.cancelUrl,
      )
      .then((data) => ({ data }));
  }
  @Post('checkout/development-confirm') @UseGuards(SessionGuard) confirm(
    @Body() body: IntentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing
      .confirmDevelopmentCheckout(body.intentId, request.auth.user.id)
      .then((data) => ({ data }));
  }
}

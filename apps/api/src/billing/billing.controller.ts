import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';

import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { BillingService } from './billing.service.js';

class PlanIntentDto { @IsString() @MaxLength(40) planKey!: string; }
class IntentDto { @IsString() intentId!: string; }

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('plans') plans() { return this.billing.publicPlans().then((data) => ({ data })); }
  @Post('registration-intents') @HttpCode(201) intent(@Body() body: PlanIntentDto) { return this.billing.createIntent(body.planKey).then((data) => ({ data })); }
  @Post('checkout') @UseGuards(SessionGuard) checkout(@Body() body: IntentDto, @Req() request: AuthenticatedRequest) { return this.billing.checkout(body.intentId, request.auth.user.id).then((data) => ({ data })); }
  @Post('checkout/development-confirm') @UseGuards(SessionGuard) confirm(@Body() body: IntentDto, @Req() request: AuthenticatedRequest) { return this.billing.confirmDevelopmentCheckout(body.intentId, request.auth.user.id).then((data) => ({ data })); }
}

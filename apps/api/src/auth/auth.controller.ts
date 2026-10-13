import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { clearActiveOrganizationCookie } from '../organizations/organization-cookie.js';
import { hashIdentifier } from './auth.crypto.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthService } from './auth.service.js';
import {
  EmailDto,
  LoginDto,
  MfaCodeDto,
  ResetPasswordDto,
  SignupDto,
  TokenDto,
  UpdateProfileDto,
} from './auth.dto.js';
import { getCookie, requestMetadata } from './request-context.js';
import {
  clearMfaChallengeCookie,
  clearSessionCookie,
  MFA_CHALLENGE_COOKIE,
  SESSION_COOKIE,
  setMfaChallengeCookie,
  setSessionCookie,
} from './session-cookie.js';
import { SessionGuard, type AuthenticatedRequest } from './session.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('signup')
  @HttpCode(202)
  async signup(
    @Body() input: SignupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:signup:ip:${metadata.ipHash}`, 25, 60 * 60);
    await this.rateLimit.consume(
      `auth:signup:${metadata.ipHash}:${hashIdentifier(input.email, this.auth.pepper)}`,
      5,
      60 * 60,
    );
    const result = await this.auth.signup(input, metadata);
    if (result.challengeToken) setMfaChallengeCookie(response, result.challengeToken);
    return { data: { message: result.message } };
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(@Body() input: EmailDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:verify-resend:${metadata.ipHash}`, 5, 60 * 60);
    return { data: await this.auth.resendVerification(input.email) };
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() input: TokenDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:verify:${metadata.ipHash}`, 12, 60 * 60);
    return { data: await this.auth.verifyEmail(input.token, metadata) };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:login:ip:${metadata.ipHash}`, 50, 15 * 60);
    await this.rateLimit.consume(
      `auth:login:${metadata.ipHash}:${hashIdentifier(input.email, this.auth.pepper)}`,
      8,
      15 * 60,
    );
    const result = await this.auth.login(input, metadata);
    if (result.mfaRequired && result.mfaChallengeToken) {
      setMfaChallengeCookie(response, result.mfaChallengeToken);
      return { data: { user: result.user, mfaRequired: true } };
    }
    if (!result.token) throw new Error('Login did not create a session.');
    setSessionCookie(response, result.token);
    return { data: { user: result.user, mfaRequired: false } };
  }

  @Get('mfa')
  @UseGuards(SessionGuard)
  async mfaStatus(@Req() request: AuthenticatedRequest) {
    return { data: await this.auth.mfaStatus(request.auth.user.id) };
  }

  @Post('mfa/enroll')
  @UseGuards(SessionGuard)
  async enrollMfa(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:mfa-enroll:${request.auth.user.id}`, 3, 60 * 60);
    await this.rateLimit.consume(`auth:mfa-issue:${metadata.ipHash}`, 12, 60 * 60);
    const token = await this.auth.beginMfaEnrollment(request.auth.user);
    setMfaChallengeCookie(response, token);
    return { data: { message: 'Verification code sent.' } };
  }

  @Post('mfa/verify')
  async verifyMfa(
    @Body() input: MfaCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawToken = getCookie(request, MFA_CHALLENGE_COOKIE);
    if (!rawToken) throw new BadRequestException('No verification challenge is active.');
    const result = await this.auth.verifyMfaChallenge(
      rawToken,
      input.code,
      requestMetadata(request, this.auth.pepper),
    );
    clearMfaChallengeCookie(response);
    if (result.kind === 'login' || result.kind === 'signup')
      setSessionCookie(response, result.token);
    return {
      data:
        result.kind === 'login' || result.kind === 'signup'
          ? { user: result.user, mfaRequired: false, signupVerified: result.kind === 'signup' }
          : result.kind === 'enrolled'
            ? { enabled: true }
            : { verified: true },
    };
  }

  @Post('mfa/resend')
  @HttpCode(202)
  async resendMfa(@Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:mfa-resend:${metadata.ipHash}`, 6, 60 * 60);
    const rawToken = getCookie(request, MFA_CHALLENGE_COOKIE);
    if (!rawToken) throw new BadRequestException('No verification challenge is active.');
    await this.auth.resendMfaChallenge(rawToken);
    return { data: { message: 'A new code has been sent.' } };
  }

  @Post('mfa/step-up')
  @UseGuards(SessionGuard)
  async stepUpMfa(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:mfa-step-up:${request.auth.user.id}`, 6, 60 * 60);
    await this.rateLimit.consume(`auth:mfa-issue:${metadata.ipHash}`, 12, 60 * 60);
    const token = await this.auth.beginMfaStepUp(request.auth);
    setMfaChallengeCookie(response, token);
    return { data: { message: 'Verification code sent.' } };
  }

  @Delete('mfa')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async disableMfa(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      request.auth.user.emailMfaEnabled &&
      (!request.auth.mfaVerifiedAt ||
        Date.now() - request.auth.mfaVerifiedAt.getTime() > 15 * 60 * 1000)
    ) {
      throw new ForbiddenException(
        'Verify your email code again before disabling email verification.',
      );
    }
    await this.auth.disableMfa(request.auth.user.id, requestMetadata(request, this.auth.pepper));
    clearSessionCookie(response);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(getCookie(request, SESSION_COOKIE));
    clearSessionCookie(response);
    clearActiveOrganizationCookie(response);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  async updateProfile(@Body() input: UpdateProfileDto, @Req() request: AuthenticatedRequest) {
    return { data: await this.auth.updateProfile(request.auth.user.id, input.displayName) };
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() input: EmailDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:forgot:ip:${metadata.ipHash}`, 25, 60 * 60);
    await this.rateLimit.consume(
      `auth:forgot:${metadata.ipHash}:${hashIdentifier(input.email, this.auth.pepper)}`,
      5,
      60 * 60,
    );
    return { data: await this.auth.forgotPassword(input.email) };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() input: ResetPasswordDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:reset:${metadata.ipHash}`, 8, 60 * 60);
    return { data: await this.auth.resetPassword(input, metadata) };
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  async sessions(@Req() request: AuthenticatedRequest) {
    return {
      data: await this.auth.listSessions(request.auth.user.id, request.auth.sessionId),
    };
  }

  @Delete('sessions/others')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async revokeOthers(@Req() request: AuthenticatedRequest) {
    if (
      request.auth.user.emailMfaEnabled &&
      (!request.auth.mfaVerifiedAt ||
        Date.now() - request.auth.mfaVerifiedAt.getTime() > 15 * 60 * 1000)
    ) {
      throw new ForbiddenException(
        'Verify your email code again before signing out other sessions.',
      );
    }
    await this.auth.revokeOtherSessions(request.auth.user.id, request.auth.sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async revokeSession(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeSession(sessionId, request.auth.user.id);
    if (sessionId === request.auth.sessionId) clearSessionCookie(response);
  }
}

@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  me(@Req() request: AuthenticatedRequest) {
    return { data: request.auth.user };
  }
}

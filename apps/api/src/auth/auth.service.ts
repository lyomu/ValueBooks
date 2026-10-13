import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionTokenPurpose,
  AuthProvider,
  MfaChallengePurpose,
  SessionStatus,
  UserStatus,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { createMfaCode, createOpaqueToken, hashIdentifier, hashPassword, hashToken, verifyPassword } from './auth.crypto.js';
import { AuthMailerService } from './auth-mailer.service.js';
import type { LoginDto, ResetPasswordDto, SignupDto } from './auth.dto.js';
import type { RequestMetadata } from './request-context.js';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_ROTATION_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 10;
const MFA_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_MFA_ATTEMPTS = 5;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  emailMfaEnabled?: boolean;
  profileComplete?: boolean;
  status: UserStatus;
}

export interface SessionContext {
  sessionId: string;
  user: PublicUser;
  mfaVerifiedAt?: Date | null;
  rotatedToken?: string;
}

@Injectable()
export class AuthService {
  private readonly securityPepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AuthMailerService,
    config: ConfigService,
  ) {
    this.securityPepper = config.getOrThrow<string>('SECURITY_PEPPER');
  }

  get pepper(): string {
    return this.securityPepper;
  }

  /**
   * Internal bootstrap path for deterministic fixtures. It is deliberately not exposed by an HTTP
   * controller: normal accounts must prove possession of their email through `verifyEmail`.
   */
  async provisionVerifiedUserForBootstrap(
    input: SignupDto & { displayName: string },
    metadata: RequestMetadata,
  ): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    const verifiedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: input.email },
        create: {
          email: input.email,
          displayName: input.displayName,
          profileCompletedAt: verifiedAt,
          emailVerifiedAt: verifiedAt,
          status: UserStatus.ACTIVE,
        },
        update: {
          displayName: input.displayName,
          profileCompletedAt: verifiedAt,
          emailVerifiedAt: verifiedAt,
          status: UserStatus.ACTIVE,
        },
      });
      await tx.authMethod.upsert({
        where: { userId_provider: { userId: user.id, provider: AuthProvider.PASSWORD } },
        create: { userId: user.id, provider: AuthProvider.PASSWORD, passwordHash },
        update: { passwordHash },
      });
      await tx.actionToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: verifiedAt },
      });
      await this.securityEvent(tx, user.id, 'auth.bootstrap_verified', metadata, {
        outcome: 'provisioned',
      });
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: true,
        profileComplete: true,
        status: user.status,
      };
    });
  }

  async signup(input: SignupDto, metadata: RequestMetadata): Promise<{ message: string; challengeToken?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (existing) {
      if (existing.status === UserStatus.PENDING_VERIFICATION) {
        const challengeToken = await this.createMfaChallenge(existing.id, MfaChallengePurpose.SIGNUP, existing);
        await this.bindRegistrationIntent(input.registrationIntentId, existing.id, input.email);
        return { message: 'Check your email for the verification code.', challengeToken };
      }
      return { message: 'Check your email for the next step.' };
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          displayName: 'New ValueBooks user',
          authMethods: {
            create: { provider: AuthProvider.PASSWORD, passwordHash },
          },
        },
      });
      await this.securityEvent(tx, created.id, 'auth.signup', metadata, { outcome: 'created' });
      return created;
    });

    await this.bindRegistrationIntent(input.registrationIntentId, user.id, input.email);
    const challengeToken = await this.createMfaChallenge(user.id, MfaChallengePurpose.SIGNUP, user);
    return { message: 'Check your email for the verification code.', challengeToken };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === UserStatus.PENDING_VERIFICATION) {
      const token = await this.issueActionToken(
        user.id,
        ActionTokenPurpose.VERIFY_EMAIL,
        VERIFY_TOKEN_TTL_MS,
      );
      await this.mailer.sendVerification(user.email, user.displayName, token);
    }
    return { message: 'If the account needs verification, a new email is on its way.' };
  }

  async verifyEmail(rawToken: string, metadata: RequestMetadata): Promise<{ message: string }> {
    const token = await this.prisma.actionToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });

    if (
      !token ||
      token.purpose !== ActionTokenPurpose.VERIFY_EMAIL ||
      token.consumedAt ||
      token.expiresAt <= new Date()
    ) {
      throw new BadRequestException('This verification link is invalid or has expired.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.actionToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      await tx.actionToken.updateMany({
        where: {
          userId: token.userId,
          purpose: ActionTokenPurpose.VERIFY_EMAIL,
          consumedAt: null,
          id: { not: token.id },
        },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      });
      await this.securityEvent(tx, token.userId, 'auth.email_verified', metadata, {});
    });

    return { message: 'Email verified. You can now sign in.' };
  }

  async updateProfile(userId: string, displayName: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName, profileCompletedAt: new Date() },
    });
    return toPublicUser(user);
  }

  async login(
    input: LoginDto,
    metadata: RequestMetadata,
  ): Promise<{ token?: string; mfaChallengeToken?: string; user: PublicUser; mfaRequired: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { authMethods: { where: { provider: AuthProvider.PASSWORD } } },
    });
    const method = user?.authMethods[0];

    if (!user || !method?.passwordHash) {
      await hashPassword(input.password);
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const passwordMatches = await verifyPassword(method.passwordHash, input.password).catch(
      () => false,
    );
    if (!passwordMatches) {
      await this.prisma.securityEvent.create({
        data: {
          userId: user.id,
          eventKey: 'auth.login_failed',
          severity: 'WARNING',
          ipHash: metadata.ipHash,
          metadata: { reason: 'invalid_credentials' },
        },
      });
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException('Verify your email before signing in.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is not available.');
    }

    if (user.emailMfaEnabledAt) {
      const mfaChallengeToken = await this.createMfaChallenge(user.id, MfaChallengePurpose.LOGIN, user);
      await this.prisma.securityEvent.create({ data: { userId: user.id, eventKey: 'auth.mfa_challenge_issued', ipHash: metadata.ipHash, metadata: { purpose: 'login' } } });
      return { mfaChallengeToken, user: toPublicUser(user), mfaRequired: true };
    }
    const session = await this.createSession(user.id, metadata);
    await this.prisma.securityEvent.create({
      data: {
        userId: user.id,
        eventKey: 'auth.login_succeeded',
        ipHash: metadata.ipHash,
        metadata: { sessionId: session.id },
      },
    });

    return { token: session.rawToken, user: toPublicUser(user), mfaRequired: false };
  }

  async mfaStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailMfaEnabledAt: true } });
    return { enabled: Boolean(user.emailMfaEnabledAt), email: user.email, enabledAt: user.emailMfaEnabledAt?.toISOString() ?? null };
  }

  async beginMfaEnrollment(user: PublicUser): Promise<string> {
    if (!user.emailVerified) throw new ForbiddenException('Verify your email before enabling email verification.');
    return this.createMfaChallenge(user.id, MfaChallengePurpose.ENROLL, user);
  }

  async beginMfaStepUp(context: SessionContext): Promise<string> {
    if (!context.user.emailMfaEnabled) {
      throw new BadRequestException('Email verification is not enabled for this account.');
    }
    return this.createMfaChallenge(context.user.id, MfaChallengePurpose.STEP_UP, context.user, context.sessionId);
  }

  async resendMfaChallenge(rawToken: string): Promise<void> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.failedAttempts >= MAX_MFA_ATTEMPTS || challenge.resendCount >= 3) {
      throw new BadRequestException('This verification challenge cannot be resent. Start again.');
    }
    const code = createMfaCode();
    await this.mailer.sendMfaCode(challenge.user.email, challenge.user.displayName, code);
    await this.prisma.mfaChallenge.update({
      where: { id: challenge.id },
      data: { codeHash: hashIdentifier(code, this.securityPepper), expiresAt: new Date(Date.now() + MFA_CODE_TTL_MS), resendCount: { increment: 1 } },
    });
  }

  async verifyMfaChallenge(rawToken: string, code: string, metadata: RequestMetadata) {
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.failedAttempts >= MAX_MFA_ATTEMPTS) throw new BadRequestException('This verification code is invalid or has expired.');
    if (challenge.codeHash !== hashIdentifier(code, this.securityPepper)) {
      await this.prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { failedAttempts: { increment: 1 } } });
      await this.securityEvent(this.prisma, challenge.userId, 'auth.mfa_verification_failed', metadata, { purpose: challenge.purpose });
      throw new BadRequestException('This verification code is invalid or has expired.');
    }
    const now = new Date();
    await this.prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
    if (challenge.purpose === MfaChallengePurpose.SIGNUP) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: challenge.userId }, data: { emailVerifiedAt: now, status: UserStatus.ACTIVE } });
        await this.securityEvent(tx, challenge.userId, 'auth.signup_email_verified', metadata, {});
      });
      const session = await this.createSession(challenge.userId, metadata, now);
      return { kind: 'signup' as const, token: session.rawToken, user: toPublicUser({ ...challenge.user, emailVerifiedAt: now }) };
    }
    if (challenge.purpose === MfaChallengePurpose.ENROLL) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: challenge.userId }, data: { emailMfaEnabledAt: now } });
        await tx.session.updateMany({ where: { userId: challenge.userId, status: SessionStatus.ACTIVE }, data: { mfaVerifiedAt: now } });
        await this.securityEvent(tx, challenge.userId, 'auth.mfa_enabled', metadata, {});
      });
      return { kind: 'enrolled' as const };
    }
    if (challenge.purpose === MfaChallengePurpose.STEP_UP) {
      if (!challenge.sessionId) throw new BadRequestException('This verification challenge is invalid.');
      await this.prisma.session.updateMany({
        where: { id: challenge.sessionId, userId: challenge.userId, status: SessionStatus.ACTIVE },
        data: { mfaVerifiedAt: now },
      });
      await this.securityEvent(this.prisma, challenge.userId, 'auth.mfa_step_up_succeeded', metadata, { sessionId: challenge.sessionId });
      return { kind: 'step_up' as const };
    }
    const session = await this.createSession(challenge.userId, metadata, now);
    await this.securityEvent(this.prisma, challenge.userId, 'auth.mfa_login_succeeded', metadata, { sessionId: session.id });
    return { kind: 'login' as const, token: session.rawToken, user: toPublicUser(challenge.user) };
  }

  async disableMfa(userId: string, metadata: RequestMetadata): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { emailMfaEnabledAt: null } });
      await tx.session.updateMany({ where: { userId, status: SessionStatus.ACTIVE }, data: { status: SessionStatus.REVOKED, revokedAt: new Date() } });
      await this.securityEvent(tx, userId, 'auth.mfa_disabled', metadata, {});
    });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === UserStatus.ACTIVE) {
      const token = await this.issueActionToken(
        user.id,
        ActionTokenPurpose.RESET_PASSWORD,
        RESET_TOKEN_TTL_MS,
      );
      await this.mailer.sendPasswordReset(user.email, user.displayName, token);
    }
    return { message: 'If an account matches that email, a reset link is on its way.' };
  }

  async resetPassword(
    input: ResetPasswordDto,
    metadata: RequestMetadata,
  ): Promise<{ message: string }> {
    const actionToken = await this.prisma.actionToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });

    if (
      !actionToken ||
      actionToken.purpose !== ActionTokenPurpose.RESET_PASSWORD ||
      actionToken.consumedAt ||
      actionToken.expiresAt <= new Date()
    ) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }

    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.authMethod.update({
        where: { userId_provider: { userId: actionToken.userId, provider: AuthProvider.PASSWORD } },
        data: { passwordHash },
      });
      await tx.actionToken.updateMany({
        where: {
          userId: actionToken.userId,
          purpose: ActionTokenPurpose.RESET_PASSWORD,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: actionToken.userId, status: SessionStatus.ACTIVE },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
      });
      await this.securityEvent(tx, actionToken.userId, 'auth.password_reset', metadata, {
        sessionsRevoked: true,
      });
    });

    return { message: 'Password updated. Sign in with your new password.' };
  }

  async authenticate(rawToken: string | null): Promise<SessionContext> {
    if (!rawToken) throw new UnauthorizedException('Sign in to continue.');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!session || session.status !== SessionStatus.ACTIVE) {
      throw new UnauthorizedException('Your session is no longer valid.');
    }
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { status: SessionStatus.EXPIRED },
      });
      throw new UnauthorizedException('Your session has expired.');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeSession(session.id, session.userId);
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    const shouldRotate = Date.now() - session.lastSeenAt.getTime() >= SESSION_ROTATION_MS;
    if (shouldRotate) {
      const rotatedToken = createOpaqueToken();
      const rotation = await this.prisma.session.updateMany({
        where: { id: session.id, tokenHash: hashToken(rawToken) },
        data: { tokenHash: hashToken(rotatedToken), lastSeenAt: new Date() },
      });
      return {
        sessionId: session.id,
        user: toPublicUser(session.user),
        mfaVerifiedAt: session.mfaVerifiedAt,
        ...(rotation.count === 1 ? { rotatedToken } : {}),
      };
    }

    if (Date.now() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return { sessionId: session.id, user: toPublicUser(session.user), mfaVerifiedAt: session.mfaVerifiedAt };
  }

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(rawToken), status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, lastSeenAt: true, createdAt: true, expiresAt: true },
    });
    return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, id: { not: currentSessionId }, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  private async issueActionToken(
    userId: string,
    purpose: ActionTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const rawToken = createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.actionToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.actionToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);
    return rawToken;
  }

  private async createSession(userId: string, metadata: RequestMetadata, mfaVerifiedAt?: Date) {
    const activeSessions = await this.prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE },
      orderBy: { lastSeenAt: 'asc' },
      select: { id: true },
    });
    if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
      const overflow = activeSessions.slice(0, activeSessions.length - MAX_ACTIVE_SESSIONS + 1);
      await this.prisma.session.updateMany({
        where: { id: { in: overflow.map(({ id }) => id) } },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
      });
    }

    const rawToken = createOpaqueToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        ...(mfaVerifiedAt ? { mfaVerifiedAt } : {}),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { id: session.id, rawToken };
  }

  private async createMfaChallenge(userId: string, purpose: MfaChallengePurpose, user: Pick<PublicUser, 'email' | 'displayName'>, sessionId?: string): Promise<string> {
    const rawToken = createOpaqueToken();
    const code = createMfaCode(purpose === MfaChallengePurpose.SIGNUP ? 6 : 8);
    await this.mailer.sendMfaCode(user.email, user.displayName, code);
    await this.prisma.$transaction([
      this.prisma.mfaChallenge.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.mfaChallenge.create({ data: { userId, purpose, sessionId, tokenHash: hashToken(rawToken), codeHash: hashIdentifier(code, this.securityPepper), expiresAt: new Date(Date.now() + MFA_CODE_TTL_MS) } }),
    ]);
    return rawToken;
  }

  private async bindRegistrationIntent(intentId: string | undefined, userId: string, email: string): Promise<void> {
    if (!intentId) return;
    await this.prisma.registrationIntent.updateMany({
      where: { id: intentId, userId: null, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { userId, email },
    });
  }

  private securityEvent(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    eventKey: string,
    metadata: RequestMetadata,
    details: Prisma.InputJsonObject,
  ) {
    return tx.securityEvent.create({
      data: { userId, eventKey, ipHash: metadata.ipHash, metadata: details },
    });
  }
}

function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
  emailMfaEnabledAt: Date | null;
  profileCompletedAt: Date | null;
  status: UserStatus;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailMfaEnabled: Boolean(user.emailMfaEnabledAt),
    profileComplete: Boolean(user.profileCompletedAt),
    status: user.status,
  };
}

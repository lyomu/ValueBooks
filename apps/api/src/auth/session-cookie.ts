import type { Response } from 'express';

export const SESSION_COOKIE = 'rb_session';
export const MFA_CHALLENGE_COOKIE = 'rb_mfa_challenge';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MFA_CHALLENGE_MS = 10 * 60 * 1000;

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS_MS,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function setMfaChallengeCookie(response: Response, token: string): void {
  response.cookie(MFA_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: MFA_CHALLENGE_MS,
  });
}

export function clearMfaChallengeCookie(response: Response): void {
  response.clearCookie(MFA_CHALLENGE_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

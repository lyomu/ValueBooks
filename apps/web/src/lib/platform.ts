'use client';

import type { PlatformRole, PlatformSession } from '@valuebooks/contracts';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, apiRequest } from './api';

const ROLE_ORDER: readonly PlatformRole[] = ['SUPPORT', 'OPERATIONS', 'SUPERADMIN'];

/** Mirrors the server's privilege order so a screen can hide what it knows will be refused. */
export function platformRoleAtLeast(held: PlatformRole | null, required: PlatformRole): boolean {
  return held !== null && ROLE_ORDER.indexOf(held) >= ROLE_ORDER.indexOf(required);
}

export type PlatformState = 'loading' | 'ready' | 'signed-out' | 'forbidden' | 'error';

export interface PlatformSessionResult {
  session: PlatformSession | null;
  state: PlatformState;
  refresh: () => Promise<void>;
}

/**
 * Resolves the signed-in user's platform grant.
 *
 * The console gates on this rather than on anything stored in the browser: the grant lives in the
 * database, and a revoked administrator must lose the console on their next request, not on their
 * next sign-in. Hiding a control the caller's role cannot use is presentation only — every route
 * enforces the same rule server-side.
 */
export function usePlatformSession(): PlatformSessionResult {
  const shared = useContext(PlatformSessionContext);
  const own = useLoadPlatformSession(shared === null);
  return shared ?? own;
}

/**
 * `PlatformShell` resolves the grant once and shares it, so a page asking for the caller's role
 * reads the shell's answer instead of issuing its own `/platform/me` request. Outside a provider
 * (tests, isolated renders) the hook still loads the session itself.
 */
const PlatformSessionContext = createContext<PlatformSessionResult | null>(null);

export function PlatformSessionProvider({
  value,
  children,
}: {
  value: PlatformSessionResult;
  children: ReactNode;
}) {
  return createElement(PlatformSessionContext.Provider, { value }, children);
}

function useLoadPlatformSession(enabled: boolean): PlatformSessionResult {
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [state, setState] = useState<PlatformState>('loading');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: PlatformSession }>('/platform/me');
      setSession(response.data);
      setState('ready');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setState('signed-out');
      else if (caught instanceof ApiError && caught.status === 403) setState('forbidden');
      else setState('error');
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return { session, state, refresh: load };
}

/** Builds a query string from a filter object, dropping empty values. */
export function platformQuery(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return params.size > 0 ? `?${params.toString()}` : '';
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; totalRows: number };
}

import { NextResponse, type NextRequest } from 'next/server';

import {
  isConsoleAuthPath,
  isMarketingPath,
  isPlatformPath,
  siteOrigins,
  type SiteArea,
  type SiteOrigins,
} from './lib/site-hosts';

function areaForHost(host: string | null, origins: SiteOrigins): SiteArea | undefined {
  if (!host) return undefined;
  const normalized = host.toLowerCase();
  return (Object.keys(origins) as SiteArea[]).find(
    (area) => origins[area] && new URL(origins[area]).host === normalized,
  );
}

function targetArea(current: SiteArea, pathname: string): SiteArea {
  if (isPlatformPath(pathname)) return 'console';
  if (isMarketingPath(pathname)) return 'marketing';
  if (current === 'console' && isConsoleAuthPath(pathname)) return 'console';
  return 'app';
}

/**
 * Returns the absolute URL to redirect to, or null to serve the request. Hosts that are not one of
 * the configured areas (localhost, the box IP, container health checks) are always served as-is.
 */
export function resolveHostRedirect(
  host: string | null,
  pathname: string,
  search: string,
  origins: SiteOrigins = siteOrigins,
): string | null {
  const current = areaForHost(host, origins);
  if (!current) return null;

  if (pathname === '/' && current === 'app') return `${origins.app}/dashboard${search}`;
  if (pathname === '/' && current === 'console') return `${origins.console}/platform${search}`;

  const target = targetArea(current, pathname);
  const targetOrigin = origins[target];
  if (target === current || !targetOrigin) return null;
  return `${targetOrigin}${pathname}${search}`;
}

export function proxy(request: NextRequest) {
  // nginx sets Host from the request; X-Forwarded-Host would be client-controlled there.
  const host = request.headers.get('host');
  const destination = resolveHostRedirect(
    host,
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  // 307 while the split rolls out, so browsers don't cache a redirect we may still adjust.
  return destination ? NextResponse.redirect(destination, 307) : NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|api/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?)$).*)'],
};

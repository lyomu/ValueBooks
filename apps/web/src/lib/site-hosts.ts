export type SiteArea = 'marketing' | 'app' | 'console';

export type SiteOrigins = Record<SiteArea, string | undefined>;

// Literal process.env reads so Next inlines them into the client bundle at build time.
export const siteOrigins: SiteOrigins = {
  marketing: normalizeOrigin(process.env.NEXT_PUBLIC_MARKETING_URL),
  app: normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
  console: normalizeOrigin(process.env.NEXT_PUBLIC_CONSOLE_URL),
};

export const MARKETING_PATHS: readonly string[] = [
  '/accessibility',
  '/accounting',
  '/ai',
  '/contact',
  '/customers',
  '/data-privacy-deletion',
  '/industries',
  '/invoicing',
  '/pricing',
  '/privacy',
  '/product',
  '/security',
  '/terms',
  '/sitemap.xml',
  '/robots.txt',
];

/** Sign-in pages the console must serve itself so a login there lands back on /platform. */
export const CONSOLE_AUTH_PATHS: readonly string[] = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/complete-profile',
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isMarketingPath(pathname: string): boolean {
  return pathname === '/' || MARKETING_PATHS.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isPlatformPath(pathname: string): boolean {
  return matchesPrefix(pathname, '/platform');
}

export function isConsoleAuthPath(pathname: string): boolean {
  return CONSOLE_AUTH_PATHS.some((prefix) => matchesPrefix(pathname, prefix));
}

export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return undefined;
  }
}

function areaUrl(area: SiteArea, path: string): string {
  const origin = siteOrigins[area];
  return origin ? `${origin}${path}` : path;
}

/** Absolute URL on the marketing host, or the bare path when hosts are not configured. */
export function marketingUrl(path: string): string {
  return areaUrl('marketing', path);
}

/** Absolute URL on the customer app host, or the bare path when hosts are not configured. */
export function appUrl(path: string): string {
  return areaUrl('app', path);
}

/** Absolute URL on the platform console host, or the bare path when hosts are not configured. */
export function consoleUrl(path: string): string {
  return areaUrl('console', path);
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeRedirectPath(value: string | undefined | null, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}

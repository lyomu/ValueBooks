'use client';

import {
  Activity,
  Building2,
  Flag,
  Gauge,
  Globe2,
  CreditCard,
  ScrollText,
  ShieldAlert,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { usePlatformSession } from '../lib/platform';
import { BrandLogo } from './brand-logo';

const NAV = [
  { href: '/platform', label: 'Overview', icon: Gauge },
  { href: '/platform/organizations', label: 'Organizations', icon: Building2 },
  { href: '/platform/users', label: 'Users', icon: Users },
  { href: '/platform/feature-flags', label: 'Feature flags', icon: Flag },
  { href: '/platform/country-packs', label: 'Country & tax', icon: Globe2 },
  { href: '/platform/jobs', label: 'Jobs', icon: Activity },
  { href: '/platform/security', label: 'Security', icon: ShieldAlert },
  { href: '/platform/audit', label: 'Audit', icon: ScrollText },
] as const;
const BILLING_NAV = [
  { href: '/platform/billing', label: 'Overview' },
  { href: '/platform/billing/subscriptions', label: 'Subscriptions' },
  { href: '/platform/plans', label: 'Plans & pricing' },
  { href: '/platform/billing/transactions', label: 'Transactions' },
  { href: '/platform/billing/trials', label: 'Trials' },
  { href: '/platform/billing/revenue', label: 'Revenue analytics' },
  { href: '/platform/billing/refunds', label: 'Refunds & adjustments' },
  { href: '/platform/billing/issues', label: 'Billing issues' },
  { href: '/platform/billing/providers', label: 'Payment providers' },
  { href: '/platform/billing/webhooks', label: 'Webhook events' },
  { href: '/platform/billing/audit', label: 'Billing audit logs' },
] as const;

/**
 * The platform console shell — a separate surface from the tenant app, with its own boundary.
 *
 * It shares no chrome with `AppShell` on purpose. The tenant shell is built around an organization
 * switcher and tenant navigation, neither of which a platform administrator has: they are not a
 * member of anything. Reusing it would mean carrying an empty organization context through a
 * console that must never acquire one.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { session, state } = usePlatformSession();
  const pathname = usePathname();

  if (state === 'loading') {
    return <PlatformNotice title="Loading the console" copy="Checking your platform access." />;
  }
  if (state === 'signed-out') {
    return (
      <PlatformNotice
        title="Sign in to continue"
        copy="The platform console needs a signed-in ValueBooks account."
        action={{ href: '/login', label: 'Sign in' }}
      />
    );
  }
  if (state === 'forbidden') {
    return (
      <PlatformNotice
        title="You do not have platform access"
        copy="Platform administration is granted per person by an existing superadmin. If you expected access here, ask them to grant it."
        action={{ href: '/dashboard', label: 'Back to ValueBooks' }}
      />
    );
  }
  if (state === 'error') {
    return (
      <PlatformNotice
        title="The console could not be loaded"
        copy="Refresh to try again."
        action={{ href: '/platform', label: 'Reload' }}
      />
    );
  }

  return (
    <div className="rb-platform">
      <header className="rb-platform__bar">
        <Link href="/platform" className="rb-platform__brand" aria-label="ValueBooks Platform">
          <BrandLogo variant="full" height={26} alt="ValueBooks Platform" priority />
          <span className="rb-platform__badge">Platform</span>
        </Link>
        <div className="rb-platform__identity">
          <span className="rb-platform__role">{session?.role.toLowerCase()}</span>
          <span>{session?.email}</span>
          <Link href="/dashboard">Exit console</Link>
        </div>
      </header>
      <div className="rb-platform__body">
        <nav className="rb-platform__nav" aria-label="Platform console">
          {NAV.slice(0, 3).map((item) => {
            const active = item.href === '/platform'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? 'is-active' : undefined}
              >
                <item.icon aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
          <details className="rb-platform__nav-group" open={pathname.startsWith('/platform/billing') || pathname.startsWith('/platform/plans') ? true : undefined}>
            <summary><CreditCard aria-hidden="true" />Billing &amp; subscriptions</summary>
            <div className="rb-platform__nav-group-links">{BILLING_NAV.map((item) => {
              const active = item.href === '/platform/billing' ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={active ? 'is-active' : undefined}>{item.label}</Link>;
            })}</div>
          </details>
          {NAV.slice(3).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={active ? 'is-active' : undefined}><item.icon aria-hidden="true" />{item.label}</Link>;
          })}
        </nav>
        <main id="main-content" className="rb-platform__main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PlatformNotice({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: { href: string; label: string };
}) {
  return (
    <main id="main-content" className="rb-platform-notice">
      <ShieldAlert aria-hidden="true" />
      <h1>{title}</h1>
      <p>{copy}</p>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </main>
  );
}

/** Standard page heading inside the console, so every screen introduces itself the same way. */
export function PlatformPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="rb-platform__heading">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="rb-platform__heading-actions">{actions}</div> : null}
      </div>
      {children}
    </>
  );
}

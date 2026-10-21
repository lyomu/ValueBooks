'use client';

import {
  Activity,
  Building2,
  Flag,
  Gauge,
  Globe2,
  CreditCard,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  ScrollText,
  ShieldAlert,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { usePlatformSession } from '../lib/platform';
import { appUrl } from '../lib/site-hosts';
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
const BILLING_NAV_ID = 'platform-billing-navigation';

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
  const billingRoute =
    pathname.startsWith('/platform/billing') || pathname.startsWith('/platform/plans');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(billingRoute);
  const mobileLayerRef = useRef<HTMLDivElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setCollapsed(window.sessionStorage.getItem('valuebooks:platform-nav-collapsed') === '1');
    } catch {
      /* Navigation remains usable when storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    setBillingOpen(billingRoute);
    setMobileOpen(false);
  }, [billingRoute, pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const panel = mobileLayerRef.current;
    const toggle = mobileToggleRef.current;
    const close = panel?.querySelector<HTMLButtonElement>(
      '[aria-label="Close platform navigation"]',
    );
    close?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('aside button, aside a')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      toggle?.focus();
    };
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      try {
        window.sessionStorage.setItem('valuebooks:platform-nav-collapsed', current ? '0' : '1');
      } catch {
        /* Keep the in-memory preference. */
      }
      return !current;
    });
  }

  function toggleBillingNavigation() {
    setBillingOpen((current) => !current);
  }

  const navigation = (mobile = false) => (
    <nav className="rb-app-sidebar__nav rb-platform__nav" aria-label="Platform console">
      <div className="rb-platform__nav-section">
        <span className="rb-platform__nav-label">Workspace</span>
        {NAV.slice(0, 3).map((item) => {
          const active =
            item.href === '/platform'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed && !mobile ? item.label : undefined}
              aria-label={collapsed && !mobile ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="rb-platform__nav-section">
        <span className="rb-platform__nav-label">Administration</span>
        <button
          className={billingRoute ? 'rb-nav-group__trigger is-current' : 'rb-nav-group__trigger'}
          type="button"
          title={collapsed && !mobile ? 'Billing & subscriptions' : undefined}
          aria-label={collapsed && !mobile ? 'Billing & subscriptions' : undefined}
          aria-expanded={billingOpen && (!collapsed || mobile)}
          aria-controls={
            collapsed && !mobile ? undefined : mobile ? `${BILLING_NAV_ID}-mobile` : BILLING_NAV_ID
          }
          onClick={() => {
            if (collapsed && !mobile) {
              setCollapsed(false);
              setBillingOpen(true);
            } else toggleBillingNavigation();
          }}
        >
          <CreditCard className="rb-nav-group__icon" aria-hidden="true" />
          <span className="rb-nav-group__label">Billing &amp; subscriptions</span>
          <ChevronDown
            className={billingOpen ? 'rb-nav-group__caret is-open' : 'rb-nav-group__caret'}
            aria-hidden="true"
          />
        </button>
        {billingOpen && (!collapsed || mobile) ? (
          <div
            className="rb-platform__nav-children"
            id={mobile ? `${BILLING_NAV_ID}-mobile` : BILLING_NAV_ID}
          >
            {BILLING_NAV.map((item) => {
              const active =
                item.href === '/platform/billing'
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ) : null}
        {NAV.slice(3).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed && !mobile ? item.label : undefined}
              aria-label={collapsed && !mobile ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );

  if (state === 'loading') {
    return <PlatformNotice title="Loading the console" copy="Checking your platform access." />;
  }
  if (state === 'signed-out') {
    return (
      <PlatformNotice
        title="Sign in to continue"
        copy="The platform console needs a signed-in ValueBooks account."
        action={{ href: '/login?next=/platform', label: 'Sign in' }}
      />
    );
  }
  if (state === 'forbidden') {
    return (
      <PlatformNotice
        title="You do not have platform access"
        copy="Platform administration is granted per person by an existing superadmin. If you expected access here, ask them to grant it."
        action={{ href: appUrl('/dashboard'), label: 'Back to ValueBooks' }}
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
        <button
          ref={mobileToggleRef}
          type="button"
          className="rb-platform__mobile-toggle"
          aria-label="Open platform navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu aria-hidden="true" />
        </button>
        <Link href="/platform" className="rb-platform__brand" aria-label="ValueBooks">
          <BrandLogo variant="full" height={26} alt="ValueBooks" priority />
        </Link>
        <div className="rb-platform__identity">
          <span className="rb-platform__role">{session?.role.toLowerCase()}</span>
          <span>{session?.email}</span>
          <Link href={appUrl('/dashboard')}>Exit console</Link>
        </div>
      </header>
      <div className="rb-platform__body">
        <aside
          className={
            collapsed
              ? 'rb-app-sidebar rb-platform__sidebar is-collapsed'
              : 'rb-app-sidebar rb-platform__sidebar'
          }
        >
          <div className="rb-app-sidebar__brand">
            <span className="rb-visually-hidden">Platform navigation</span>
            <button
              type="button"
              className="rb-app-sidebar__toggle"
              aria-label={collapsed ? 'Expand platform sidebar' : 'Collapse platform sidebar'}
              onClick={toggleCollapsed}
            >
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
            </button>
          </div>
          {navigation()}
        </aside>
        {mobileOpen ? (
          <div
            ref={mobileLayerRef}
            className="rb-platform__mobile-layer"
            role="dialog"
            aria-modal="true"
            aria-label="Platform navigation"
          >
            <button
              className="rb-platform__mobile-backdrop"
              type="button"
              aria-label="Dismiss platform navigation"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="rb-app-sidebar rb-platform__sidebar rb-platform__mobile-sidebar">
              <div className="rb-app-sidebar__brand">
                <span className="rb-visually-hidden">Platform navigation</span>
                <button
                  type="button"
                  className="rb-app-sidebar__toggle"
                  aria-label="Close platform navigation"
                  onClick={() => setMobileOpen(false)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
              {navigation(true)}
            </aside>
          </div>
        ) : null}
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

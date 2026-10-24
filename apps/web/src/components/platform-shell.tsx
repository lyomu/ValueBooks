'use client';

import {
  Dialog,
  DrawerContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  PageHeader,
} from '@valuebooks/ui';
import {
  Activity,
  Building2,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  Flag,
  Gauge,
  Globe2,
  Menu,
  ScrollText,
  ShieldAlert,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { apiRequest } from '../lib/api';
import { PlatformSessionProvider, usePlatformSession } from '../lib/platform';
import { appUrl } from '../lib/site-hosts';
import { BrandLogo, CollapsedSidebarMark } from './brand-logo';

type NavItem = { href: string; label: string; icon: typeof Gauge };
type NavSection = { label?: string; items: NavItem[]; billing?: boolean };

/** Master plan §5 information architecture. Billing & Subscriptions is the one collapsible group. */
const NAV_SECTIONS: NavSection[] = [
  { items: [{ href: '/platform', label: 'Overview', icon: Gauge }] },
  {
    label: 'Workspace management',
    items: [
      { href: '/platform/organizations', label: 'Organizations', icon: Building2 },
      { href: '/platform/users', label: 'Users', icon: Users },
    ],
  },
  { label: 'Commercial operations', items: [], billing: true },
  {
    label: 'Platform configuration',
    items: [
      { href: '/platform/feature-flags', label: 'Feature flags', icon: Flag },
      { href: '/platform/country-packs', label: 'Country & tax', icon: Globe2 },
    ],
  },
  {
    label: 'Operations & trust',
    items: [
      { href: '/platform/jobs', label: 'Jobs & queues', icon: Activity },
      { href: '/platform/security', label: 'Security events', icon: ShieldAlert },
      { href: '/platform/audit', label: 'Audit logs', icon: ScrollText },
    ],
  },
];
const BILLING_NAV = [
  { href: '/platform/billing', label: 'Overview' },
  { href: '/platform/billing/subscriptions', label: 'Subscriptions' },
  { href: '/platform/billing/plans', label: 'Plans & pricing' },
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
const COLLAPSED_STORAGE_KEY = 'valuebooks:platform-nav-collapsed';

function isActive(pathname: string, href: string, exactRoots: readonly string[]) {
  return exactRoots.includes(href)
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function PlatformSidebar({
  collapsed,
  onToggle,
  onNavigate,
  mobile = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const billingRoute =
    pathname.startsWith('/platform/billing') || pathname.startsWith('/platform/plans');
  const [billingOpen, setBillingOpen] = useState(billingRoute);
  // Arriving on a billing page opens the group; leaving it does not close a group the operator
  // opened themselves.
  useEffect(() => {
    if (billingRoute) setBillingOpen(true);
  }, [billingRoute]);

  const rail = collapsed && !mobile;
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href, ['/platform']);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={rail ? item.label : undefined}
        aria-label={rail ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
        onClick={onNavigate}
      >
        <item.icon aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <aside
      className={
        collapsed
          ? 'rb-app-sidebar rb-platform__sidebar is-collapsed'
          : 'rb-app-sidebar rb-platform__sidebar'
      }
    >
      <div className="rb-app-sidebar__brand">
        {collapsed ? (
          <CollapsedSidebarMark onExpand={onToggle} label="Expand platform sidebar" />
        ) : (
          <>
            <Link
              href="/platform"
              className="rb-app-sidebar__brand-copy"
              aria-label="ValueBooks"
              onClick={onNavigate}
            >
              <BrandLogo variant="full" height={26} alt="ValueBooks" priority />
            </Link>
            {mobile ? null : (
              <button
                type="button"
                className="rb-app-sidebar__toggle"
                aria-label="Collapse platform sidebar"
                onClick={onToggle}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
      <nav className="rb-app-sidebar__nav rb-platform__nav" aria-label="Platform console">
        {NAV_SECTIONS.map((section, index) => (
          <div className="rb-platform__nav-section" key={section.label ?? index}>
            {section.label ? <span className="rb-platform__nav-label">{section.label}</span> : null}
            {section.billing ? (
              <>
                <button
                  className={
                    billingRoute ? 'rb-nav-group__trigger is-current' : 'rb-nav-group__trigger'
                  }
                  type="button"
                  title={rail ? 'Billing & subscriptions' : undefined}
                  aria-label={rail ? 'Billing & subscriptions' : undefined}
                  aria-expanded={billingOpen && !rail}
                  aria-controls={rail ? undefined : `${BILLING_NAV_ID}${mobile ? '-mobile' : ''}`}
                  onClick={() => {
                    // Collapsed, the group icon is the way in: open the rail with the group.
                    if (rail) {
                      onToggle();
                      setBillingOpen(true);
                    } else setBillingOpen((open) => !open);
                  }}
                >
                  <CreditCard className="rb-nav-group__icon" aria-hidden="true" />
                  <span className="rb-nav-group__label">Billing &amp; subscriptions</span>
                  <ChevronDown
                    className={billingOpen ? 'rb-nav-group__caret is-open' : 'rb-nav-group__caret'}
                    aria-hidden="true"
                  />
                </button>
                {billingOpen && !rail ? (
                  <div
                    className="rb-platform__nav-children"
                    id={`${BILLING_NAV_ID}${mobile ? '-mobile' : ''}`}
                  >
                    {BILLING_NAV.map((item) => {
                      const active = isActive(pathname, item.href, ['/platform/billing']);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
                          onClick={onNavigate}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
            {section.items.map(link)}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function PlatformTopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { session } = usePlatformSession();
  const router = useRouter();
  const displayName = session?.displayName ?? session?.email ?? 'Platform administrator';
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const role = session ? session.role.charAt(0) + session.role.slice(1).toLowerCase() : '';

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="rb-topbar rb-platform__topbar">
      <button className="rb-icon-button rb-topbar__menu" type="button" onClick={onMenuClick}>
        <Menu aria-hidden="true" />
        <span className="rb-visually-hidden">Open platform navigation</span>
      </button>
      <div className="rb-topbar__actions">
        <Dropdown>
          <DropdownTrigger asChild>
            <button
              className="rb-profile-trigger"
              type="button"
              aria-label={`Open account menu for ${displayName}`}
            >
              <span className="rb-avatar">{initials || 'VB'}</span>
              <span className="rb-profile-trigger__copy">
                <strong>{displayName}</strong>
                <small>{role}</small>
              </span>
            </button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>{session?.email}</DropdownLabel>
            <DropdownSeparator />
            <DropdownItem asChild>
              <Link href={appUrl('/dashboard')}>Exit console</Link>
            </DropdownItem>
            <DropdownItem onSelect={() => void signOut()}>Sign out</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}

/**
 * The platform console shell. It borrows the tenant app's shell structure -- sidebar rail, topbar,
 * drawer, profile menu -- in a light Platform Admin variant (`rb-app-shell--platform`), but none of
 * its tenant chrome: a platform administrator has no organization, so there is no organization
 * switcher, quick-create menu or tenant navigation, and no organization context is ever carried.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const platform = usePlatformSession();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Same restore rule as the tenant shell: a stored preference wins; otherwise narrow viewports
  // start collapsed. Starts expanded so the server and first client render agree.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(COLLAPSED_STORAGE_KEY);
    } catch {
      /* Navigation remains usable when storage is unavailable. */
    }
    setCollapsed(
      stored === null ? window.matchMedia('(max-width: 64rem)').matches : stored === '1',
    );
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      try {
        window.sessionStorage.setItem(COLLAPSED_STORAGE_KEY, current ? '0' : '1');
      } catch {
        /* Keep the in-memory preference. */
      }
      return !current;
    });
  }

  if (platform.state === 'loading') {
    return <PlatformNotice title="Loading the console" copy="Checking your platform access." />;
  }
  if (platform.state === 'signed-out') {
    return (
      <PlatformNotice
        title="Sign in to continue"
        copy="The platform console needs a signed-in ValueBooks account."
        action={{ href: '/login?next=/platform', label: 'Sign in' }}
      />
    );
  }
  if (platform.state === 'forbidden') {
    return (
      <PlatformNotice
        title="You do not have platform access"
        copy="Platform administration is granted per person by an existing superadmin. If you expected access here, ask them to grant it."
        action={{ href: appUrl('/dashboard'), label: 'Back to ValueBooks' }}
      />
    );
  }
  if (platform.state === 'error') {
    return (
      <PlatformNotice
        title="The console could not be loaded"
        copy="Refresh to try again."
        action={{ href: '/platform', label: 'Reload' }}
      />
    );
  }

  return (
    <PlatformSessionProvider value={platform}>
      <div
        className={
          collapsed
            ? 'rb-app-shell rb-app-shell--platform rb-platform has-collapsed-sidebar'
            : 'rb-app-shell rb-app-shell--platform rb-platform'
        }
      >
        <div className="rb-app-shell__desktop-nav">
          <PlatformSidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>

        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DrawerContent title="Platform navigation" side="left">
            <PlatformSidebar
              collapsed={false}
              mobile
              onToggle={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
            />
          </DrawerContent>
        </Dialog>

        <div className="rb-app-shell__workspace">
          <PlatformTopBar onMenuClick={() => setMobileOpen(true)} />
          <main className="rb-main-scroll" id="main-content" tabIndex={-1}>
            <div className="rb-page-container rb-platform__page">{children}</div>
          </main>
        </div>
      </div>
    </PlatformSessionProvider>
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

/**
 * Standard console page frame: the shared `PageHeader`, plus an optional `meta` line for scope or
 * freshness ("Last updated 09:32") under the description.
 */
export function PlatformPage({
  title,
  description,
  meta,
  actions,
  children,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      {meta ? <p className="rb-platform__meta">{meta}</p> : null}
      {children}
    </>
  );
}

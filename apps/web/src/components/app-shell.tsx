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
} from '@valuebooks/ui';
import {
  AlertOctagon,
  ArrowRightLeft,
  Banknote,
  Bell,
  BookOpenText,
  Briefcase,
  Building2,
  Calculator,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileClock,
  FileBarChart,
  FileQuestion,
  FileText,
  FileUp,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Menu,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  SlidersHorizontal,
  SquareCheckBig,
  Timer,
  TrendingUp,
  Undo2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { AiAssistantWidget } from './ai-assistant';
import { MaterialIcon, type MaterialIconName } from './material-icon';
import { OrganizationSwitcher } from './organization-switcher';

type NavigationItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href?: string;
};

type NavigationGroup = {
  label: string;
  icon: MaterialIconName;
  items: NavigationItem[];
  /** Exempt from the accordion: stays expanded whatever else is open. */
  alwaysOpen?: boolean;
};

const NAV_GROUP_STORAGE_KEY = 'valuebooks:nav-group';
const NAV_COLLAPSED_STORAGE_KEY = 'valuebooks:nav-collapsed';

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Overview',
    icon: 'space_dashboard',
    // Where you land, so it should never cost a click to get back to.
    alwaysOpen: true,
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
      { label: 'Notifications', icon: Bell, href: '/notifications' },
    ],
  },
  {
    label: 'Sales',
    icon: 'shopping_cart',
    items: [
      { label: 'Customers', icon: Users, href: '/dashboard/customers' },
      { label: 'Items & services', icon: Package, href: '/catalog/items' },
      { label: 'Invoices', icon: Receipt, href: '/invoices' },
      { label: 'Payments', icon: Banknote, href: '/payments' },
      { label: 'Credit notes', icon: Undo2, href: '/credit-notes' },
      { label: 'Quotes', icon: FileQuestion, href: '/quotes' },
      { label: 'Sales orders', icon: ClipboardList, href: '/sales-orders' },
    ],
  },
  {
    label: 'Purchases',
    icon: 'shopping_bag',
    items: [
      { label: 'Vendors', icon: Users, href: '/vendors' },
      { label: 'Purchase orders', icon: ClipboardList, href: '/purchase-orders' },
      { label: 'Bills', icon: Receipt, href: '/bills' },
      { label: 'Expenses', icon: Banknote, href: '/expenses' },
      { label: 'Expense categories', icon: Package, href: '/expense-categories' },
      { label: 'Vendor credits', icon: Undo2, href: '/vendor-credits' },
      { label: 'Payments made', icon: Banknote, href: '/payments-made' },
    ],
  },
  {
    label: 'General ledger',
    icon: 'menu_book',
    items: [
      { label: 'Chart of accounts', icon: BookOpenText, href: '/accounts' },
      { label: 'Opening balances', icon: BookOpenText, href: '/opening-balances' },
      { label: 'Journals', icon: FileText, href: '/journals' },
      { label: 'Trial balance', icon: Calculator, href: '/trial-balance' },
    ],
  },
  {
    label: 'Banking',
    icon: 'account_balance',
    items: [
      { label: 'Financial accounts', icon: Landmark, href: '/financial-accounts' },
      { label: 'Statement imports', icon: FileUp, href: '/statement-imports' },
      { label: 'Bank transactions', icon: Banknote, href: '/bank-transactions' },
      { label: 'Bank rules', icon: SlidersHorizontal, href: '/bank-rules' },
      { label: 'Transfers', icon: ArrowRightLeft, href: '/transfers' },
      { label: 'Reconciliation', icon: ListChecks, href: '/reconciliation' },
    ],
  },
  {
    label: 'Inventory',
    icon: 'inventory_2',
    items: [
      { label: 'Items & stock', icon: Package, href: '/catalog/items' },
      { label: 'Warehouses', icon: Building2, href: '/warehouses' },
      { label: 'Movements', icon: FileClock, href: '/stock-movements' },
      { label: 'Adjustments', icon: SlidersHorizontal, href: '/inventory-adjustments' },
      { label: 'Transfers', icon: ArrowRightLeft, href: '/inventory-transfers' },
      { label: 'Reorder', icon: ListChecks, href: '/reorder' },
      { label: 'Valuation', icon: Calculator, href: '/inventory-valuation' },
    ],
  },
  {
    label: 'Projects',
    icon: 'work',
    items: [
      { label: 'Projects', icon: Briefcase, href: '/projects' },
      { label: 'Timesheet', icon: Timer, href: '/timesheets' },
      { label: 'Time approvals', icon: ListChecks, href: '/time-approvals' },
      { label: 'Profitability', icon: TrendingUp, href: '/project-profitability' },
    ],
  },
  {
    label: 'Workflow',
    icon: 'rule',
    items: [
      { label: 'Approvals', icon: SquareCheckBig, href: '/approvals' },
      { label: 'Job failures', icon: AlertOctagon, href: '/automation/jobs' },
    ],
  },
  {
    label: 'Reports',
    icon: 'bar_chart',
    items: [
      { label: 'Report library', icon: FileBarChart, href: '/reports' },
      { label: 'Saved reports', icon: FileClock, href: '/reports/saved' },
      { label: 'Scheduled reports', icon: CalendarClock, href: '/reports/scheduled' },
      { label: 'Insights', icon: TrendingUp, href: '/insights' },
    ],
  },
];
function ValueBooksMark({ onExpand }: { onExpand?: () => void }) {
  if (onExpand) {
    return (
      <button
        className="rb-brand-mark"
        type="button"
        onClick={onExpand}
        aria-label="Expand sidebar"
      >
        <BookOpenText aria-hidden="true" />
      </button>
    );
  }

  return (
    <span className="rb-brand-mark" aria-hidden="true">
      <BookOpenText />
    </span>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // One group open at a time: every group expanded at once is what turned the sidebar into a
  // scroll rather than a map.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // AppShell is mounted per page rather than in a shared layout, so its state is destroyed on every
  // navigation. Without restoring it, the group you just opened would close the moment you clicked
  // something inside it. Starts null so the server and first client render agree.
  useEffect(() => {
    try {
      setOpenGroup(window.sessionStorage.getItem(NAV_GROUP_STORAGE_KEY));
    } catch {
      // Blocked or unavailable storage: the accordion still works, it just does not remember.
    }
  }, []);

  function toggleGroup(label: string) {
    const next = openGroup === label ? null : label;
    setOpenGroup(next);
    try {
      if (next) window.sessionStorage.setItem(NAV_GROUP_STORAGE_KEY, next);
      else window.sessionStorage.removeItem(NAV_GROUP_STORAGE_KEY);
    } catch {
      // See above.
    }
  }

  return (
    <aside className={collapsed ? 'rb-app-sidebar is-collapsed' : 'rb-app-sidebar'}>
      <div className="rb-app-sidebar__brand">
        <ValueBooksMark onExpand={collapsed ? onToggle : undefined} />
        {!collapsed ? (
          <div className="rb-app-sidebar__brand-copy">
            <strong>ValueBooks</strong>
            <span>Accounting, clearly</span>
          </div>
        ) : null}
        <button
          className="rb-app-sidebar__toggle"
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
      </div>

      <nav className="rb-app-sidebar__nav" aria-label="Primary navigation">
        {navigationGroups.map((group) => {
          const open = group.alwaysOpen === true || openGroup === group.label;
          return (
            <section className="rb-nav-group" key={group.label}>
              {/* One markup for both states: CSS turns the row into a tile when collapsed, so the
                  rail cannot drift away from the expanded header. */}
              <button
                className="rb-nav-group__trigger"
                type="button"
                aria-expanded={open}
                aria-disabled={!collapsed && group.alwaysOpen === true ? true : undefined}
                onClick={() => {
                  // Collapsed, the tile is the only way into a group: open the rail with it.
                  if (collapsed) {
                    onToggle();
                    if (group.alwaysOpen !== true && openGroup !== group.label) {
                      toggleGroup(group.label);
                    }
                    return;
                  }
                  if (group.alwaysOpen !== true) toggleGroup(group.label);
                }}
              >
                <ChevronDown
                  className={open ? 'rb-nav-group__caret is-open' : 'rb-nav-group__caret'}
                  aria-hidden="true"
                />
                <MaterialIcon className="rb-nav-group__icon" name={group.icon} />
                <span className="rb-nav-group__label">{group.label}</span>
              </button>

              {open && !collapsed ? (
                <ul>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = Boolean(item.href && pathname === item.href);
                    return (
                      <li key={item.label}>
                        {item.href ? (
                          <Link
                            className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
                            href={item.href}
                            onClick={onNavigate}
                          >
                            <Icon aria-hidden="true" />
                            <span>{item.label}</span>
                          </Link>
                        ) : (
                          <span
                            className="rb-nav-item is-upcoming"
                            aria-label={`${item.label}, coming in a later milestone`}
                            title="Upcoming"
                          >
                            <Icon aria-hidden="true" />
                            <span>{item.label}</span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="rb-app-sidebar__help">
          <CircleHelp aria-hidden="true" />
          <div>
            <strong>Need a hand?</strong>
            <span>Phase 1 workspace</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

type QuickCreateEntry = {
  label: string;
  href: string;
  permission: Parameters<typeof hasPermission>[1];
};

const quickCreateEntries: readonly QuickCreateEntry[] = [
  { label: 'Invoice', href: '/invoices/new', permission: 'sales.invoices.manage' },
  { label: 'Vendor', href: '/vendors', permission: 'vendors.manage' },
  { label: 'Purchase order', href: '/purchase-orders/new', permission: 'purchases.orders.manage' },
  { label: 'Bill', href: '/bills/new', permission: 'purchases.bills.manage' },
  { label: 'Expense', href: '/expenses/new', permission: 'purchases.expenses.manage' },
  {
    label: 'Payment made',
    href: '/payments-made/new',
    permission: 'purchases.payments_made.record',
  },
];

function QuickCreateMenu({
  organization,
}: {
  organization: ReturnType<typeof useWorkspace>['activeOrganization'];
}) {
  const entries = quickCreateEntries.filter((entry) =>
    hasPermission(organization, entry.permission),
  );
  if (entries.length === 0) return null;

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="rb-icon-button rb-quick-create-button" type="button">
          <Plus aria-hidden="true" />
          <span className="rb-visually-hidden">Quick create</span>
        </button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownLabel>Quick create</DropdownLabel>
        <DropdownSeparator />
        {entries.map((entry) => (
          <DropdownItem asChild key={entry.href}>
            <Link href={entry.href}>{entry.label}</Link>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function TopBar({
  onMenuClick,
  workspace,
}: {
  onMenuClick: () => void;
  workspace: ReturnType<typeof useWorkspace>;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const displayName = workspace.user?.displayName ?? 'ValueBooks';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="rb-topbar">
      <button className="rb-icon-button rb-topbar__menu" type="button" onClick={onMenuClick}>
        <Menu aria-hidden="true" />
        <span className="rb-visually-hidden">Open navigation</span>
      </button>

      <OrganizationSwitcher
        organizations={workspace.organizations}
        activeOrganization={workspace.activeOrganization}
        onSwitched={() => void workspace.refresh()}
      />

      <label className="rb-global-search">
        <Search aria-hidden="true" />
        <span className="rb-visually-hidden">Search ValueBooks</span>
        <input ref={searchRef} placeholder="Search accounts, journals, reports..." />
        <kbd>⌘K</kbd>
      </label>

      <div className="rb-topbar__actions">
        {workspace.activeOrganization ? (
          <span className="rb-online-badge">
            <span aria-hidden="true" /> {workspace.activeOrganization.baseCurrency}
          </span>
        ) : null}
        <QuickCreateMenu organization={workspace.activeOrganization} />
        <button className="rb-icon-button rb-notification-button" type="button">
          <Bell aria-hidden="true" />
          <span className="rb-notification-button__dot" aria-hidden="true" />
          <span className="rb-visually-hidden">Notifications</span>
        </button>
        <Link className="rb-icon-button" href="/settings" aria-label="Settings">
          <Settings aria-hidden="true" />
        </Link>

        <Dropdown>
          <DropdownTrigger asChild>
            <button
              className="rb-profile-trigger"
              type="button"
              aria-label={`Open profile menu for ${displayName}`}
            >
              <span className="rb-avatar">{initials || 'RB'}</span>
              <span className="rb-profile-trigger__copy">
                <strong>{displayName}</strong>
                <small>
                  {workspace.activeOrganization
                    ? workspace.activeOrganization.role
                    : 'No organization'}
                </small>
              </span>
            </button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>{displayName}</DropdownLabel>
            <DropdownSeparator />
            <DropdownItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem onSelect={() => void signOut()}>Sign out</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}

export function AppShell({
  children,
  requireOrganization = true,
}: {
  children: ReactNode;
  /** Account-level surfaces stay reachable before an organization exists. */
  requireOrganization?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspace = useWorkspace({ requireOrganization });

  // Like the open group, this is restored rather than re-derived: AppShell is mounted per page, so
  // a collapsed rail would spring back open on every navigation. With nothing stored yet the
  // viewport decides -- below 64rem the full sidebar leaves too little room for the page itself.
  // Starts expanded so the server and the first client render agree.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(NAV_COLLAPSED_STORAGE_KEY);
    } catch {
      // Blocked or unavailable storage: fall through to the viewport default.
    }
    setCollapsed(
      stored === null ? window.matchMedia('(max-width: 64rem)').matches : stored === '1',
    );
  }, []);

  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.sessionStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // See above.
      }
      return next;
    });
  }

  return (
    <div className={collapsed ? 'rb-app-shell has-collapsed-sidebar' : 'rb-app-shell'}>
      <div className="rb-app-shell__desktop-nav">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent title="ValueBooks navigation" side="left">
          <Sidebar
            collapsed={false}
            onToggle={() => setMobileOpen(false)}
            onNavigate={() => setMobileOpen(false)}
          />
        </DrawerContent>
      </Dialog>

      <div className="rb-app-shell__workspace">
        <TopBar onMenuClick={() => setMobileOpen(true)} workspace={workspace} />
        <main className="rb-main-scroll">
          <div className="rb-page-container">{children}</div>
        </main>
      </div>

      <AiAssistantWidget organization={workspace.activeOrganization} />
    </div>
  );
}

import {
  AlarmClock,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Landmark,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Workflow,
} from 'lucide-react';

import type { hasPermission } from '../lib/workspace';

export type SettingsEntry = {
  href: string;
  label: string;
  description: string;
  icon: typeof Building2;
  /**
   * Omitted where the screen is account-level rather than organization-level, or where the page
   * does its own gating and showing the card costs nothing.
   */
  permission?: Parameters<typeof hasPermission>[1];
};

export type SettingsSection = {
  label: string;
  entries: readonly SettingsEntry[];
};

/**
 * Every configuration screen in the product, in one place.
 *
 * Both the settings rail and the All Settings index read this, so a screen cannot appear in the
 * navigation but be missing from the index, or vice versa.
 */
export const settingsSections: readonly SettingsSection[] = [
  {
    label: 'Organization',
    entries: [
      {
        href: '/settings/organization',
        label: 'Profile',
        description: 'Legal identity, jurisdiction, accounting basis, and tax defaults.',
        icon: Building2,
        permission: 'organization.view',
      },
      {
        href: '/settings/currencies',
        label: 'Currencies',
        description: 'Base currency, the currencies you trade in, and exchange rates.',
        icon: CircleDollarSign,
        permission: 'settings.currency.manage',
      },
    ],
  },
  {
    label: 'Users & Roles',
    entries: [
      {
        href: '/settings/team',
        label: 'Team & roles',
        description: 'Invite people, assign roles, and review what each role can do.',
        icon: Users,
        permission: 'members.view',
      },
    ],
  },
  {
    label: 'Taxes & Compliance',
    entries: [
      {
        href: '/settings/taxes',
        label: 'Taxes',
        description: 'Tax codes and the rates applied to sales and purchases.',
        icon: Landmark,
        permission: 'tax.codes.view',
      },
    ],
  },
  {
    label: 'Setup & Configurations',
    entries: [
      {
        href: '/settings/fiscal-periods',
        label: 'Fiscal periods',
        description: 'Fiscal years, period status, and closing the books.',
        icon: CalendarClock,
        permission: 'periods.view',
      },
      {
        href: '/settings/numbering',
        label: 'Numbering',
        description: 'Document number series and formats for every transaction type.',
        icon: SlidersHorizontal,
        permission: 'numbering.view',
      },
    ],
  },
  {
    label: 'Automation',
    entries: [
      {
        href: '/settings/workflow-rules',
        label: 'Workflow rules',
        description: 'Rules that act on transactions as they move through the system.',
        icon: Workflow,
        permission: 'automation.rules.view',
      },
      {
        href: '/settings/reminders',
        label: 'Reminders',
        description: 'Automatic reminders for anything that falls due or overdue.',
        icon: AlarmClock,
        permission: 'automation.schedules.view',
      },
    ],
  },
  {
    label: 'Security',
    entries: [
      {
        href: '/settings/security',
        label: 'Security',
        description: 'Active sessions and sign-in protection for your own account.',
        icon: ShieldCheck,
      },
      {
        href: '/settings/audit-log',
        label: 'Audit log',
        description: 'A record of who changed what, and when.',
        icon: ScrollText,
        permission: 'audit.view',
      },
    ],
  },
];

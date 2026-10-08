'use client';

import { ChevronLeft, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { settingsSections } from './settings-navigation';
import { hasPermission, useWorkspace } from '../lib/workspace';

/**
 * The configuration surface, deliberately a takeover rather than a section of the app.
 *
 * Configuration is a mode you enter and leave, not a place you work from, so the product
 * navigation steps aside while you are in it -- that is what keeps the main sidebar short enough
 * to read without scrolling. "Close settings" is the only way back, so the exit is always in the
 * same place.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  // Not `requireOrganization`: /settings/security is account-level, and a layout cannot vary this
  // per child. The organization-scoped pages below already handle a null organization.
  const workspace = useWorkspace({ requireOrganization: false });
  const pathname = usePathname();
  const organization = workspace.activeOrganization;

  const sections = settingsSections
    .map((section) => ({
      ...section,
      entries: section.entries.filter(
        (entry) => !entry.permission || hasPermission(organization, entry.permission),
      ),
    }))
    .filter((section) => section.entries.length > 0);

  return (
    <div className="rb-settings">
      <header className="rb-settings__header">
        <Link className="rb-settings__back" href="/dashboard" aria-label="Back to ValueBooks">
          <ChevronLeft aria-hidden="true" />
        </Link>
        <div className="rb-settings__title">
          <strong>All Settings</strong>
          <small>{organization?.tradingName ?? organization?.legalName ?? 'ValueBooks'}</small>
        </div>
        <Link className="rb-settings__close" href="/dashboard">
          Close settings <X aria-hidden="true" />
        </Link>
      </header>

      <div className="rb-settings__body">
        <nav className="rb-settings__nav" aria-label="Settings">
          {sections.map((section) => (
            <div className="rb-settings__nav-group" key={section.label}>
              <h2>{section.label}</h2>
              <ul>
                {section.entries.map((entry) => {
                  const active = pathname.startsWith(entry.href);
                  return (
                    <li key={entry.href}>
                      <Link
                        href={entry.href}
                        aria-current={active ? 'page' : undefined}
                        className={active ? 'is-active' : undefined}
                      >
                        {entry.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main id="main-content" className="rb-settings__main" tabIndex={-1}>
          <div className="rb-settings__content">{children}</div>
        </main>
      </div>
    </div>
  );
}

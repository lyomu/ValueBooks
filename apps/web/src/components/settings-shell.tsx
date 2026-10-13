'use client';

import { ChevronLeft, LayoutGrid, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { settingsSections } from './settings-navigation';
import { useWorkspace } from '../lib/workspace';

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

  const sections = settingsSections;

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
        <Link className="rb-settings__close" href="/dashboard" aria-label="Close settings">
          <X aria-hidden="true" />
        </Link>
      </header>

      <div className="rb-settings__body">
        <nav className="rb-settings__nav" aria-label="Settings">
          <ul className="rb-settings__nav-list">
            <li>
              <Link
                href="/settings"
                aria-current={pathname === '/settings' ? 'page' : undefined}
                className={pathname === '/settings' ? 'is-active' : undefined}
              >
                <LayoutGrid aria-hidden="true" />
                <span>All settings</span>
              </Link>
            </li>
            {sections.map((section) => {
              const Icon = section.entries[0]?.icon;
              const active = section.entries.some((entry) => pathname.startsWith(entry.href));
              return (
                <li key={section.id}>
                  <Link
                    href={`/settings#${section.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={active ? 'is-active' : undefined}
                  >
                    {Icon ? <Icon aria-hidden="true" /> : null}
                    <span>{section.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main id="main-content" className="rb-settings__main" tabIndex={-1}>
          <div className="rb-settings__content">{children}</div>
        </main>
      </div>
    </div>
  );
}

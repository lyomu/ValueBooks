'use client';

import { PageHeader } from '@valuebooks/ui';
import Link from 'next/link';

import { settingsSections } from './settings-navigation';
import { hasPermission, useWorkspace } from '../lib/workspace';

/** The All Settings landing page: every configuration screen, grouped, on one screen. */
export function SettingsIndex() {
  const workspace = useWorkspace({ requireOrganization: false });
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
    <>
      <PageHeader
        title="All settings"
        description="Everything you configure once and rarely revisit, in one place."
      />
      <div className="rb-settings-index">
        {sections.map((section) => (
          <section className="rb-settings-index__group" key={section.label}>
            <h2>{section.label}</h2>
            <div className="rb-settings-index__grid">
              {section.entries.map((entry) => (
                <Link className="rb-settings-index__card" href={entry.href} key={entry.href}>
                  <span className="rb-settings-index__icon">
                    <entry.icon aria-hidden="true" />
                  </span>
                  <strong>{entry.label}</strong>
                  <span>{entry.description}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

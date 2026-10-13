'use client';

import { EmptyState, Input, PageHeader } from '@valuebooks/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { settingsSections } from './settings-navigation';

/** The All Settings landing page: every configuration screen, grouped, on one screen. */
export function SettingsIndex() {
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return settingsSections
      .map((section) => ({
        ...section,
        entries: section.entries.filter((entry) => {
          if (!normalizedQuery) return true;

          return [section.label, entry.label, entry.description].some((value) =>
            value.toLocaleLowerCase().includes(normalizedQuery),
          );
        }),
      }))
      .filter((section) => section.entries.length > 0);
  }, [query]);

  return (
    <>
      <PageHeader
        title="All settings"
        description="Manage your organization, accounting preferences, automation, and security."
      />
      <div className="rb-settings-index">
        <div className="rb-settings-index__search">
          <Search aria-hidden="true" />
          <label className="rb-visually-hidden" htmlFor="settings-search">
            Search settings
          </label>
          <Input
            id="settings-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
          />
        </div>

        {sections.length > 0 ? (
          sections.map((section) => (
            <section className="rb-settings-index__group" id={section.id} key={section.id}>
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
          ))
        ) : (
          <EmptyState
            className="rb-settings-index__empty"
            icon={Search}
            title="No settings match that search"
            description="Try a setting name, category, or a shorter phrase."
            variant="no-results"
          />
        )}
      </div>
    </>
  );
}

'use client';

import { useId, useMemo, useState } from 'react';

export type ComboboxOption = { value: string; label: string };

/** A form-compatible, searchable picker for global reference catalogs. */
export function SearchableCombobox({
  id,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
}: {
  id: string;
  name?: string;
  options: readonly ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const listId = `${id || generatedId}-options`;
  const selectedValue = value ?? defaultValue ?? '';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === selectedValue);
  const shown = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? options.filter((option) =>
          `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalized),
        )
      : options;
  }, [options, query]);
  const select = (next: string) => {
    onChange?.(next);
    setQuery('');
    setOpen(false);
  };
  return (
    <div className="rb-combobox">
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={selected?.label ?? 'Select an option'}
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder="Search…"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && shown[0]) {
            event.preventDefault();
            select(shown[0].value);
          }
        }}
      />
      {open && !disabled ? (
        <ul id={listId} role="listbox" className="rb-combobox__options">
          {shown.length ? (
            shown.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === selectedValue}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option.value)}
              >
                {option.label}
              </li>
            ))
          ) : (
            <li aria-disabled="true">No matches found.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

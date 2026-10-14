'use client';

import {
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from './utils';

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return <label className={cn('rb-label', className)} ref={ref} {...props} />;
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input className={cn('rb-input', className)} ref={ref} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select className={cn('rb-select', className)} ref={ref} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea className={cn('rb-textarea', className)} ref={ref} {...props} />;
});

export function FormField({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rb-form-field', className)} {...props} />;
}

export const FormLabel = Label;
export const FormInput = Input;
export const FormSelect = Select;
export const FormTextarea = Textarea;

export const FormDescription = FieldMessage;
export function FormError({ children }: { children: React.ReactNode }) {
  return <FieldMessage error>{children}</FieldMessage>;
}

export type FormComboboxOption = { value: string; label: string; disabled?: boolean };

/** Shared, form-compatible searchable single-select. Its dismissal and keyboard model are owned here. */
export function FormCombobox({
  id,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
  clearable = false,
  placeholder = 'Search…',
}: {
  id?: string;
  name?: string;
  options: readonly FormComboboxOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  clearable?: boolean;
  placeholder?: string;
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-options`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justOpenedRef = useRef(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : uncontrolledValue;
  const selected = options.find((option) => option.value === selectedValue);
  const shown = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? options.filter((option) =>
          `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalized),
        )
      : options;
  }, [options, query]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    justOpenedRef.current = false;
    if (restoreFocus) requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) =>
      shown.length ? Math.min(Math.max(current, 0), shown.length - 1) : -1,
    );
  }, [shown.length]);

  const select = (next: string) => {
    if (!isControlled) setUncontrolledValue(next);
    onChange?.(next);
    close(true);
  };
  const openMenu = () => {
    if (disabled) return;
    if (!open) {
      justOpenedRef.current = true;
      setQuery('');
    }
    setOpen(true);
    setActiveIndex(
      Math.max(
        0,
        shown.findIndex((option) => option.value === selectedValue),
      ),
    );
  };

  return (
    <div className="rb-combobox" ref={rootRef}>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <input
        className="rb-input rb-combobox__input"
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={placeholder}
        onMouseDown={(event) => {
          if (document.activeElement !== event.currentTarget) return;
          event.preventDefault();
          if (open) close(false);
          else openMenu();
        }}
        onFocus={(event) => {
          openMenu();
          if (selected) event.currentTarget.value = '';
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const nextQuery =
            justOpenedRef.current && selected && event.target.value.startsWith(selected.label)
              ? event.target.value.slice(selected.label.length)
              : event.target.value;
          justOpenedRef.current = false;
          setQuery(nextQuery);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) openMenu();
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex((current) =>
              Math.min(Math.max(current < 0 ? 0 : current + offset, 0), shown.length - 1),
            );
          } else if (
            event.key === 'Enter' &&
            open &&
            shown[activeIndex] &&
            !shown[activeIndex].disabled
          ) {
            event.preventDefault();
            select(shown[activeIndex].value);
          }
        }}
      />
      {clearable && selectedValue && !disabled ? (
        <button
          className="rb-combobox__clear"
          type="button"
          aria-label="Clear selection"
          onClick={() => select('')}
        >
          ×
        </button>
      ) : null}
      {open && !disabled ? (
        <ul id={listId} role="listbox" className="rb-combobox__options">
          {shown.length ? (
            shown.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                className="rb-combobox__option"
                role="option"
                aria-selected={option.value === selectedValue}
                aria-disabled={option.disabled || undefined}
                data-active={index === activeIndex || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => !option.disabled && select(option.value)}
              >
                {option.label}
              </li>
            ))
          ) : (
            <li className="rb-combobox__empty" aria-disabled="true">
              No matches found.
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

export const FormSearchInput = Input;
export const FormNumberInput = Input;
export const FormDatePicker = Input;

export function FieldMessage({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return <p className={cn('rb-field-message', error && 'rb-field-message--error')}>{children}</p>;
}

'use client';

import * as Flags from 'country-flag-icons/react/1x1';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';

import { cn } from './utils';

export interface PhoneCountryOption {
  /** ISO 3166-1 alpha-2 code, e.g. `KE`. */
  readonly code: string;
  readonly name: string;
  /** International dialling prefix with the plus sign, e.g. `+254`. Derived from the code when missing. */
  readonly dialCode?: string;
}

export interface PhoneInputProps {
  id?: string;
  /** Name of the hidden field that carries the E.164 value in form submissions. */
  name?: string;
  /** Current value in E.164 form (`+254712345678`). Any other format is parsed best-effort. */
  value?: string | null;
  defaultValue?: string | null;
  /** Fires with the E.164 value, or an empty string when the number is cleared. */
  onChange?: (value: string, meta: { valid: boolean; country: string | null }) => void;
  countries: readonly PhoneCountryOption[];
  /** Used when the value carries no country of its own. */
  defaultCountry?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'aria-describedby'?: string;
}

type FlagComponent = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>;

function flagFor(code: string): FlagComponent | null {
  const component = (Flags as Record<string, FlagComponent | undefined>)[code.toUpperCase()];
  return component ?? null;
}

let fallbackList: PhoneCountryOption[] | null = null;

/** Country list built from libphonenumber and Intl when the caller supplies none. */
function fallbackCountries(): PhoneCountryOption[] {
  if (!fallbackList) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      names = null;
    }
    fallbackList = getCountries().map((code) => ({ code, name: names?.of(code) ?? code }));
  }
  return fallbackList;
}

function dialCodeFor(option: PhoneCountryOption): string {
  if (option.dialCode) return option.dialCode.startsWith('+') ? option.dialCode : `+${option.dialCode}`;
  try {
    return `+${getCountryCallingCode(option.code.toUpperCase() as CountryCode)}`;
  } catch {
    return '';
  }
}

function splitValue(
  raw: string | null | undefined,
  fallbackCountry: string,
): { country: string; national: string } {
  const text = (raw ?? '').trim();
  if (!text) return { country: fallbackCountry, national: '' };
  const parsed = parsePhoneNumberFromString(text, fallbackCountry.toUpperCase() as CountryCode);
  if (parsed) {
    return {
      country: parsed.country ?? fallbackCountry,
      national: parsed.formatNational().replace(/^0/, ''),
    };
  }
  return { country: fallbackCountry, national: text.replace(/^\+\d+\s*/, '') };
}

/**
 * Phone entry with a country picker and live validation. The visible control takes the national
 * number; the hidden `name` field always holds the normalised E.164 value so uncontrolled forms
 * read it with FormData like any other input. Invalid numbers block native form submission with a
 * readable message, so callers get validation without wiring extra state.
 */
export function PhoneInput({
  id,
  name,
  value,
  defaultValue,
  onChange,
  countries,
  defaultCountry = 'KE',
  required = false,
  disabled = false,
  className,
  placeholder = 'Phone number',
  'aria-describedby': describedBy,
}: PhoneInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const initial = useMemo(
    () => splitValue(value ?? defaultValue, defaultCountry),
    // Only the first render seeds local state; later `value` changes are applied below.
    [],
  );
  const [country, setCountry] = useState(initial.country);
  const [national, setNational] = useState(initial.national);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef<string>('');

  const options = useMemo(() => {
    const list = countries.length > 0 ? countries : fallbackCountries();
    return list
      .map((option) => ({ ...option, code: option.code.toUpperCase(), dial: dialCodeFor(option) }))
      .filter((option) => option.dial)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countries]);

  const selected = options.find((option) => option.code === country) ?? options[0] ?? null;
  const parsed = useMemo(
    () =>
      national.trim()
        ? parsePhoneNumberFromString(national, (selected?.code ?? defaultCountry) as CountryCode)
        : undefined,
    [national, selected?.code, defaultCountry],
  );
  const valid = Boolean(parsed?.isValid());
  const e164 = valid && parsed ? parsed.number : '';

  // Controlled usage: adopt an external value when it changes to something we did not emit.
  useEffect(() => {
    if (value === undefined) return;
    const next = value ?? '';
    if (next === lastEmitted.current) return;
    const split = splitValue(next, selected?.code ?? defaultCountry);
    setCountry(split.country);
    setNational(split.national);
    lastEmitted.current = next;
  }, [value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (!national.trim()) {
      input.setCustomValidity('');
    } else if (!valid) {
      input.setCustomValidity(
        `Enter a valid phone number for ${selected?.name ?? 'the selected country'}, for example ${
          selected?.dial ?? '+'
        } followed by the local number.`,
      );
    } else {
      input.setCustomValidity('');
    }
  }, [national, valid, selected]);

  useEffect(() => {
    const next = national.trim() ? e164 || `${selected?.dial ?? ''}${national.replace(/\D/g, '')}` : '';
    if (next === lastEmitted.current) return;
    lastEmitted.current = next;
    onChange?.(e164, { valid, country: selected?.code ?? null });
  }, [e164, valid, national, selected?.code]);

  const Flag = selected ? flagFor(selected.code) : null;

  return (
    <div className={cn('rb-phone-input', disabled && 'rb-phone-input--disabled', className)}>
      <span className="rb-phone-input__country">
        <span className="rb-phone-input__flag" aria-hidden="true">
          {Flag ? <Flag /> : <span className="rb-phone-input__flag-fallback" />}
        </span>
        <span className="rb-phone-input__dial" aria-hidden="true">
          {selected?.dial ?? ''}
        </span>
        <ChevronDown aria-hidden="true" />
        <select
          className="rb-phone-input__select"
          aria-label="Country code"
          value={selected?.code ?? ''}
          disabled={disabled}
          onChange={(event) => setCountry(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name} ({option.dial})
            </option>
          ))}
        </select>
      </span>
      <input
        ref={inputRef}
        id={inputId}
        type="tel"
        className="rb-input rb-phone-input__number"
        inputMode="tel"
        autoComplete="tel-national"
        value={national}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={national.trim() && !valid ? true : undefined}
        onChange={(event) => {
          const typed = event.target.value;
          // Typing a leading + lets the user switch country by dialling code.
          if (typed.startsWith('+')) {
            const formatter = new AsYouType();
            formatter.input(typed);
            const detected = formatter.getCountry();
            if (detected && options.some((option) => option.code === detected)) {
              setCountry(detected);
              const number = formatter.getNumber();
              setNational(number ? number.formatNational().replace(/^0/, '') : '');
              return;
            }
          }
          setNational(typed);
        }}
        onBlur={() => {
          if (parsed?.isValid()) setNational(parsed.formatNational().replace(/^0/, ''));
        }}
      />
      {name ? <input type="hidden" name={name} value={e164} /> : null}
    </div>
  );
}

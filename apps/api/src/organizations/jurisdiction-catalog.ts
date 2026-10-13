/** API-owned global reference data shared by validation and web pickers. */
import { getCountry } from 'countries-and-timezones';
import currencyCodes from 'currency-codes';
import countriesData, { type Country } from 'world-countries';

export interface CountryDefinition {
  readonly code: string;
  readonly name: string;
  readonly defaultCurrency: string;
  readonly defaultLocale: string;
  readonly defaultTimeZone: string;
  readonly defaultFiscalStartMonth: number;
  readonly defaultFiscalStartDay: number;
  readonly countryPackCode: string;
  readonly countryPackVersion: string;
  readonly suggestedTaxRate: number;
  readonly taxIdentifierLabel: string;
}
export interface CurrencyDefinition {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly minorUnits: number;
}
export interface CountryPackDefinition {
  readonly code: string;
  readonly version: string;
  readonly countryCode: string;
  readonly name: string;
  readonly status: 'DEMONSTRATION' | 'GENERIC_FALLBACK';
  readonly defaults: {
    readonly currency: string;
    readonly locale: string;
    readonly timeZone: string;
    readonly fiscalYearStartMonth: number;
    readonly fiscalYearStartDay: number;
    readonly chartTemplate: string;
    readonly journalPrefix: string;
    readonly numberPadding: number;
    readonly numberingReset: 'NEVER' | 'ANNUAL' | 'MONTHLY';
  };
  readonly notes: readonly string[];
}

const KENYA_PACK_VERSION = '2026.1-draft';
const GENERIC_PACK_VERSION = '2026.1-generic-draft';
const FALLBACK_CURRENCY = 'USD';
const FALLBACK_TIME_ZONE = 'UTC';
const FALLBACK_LOCALE = 'en-US';

export const countryPacks: readonly CountryPackDefinition[] = Object.freeze([
  {
    code: 'KE',
    version: KENYA_PACK_VERSION,
    countryCode: 'KE',
    name: 'Kenya demonstration pack',
    status: 'DEMONSTRATION',
    defaults: {
      currency: 'KES',
      locale: 'en-KE',
      timeZone: 'Africa/Nairobi',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      chartTemplate: 'general-business',
      journalPrefix: 'JRN',
      numberPadding: 5,
      numberingReset: 'ANNUAL',
    },
    notes: [
      'Configurable software defaults only.',
      'Not a statutory certification or professional tax/accounting opinion.',
    ],
  },
  {
    code: 'GENERIC',
    version: GENERIC_PACK_VERSION,
    countryCode: 'ZZ',
    name: 'Generic fallback pack',
    status: 'GENERIC_FALLBACK',
    defaults: {
      currency: FALLBACK_CURRENCY,
      locale: FALLBACK_LOCALE,
      timeZone: FALLBACK_TIME_ZONE,
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      chartTemplate: 'general-business',
      journalPrefix: 'JRN',
      numberPadding: 5,
      numberingReset: 'ANNUAL',
    },
    notes: [
      'Used when a country-specific pack is not available.',
      'Every value remains configurable per organization.',
    ],
  },
]);

function defaultCurrency(country: Country): string {
  return Object.keys(country.currencies ?? {}).sort()[0] ?? FALLBACK_CURRENCY;
}
function defaultLocale(country: Country): string {
  const language = Object.keys(country.languages ?? {}).sort()[0] ?? 'en';
  try {
    return new Intl.Locale(`${language}-${country.cca2}`).toString();
  } catch {
    return FALLBACK_LOCALE;
  }
}
function defaultTimeZone(code: string): string {
  return getCountry(code)?.timezones[0] ?? FALLBACK_TIME_ZONE;
}

export const countries: readonly CountryDefinition[] = Object.freeze(
  countriesData
    .filter((country) => country.status === 'officially-assigned' && Boolean(country.cca2))
    .map((country) => ({
      code: country.cca2,
      name: country.name.common,
      defaultCurrency: country.cca2 === 'KE' ? 'KES' : defaultCurrency(country),
      defaultLocale: country.cca2 === 'KE' ? 'en-KE' : defaultLocale(country),
      defaultTimeZone: country.cca2 === 'KE' ? 'Africa/Nairobi' : defaultTimeZone(country.cca2),
      defaultFiscalStartMonth: 1,
      defaultFiscalStartDay: 1,
      countryPackCode: country.cca2 === 'KE' ? 'KE' : 'GENERIC',
      countryPackVersion: country.cca2 === 'KE' ? KENYA_PACK_VERSION : GENERIC_PACK_VERSION,
      suggestedTaxRate: country.cca2 === 'KE' ? 16 : 0,
      taxIdentifierLabel: country.cca2 === 'KE' ? 'KRA PIN' : 'Tax identifier',
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const EXCLUDED_ISO_CURRENCIES = new Set([
  // ISO funds, testing/reserved codes, metals, and the IMF's special drawing right are not
  // transaction currencies for this product's organization selector.
  'BOV',
  'CHE',
  'CHW',
  'CLF',
  'COU',
  'MXV',
  'USN',
  'UYI',
  'UYW',
  'XAG',
  'XAU',
  'XDR',
  'XPD',
  'XPT',
  'XSU',
  'XTS',
  'XXX',
]);
const currencyNames = new Intl.DisplayNames('en', { type: 'currency' });
export const currencies: readonly CurrencyDefinition[] = Object.freeze(
  currencyCodes.data
    .filter((currency) => !EXCLUDED_ISO_CURRENCIES.has(currency.code) && Boolean(currency.currency))
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((currency) => {
      const code = currency.code;
      const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: code });
      return {
        code,
        name: currencyNames.of(code) ?? currency.currency,
        symbol: formatter.formatToParts(0).find((part) => part.type === 'currency')?.value ?? code,
        minorUnits: currency.digits ?? formatter.resolvedOptions().maximumFractionDigits,
      };
    }),
);
export const timeZones: readonly string[] = Object.freeze(
  [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].sort(),
);
const localeNames = new Intl.DisplayNames('en', { type: 'language' });
export const locales: readonly { code: string; name: string }[] = Object.freeze(
  [
    ...new Set(
      countriesData
        .filter((country) => country.status === 'officially-assigned')
        .flatMap((country) =>
          Object.keys(country.languages ?? {}).map((language) => {
            try {
              return new Intl.Locale(`${language}-${country.cca2}`).toString();
            } catch {
              return null;
            }
          }),
        )
        .filter((locale): locale is string => Boolean(locale)),
    ),
  ]
    .sort()
    .map((code) => ({ code, name: localeNames.of(code) ?? code })),
);
export const chartTemplates: readonly { code: string; name: string; description: string }[] =
  Object.freeze([
    {
      code: 'general-business',
      name: 'General business',
      description: 'Balanced starter accounts for trading and service businesses.',
    },
    {
      code: 'retail',
      name: 'Retail and distribution',
      description: 'Adds cost-of-sales and stock-adjustment accounts for goods sellers.',
    },
    {
      code: 'services',
      name: 'Professional services',
      description: 'Emphasises fee income, billable costs, and staff-related expenses.',
    },
    {
      code: 'nonprofit',
      name: 'Nonprofit and grants',
      description: 'Separates restricted funds, grants, and programme expenditure.',
    },
  ]);
export const businessTypes: readonly { code: string; name: string }[] = Object.freeze([
  { code: 'SOLE_PROPRIETOR', name: 'Sole proprietor' },
  { code: 'PARTNERSHIP', name: 'Partnership' },
  { code: 'LIMITED_COMPANY', name: 'Limited company' },
  { code: 'NONPROFIT', name: 'Nonprofit or NGO' },
  { code: 'COOPERATIVE', name: 'Cooperative' },
  { code: 'OTHER', name: 'Other' },
]);
const countriesByCode = new Map(countries.map((country) => [country.code, country]));
const packsByCode = new Map(countryPacks.map((pack) => [pack.code, pack]));
const currencyCodeSet = new Set(currencies.map((currency) => currency.code));
const timeZoneSet = new Set(timeZones);
const localeCodes = new Set(locales.map((locale) => locale.code));
const chartTemplateCodes = new Set(chartTemplates.map((template) => template.code));
export function findCountry(code: string): CountryDefinition | undefined {
  return countriesByCode.get(code.toUpperCase());
}
export function resolveCountryPack(code: string | null | undefined): CountryPackDefinition {
  return packsByCode.get(code?.toUpperCase() ?? '') ?? packsByCode.get('GENERIC')!;
}
export function findCurrency(code: string): CurrencyDefinition | undefined {
  return currencies.find((currency) => currency.code === code.toUpperCase());
}
export function isSupportedCurrency(code: string): boolean {
  return currencyCodeSet.has(code.toUpperCase());
}
export function isSupportedTimeZone(value: string): boolean {
  return timeZoneSet.has(value);
}
export function isSupportedLocale(code: string): boolean {
  return localeCodes.has(code);
}
export function isSupportedChartTemplate(code: string): boolean {
  return chartTemplateCodes.has(code);
}
export function maxFiscalStartDay(month: number): number {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}
export const referenceData = Object.freeze({
  countries,
  countryPacks,
  currencies,
  timeZones,
  locales,
  chartTemplates,
  businessTypes,
  accountingBases: [
    {
      code: 'ACCRUAL',
      name: 'Accrual',
      description: 'Record income and costs when they are earned or incurred.',
    },
    { code: 'CASH', name: 'Cash', description: 'Record income and costs when money moves.' },
  ],
  taxTreatments: [
    { code: 'EXCLUSIVE', name: 'Tax exclusive', description: 'Amounts entered exclude tax.' },
    {
      code: 'INCLUSIVE',
      name: 'Tax inclusive',
      description: 'Amounts entered already include tax.',
    },
  ],
  numberingResets: [
    { code: 'NEVER', name: 'Never reset' },
    { code: 'ANNUAL', name: 'Reset every fiscal year' },
    { code: 'MONTHLY', name: 'Reset every month' },
  ],
});

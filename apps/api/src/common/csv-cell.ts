/**
 * Shared RFC 4180 cell escaping plus an OWASP-style CSV formula-injection guard. Every CSV writer
 * in this codebase exports data a user controls somewhere upstream (an invoice line description,
 * a payee name, a customer display name, an audit-log actor) -- a cell beginning `=`, `+`, `-`,
 * `@`, or a tab is executed as a formula the moment the file is opened in Excel or Sheets. Prefix
 * those with a single quote so spreadsheet applications render them as literal text; RFC 4180
 * quoting still applies independently for any comma/quote/newline the (now possibly prefixed)
 * value still contains.
 */
const FORMULA_TRIGGER = /^[=+\-@\t]/;

export function escapeCsvCell(value: unknown): string {
  const text = primitiveCsvText(value);
  const safe = FORMULA_TRIGGER.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function primitiveCsvText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value.toString();
  }
  return JSON.stringify(value);
}

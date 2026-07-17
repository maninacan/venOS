import i18n from './index';

/** Current UI locale (full region tag, e.g. "en-US" / "es-MX") for Intl formatting. */
const loc = () => i18n.language || 'en-US';

/**
 * Format a monetary amount in the merchant's currency, grouped/localized for
 * the current UI locale — the way a POS shows money. `currency` is an ISO 4217
 * code sourced from the company (defaults to USD).
 */
export const formatCurrency = (v?: number | null, currency = 'USD') =>
  new Intl.NumberFormat(loc(), { style: 'currency', currency }).format(Number(v ?? 0));

export const formatNumber = (v?: number | null, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(loc(), opts).format(Number(v ?? 0));

/** `fraction` is 0..1 (e.g. 0.0825 → "8.25 %"). */
export const formatPercent = (fraction: number, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(loc(), { style: 'percent', minimumFractionDigits: 2, ...opts }).format(
    Number(fraction ?? 0)
  );

/**
 * Format a date for the current UI locale. Accepts a Date or an ISO string;
 * date-only strings ("YYYY-MM-DD") are anchored to local midnight to avoid
 * timezone drift.
 */
export const formatDate = (
  d: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
) => {
  if (d == null || d === '') return '';
  const date =
    typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : d;
  if (isNaN(date.getTime())) return typeof d === 'string' ? d : '';
  return new Intl.DateTimeFormat(loc(), opts).format(date);
};

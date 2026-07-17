import { useTranslation } from 'react-i18next';
import { useCurrentCompany } from '../hooks/useCurrentCompany';
import { formatCurrency } from './format';

/**
 * Returns the current merchant's currency and a bound formatter. Subscribing to
 * `useTranslation()` ensures money re-renders when the UI language changes
 * (Intl grouping is locale-dependent).
 */
export function useCurrency() {
  useTranslation();
  const { company } = useCurrentCompany();
  const currency = (company?.currency as string) || 'USD';
  return {
    currency,
    fmt: (v?: number | null) => formatCurrency(v, currency),
  };
}

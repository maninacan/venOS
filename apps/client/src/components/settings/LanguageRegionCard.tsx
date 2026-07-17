import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { showToast } from '@org/data';
import { LanguageSwitcher } from './LanguageSwitcher';
import { formatCurrency } from '../../i18n/format';

const GET_CURRENCY = gql`
  query GetCompanyCurrency($id: ID!) {
    company(id: $id) { id currency }
  }
`;
const UPDATE_CURRENCY = gql`
  mutation UpdateCompanyCurrency($id: ID!, $input: UpdateCompanyInput!) {
    updateCompany(id: $id, input: $input) { id currency }
  }
`;

// Common ISO 4217 codes. Any code works via the backend; this is the picker shortlist.
const CURRENCIES = ['USD', 'MXN', 'CAD', 'EUR', 'GBP', 'AUD', 'BRL', 'JPY'];

export function LanguageRegionCard({ companyId }: { companyId: string }) {
  const { t } = useTranslation('settings');
  const { data } = useQuery(GET_CURRENCY, { variables: { id: companyId }, skip: !companyId });
  const [updateCurrency, { loading: saving }] = useMutation(UPDATE_CURRENCY);
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    if (data?.company?.currency) setCurrency(data.company.currency);
  }, [data]);

  async function handleCurrencyChange(next: string) {
    setCurrency(next);
    try {
      await updateCurrency({ variables: { id: companyId, input: { currency: next } } });
      showToast(t('language.currencySaved', 'Currency updated'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('language.currencyError', 'Failed to update currency'), 'error');
    }
  }

  return (
    <div className="card" id="language">
      <h3 style={{ margin: '0 0 4px', color: 'var(--vv-navy)' }}>{t('language.title', 'Language & region')}</h3>
      <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.86rem' }}>
        {t('language.subtitle', 'Choose your display language and the currency your amounts are shown in.')}
      </p>

      <div className="form-group" style={{ marginBottom: 18 }}>
        <label>{t('language.label', 'Language')}</label>
        <LanguageSwitcher variant="settings" />
      </div>

      <div className="form-group">
        <label>{t('language.currency', 'Currency')}</label>
        <select
          value={currency}
          disabled={saving}
          onChange={e => handleCurrencyChange(e.target.value)}
          style={{ width: 'auto', minWidth: 220 }}
        >
          {CURRENCIES.map(c => (
            <option key={c} value={c}>{c} — {formatCurrency(1234.5, c)}</option>
          ))}
        </select>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '8px 0 0' }}>
          {t('language.currencyHelp', 'Auto-detected from your POS when connected. All amounts are shown in this currency.')}
        </p>
      </div>
    </div>
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CollapsibleCard } from './CollapsibleCard';
import { useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { showToast } from '@org/data';
import { useSpinner } from '../../hooks/useSpinner';
import { useCurrency } from '../../i18n/useCurrency';
import { formatPercent } from '../../i18n/format';

const FINALIZE = gql`
  mutation FinalizeEvent($id: ID!) {
    finalizeEvent(id: $id) { id isFinalized finalizedDate }
  }
`;

interface SalesSummary {
  grossSales?: number | null;
  netSales?: number | null;
  refunds?: number | null;
  discounts?: number | null;
  squareFees?: number | null;
  tips?: number | null;
}

interface ExpenseSummary {
  healthDeptFee?: number | null;
  eventFee?: number | null;
  laborFees?: number | null;
  coordinatorFee?: number | null;
  additionalFees?: number | null;
  employeeBonus?: number | null;
  eventRunnerFees?: number | null;
  mileage?: number | null;
  mileageRate?: number | null;
}

interface ReportSummary {
  posFees?: number | null;
  cogs?: number | null;
  grossProfit?: number | null;
  totalExpenses?: number | null;
  netProfit?: number | null;
  tips?: number | null;
  stateFoodTax?: number | null;
  laborFees?: number | null;
  additionalFeesTotal?: number | null;
  mileageReimbursement?: number | null;
}

interface TaxInfo {
  /** The actual taxes the POS applied. When present these are the source of truth
   *  and the state/local split below is meaningless — applyTaxRates deliberately
   *  writes stateTaxRate/localTaxRate as 0 in that case. */
  lines?: Array<{ name: string; rate: number; amount: number }> | null;
  stateRate?: number | null;
  localRate?: number | null;
  stateTax?: number | null;
  localTax?: number | null;
  taxCollected?: number | null;
  jurisdiction?: { state?: string; county?: string; city?: string } | null;
  stateFoodTax?: number | null;
  taxDetail?: { state?: string } | null;
}

interface Props {
  eventId: string;
  isFinalized: boolean;
  sales: SalesSummary;
  expenses: ExpenseSummary;
  summary: ReportSummary;
  taxes: TaxInfo;
  onFinalized: () => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mt-3 mb-1.5">{children}</div>;
}

function Divider() {
  return <div className="border-t border-[#dde3f0] my-[7px]" />;
}

function LedgerRow({ label, value, bold, final, info, profit }: {
  label: string; value: string;
  bold?: boolean; final?: boolean; info?: boolean;
  profit?: 'positive' | 'negative';
}) {
  const base = 'flex justify-between py-[3px] border-b border-[#f8fafc]';
  const labelCls = [
    info ? 'text-[#64748b] text-[0.82rem]' : 'text-[#222]',
    bold ? 'font-bold' : '',
    final ? 'text-[1.1rem] font-extrabold' : '',
  ].filter(Boolean).join(' ');
  const valueCls = [
    'tabular-nums',
    info ? 'text-[#64748b] text-[0.82rem]' : '',
    bold ? 'font-bold' : 'font-medium',
    final ? 'text-[1.1rem] font-extrabold' : '',
    profit === 'positive' ? 'text-[#166534]' : profit === 'negative' ? 'text-[#991b1b]' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={base}>
      <span className={labelCls}>{label}</span>
      <span className={valueCls}>{value}</span>
    </div>
  );
}

export function ProfitSummaryCard({ eventId, isFinalized, sales, expenses, summary, taxes, onFinalized }: Props) {
  const { t } = useTranslation('home');
  const { fmt } = useCurrency();
  const [finalizeEvent] = useMutation(FINALIZE);
  const { loading, withSpinner } = useSpinner();

  const netProfit = Number(summary.netProfit ?? 0);
  // Ingredient cost is listed as an operating expense here, so the footer has to
  // include it — the server keeps cogs out of totalExpenses (see lib/profit.ts).
  const totalCosts = Number(summary.totalExpenses ?? 0) + Number(summary.cogs ?? 0);

  async function handleFinalize() {
    await withSpinner(async () => {
      try {
        await finalizeEvent({ variables: { id: eventId } });
        showToast(t('toast.eventFinalized', 'Event finalized!'), 'success');
        onFinalized();
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('toast.finalizeFailed', 'Failed to finalize');
        if (msg.includes('FINALIZE_LIMIT_REACHED')) {
          showToast(t('toast.finalizeLimit', 'Upgrade to Pro to finalize more than 1 event.'), 'warning', 5000);
        } else {
          showToast(msg, 'error');
        }
      }
    });
  }

  const stateRate = Number(taxes?.stateRate ?? 0);
  const localRate = Number(taxes?.localRate ?? 0);
  const stateTax = Number(taxes?.stateTax ?? 0);
  const localTax = Number(taxes?.localTax ?? 0);
  const taxCollected = Number(taxes?.taxCollected ?? 0);
  const jName = taxes?.jurisdiction ?? null;
  const posLines = taxes?.lines ?? [];
  const stateLabel = t('profit.salesTaxRemitState', 'Sales tax — remit to {{jurisdiction}} ({{rate}})', {
    jurisdiction: jName?.state || t('profit.stateFallback', 'State'),
    rate: formatPercent(stateRate),
  });
  const localLabel = t('profit.salesTaxRemitLocal', 'Sales tax — remit to {{jurisdiction}} ({{rate}})', {
    jurisdiction: jName?.city || jName?.county || t('profit.localFallback', 'Local'),
    rate: formatPercent(localRate),
  });

  return (
    <CollapsibleCard title={t('profit.cardTitle', 'Event Profit Summary')} defaultOpen={true}>
      <div className="text-[0.88rem]">
        {/* Revenue */}
        <SectionTitle>{t('profit.revenue', 'Revenue')}</SectionTitle>
        <LedgerRow label={t('profit.grossSales', 'Gross Sales')} value={fmt(sales.grossSales)} />
        <LedgerRow label={t('profit.returns', 'Returns')} value={`-${fmt(sales.refunds)}`} />
        <LedgerRow label={t('profit.discounts', 'Discounts')} value={`-${fmt(sales.discounts)}`} />
        <LedgerRow label={t('profit.netSales', 'Net Sales')} value={fmt(sales.netSales)} bold />
        <Divider />

        {/* Operating Expenses */}
        <SectionTitle>{t('profit.operatingExpenses', 'Operating Expenses')}</SectionTitle>
        <LedgerRow label={t('profit.healthDeptFee', 'Health Dept Fee')} value={`-${fmt(expenses.healthDeptFee)}`} />
        <LedgerRow label={t('profit.eventFee', 'Event Fee')} value={`-${fmt(expenses.eventFee)}`} />
        <LedgerRow label={t('profit.additionalFees', 'Additional Fees')} value={`-${fmt(summary.additionalFeesTotal)}`} />
        <LedgerRow label={t('profit.mileageReimbursement', 'Mileage Reimbursement')} value={`-${fmt(summary.mileageReimbursement)}`} />
        <LedgerRow label={t('profit.employeeBonus', 'Employee Bonus')} value={`-${fmt(expenses.employeeBonus)}`} />
        <LedgerRow label={t('profit.eventRunnerFees', 'Event Runner Fees')} value={`-${fmt(expenses.eventRunnerFees)}`} />
        <LedgerRow label={t('profit.laborFees', 'Labor Fees')} value={`-${fmt(summary.laborFees)}`} />
        <LedgerRow label={t('profit.coordinatorFee', 'Coordinator Fee')} value={`-${fmt(expenses.coordinatorFee)}`} />
        <LedgerRow label={t('profit.posFees', 'POS Fees')} value={`-${fmt(summary.posFees)}`} />
        <LedgerRow label={t('profit.ingredientCosts', 'Ingredient Costs')} value={`-${fmt(summary.cogs)}`} />
        <Divider />
        <LedgerRow label={t('profit.totalCosts', 'Total Costs')} value={`-${fmt(totalCosts)}`} bold />
        <Divider />
        <LedgerRow label={t('profit.netProfit', 'Net Profit')} value={fmt(netProfit)} final profit={netProfit >= 0 ? 'positive' : 'negative'} />

        {/* Labor warning */}
        {Number(summary.laborFees ?? 0) === 0 && (
          <div className="flex items-center gap-2 bg-[#fffbeb] border border-[#f59e0b] rounded-md px-3 py-2 my-2 text-[0.85rem] text-[#92400e]">
            <span><i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /></span>
            <span>{t('profit.laborWarning', 'Labor not yet entered — profit may change. Add labor in the Labor card above.')}</span>
          </div>
        )}

        <Divider />

        {/* For Your Records */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">{t('profit.forYourRecords', 'For Your Records')}</div>
          {!isFinalized && (
            <button
              className="btn-primary"
              style={{ fontSize: '0.78rem', padding: '3px 10px' }}
              onClick={handleFinalize}
              disabled={loading}
            >
              {loading && <span className="spinner" />}
              <span><i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('profit.finalizeEvent', 'Finalize Event')}</span>
            </button>
          )}
        </div>
        <LedgerRow label={t('profit.tips', 'Tips (pass-through to staff)')} value={fmt(summary.tips)} info />
        {posLines.length > 0 ? (
          // Square reported the real per-jurisdiction taxes. Show them as-is; the
          // computed state/local split would read 0.00% against a real amount.
          posLines.map((l, i) => (
            <LedgerRow
              key={i}
              label={t('profit.posLine', '{{name}} ({{rate}}%)', { name: l.name, rate: (Number(l.rate) * 100).toFixed(2) })}
              value={fmt(Number(l.amount))}
              info
            />
          ))
        ) : (
          <>
            <LedgerRow label={stateLabel} value={fmt(stateTax)} info />
            <LedgerRow label={localLabel} value={fmt(localTax)} info />
          </>
        )}
        <LedgerRow label={t('profit.totalSalesTaxCollected', 'Total sales tax collected (to remit)')} value={fmt(taxCollected)} info />
        <p className="text-[0.76rem] text-[#64748b] mt-[7px]">{t('profit.taxDisclaimer', 'ⓘ Sales tax is collected on behalf of the taxing authorities and excluded from profit. Income taxes are calculated annually — consult your accountant.')}</p>
      </div>
    </CollapsibleCard>
  );
}

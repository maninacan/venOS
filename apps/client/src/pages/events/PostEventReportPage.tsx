import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation } from 'react-i18next';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useCurrency } from '../../i18n/useCurrency';
import { formatDate } from '../../i18n/format';
import { showToast } from '@org/data';
import venviewLogo from '../../assets/venOS-logo.jpg';

const GET_REPORT = gql`
  query GetPostEventReport($id: ID!) {
    eventReport(id: $id) {
      event {
        id eventName eventDate endDate numDays isFinalized finalizedDate
        posLocationId status eventType eventHost eventLocation
        coordinator time eventRating applicationDate notes customFields
      }
      sales {
        grossSales netSales discounts refunds squareFees tips
        taxRate totalCollected
      }
      expenses {
        healthDeptFee eventFee mileage mileageRate coordinatorFee
        posFee employeeBonus eventRunnerFees laborFees additionalFees
      }
      taxes { stateRate localRate stateTax localTax taxCollected jurisdiction lines { name rate amount } }
      summary {
        posFees cogs grossProfit totalExpenses netProfit
        tips stateFoodTax laborFees additionalFeesTotal mileageReimbursement
      }
      inventorySales { name quantitySold unitCost totalCost }
      laborEntries { id name hours wage total }
      supplies { id name quantity unitCost total }
    }
  }
`;

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };

function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontWeight: bold ? 700 : undefined, color }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', margin: '18px 0 6px' }}>
      {title}
    </div>
  );
}

export function PostEventReportPage() {
  const { t } = useTranslation('events');
  const { fmt } = useCurrency();
  const { eventId } = useParams<{ eventId: string }>();
  const { companyId } = useCurrentCompany();
  const navigate = useNavigate();

  const eventDate = (d: string | null | undefined) => (d ? formatDate(d, LONG_DATE) : '—');
  const formatDateRange = (start: string | null | undefined, numDays: number | null | undefined) => {
    if (!start) return '';
    const s = eventDate(start);
    if (!numDays || numDays <= 1) return s;
    const end = new Date(start + 'T00:00:00');
    end.setDate(end.getDate() + numDays - 1);
    return t('report.dateRange', '{{start}} – {{end}}', { start: s, end: formatDate(end, LONG_DATE) });
  };

  const { data, loading, error } = useQuery(GET_REPORT, {
    variables: { id: eventId },
    skip: !eventId,
  });

  const report = data?.eventReport;
  const event = report?.event;
  const sales = report?.sales ?? {};
  const expenses = report?.expenses ?? {};
  const summary = report?.summary ?? {};
  const taxes = report?.taxes ?? {};
  const laborEntries = report?.laborEntries ?? [];
  const supplies = report?.supplies ?? [];
  const inventorySales = report?.inventorySales ?? [];

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [exportOpen]);

  async function downloadPDF() {
    if (!report) return;
    try {
      const pdfMake = (await import('pdfmake/build/pdfmake')).default;
      // pdfmake 0.3.x exports the vfs object directly; older builds nest it
      // under `.pdfMake.vfs`. Support both so fonts always resolve.
      const vfsModule = await import('pdfmake/build/vfs_fonts') as unknown as {
        default?: { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> } | Record<string, string>;
        pdfMake?: { vfs?: Record<string, string> };
        vfs?: Record<string, string>;
      };
      const d = vfsModule.default as { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> } & Record<string, string> | undefined;
      const vfs =
        d?.pdfMake?.vfs ??
        d?.vfs ??
        (d && typeof d === 'object' && !('pdfMake' in d) && !('vfs' in d) ? (d as Record<string, string>) : undefined) ??
        vfsModule.pdfMake?.vfs ??
        vfsModule.vfs;
      pdfMake.vfs = vfs as Record<string, string>;

      const netProfit = Number(summary.netProfit ?? 0);
      // Ingredient cost is listed among the operating expenses, so the footer must
      // include it — the server keeps cogs out of totalExpenses (see lib/profit.ts).
      const totalCosts = Number(summary.totalExpenses ?? 0) + Number(summary.cogs ?? 0);
      const pdfPosLines = (taxes.lines ?? []) as Array<{ name: string; rate: number; amount: number }>;
      const profitColor = netProfit >= 0 ? '#166534' : '#991b1b';

      const content: unknown[] = [
        { text: event?.eventName ?? t('report.title', 'Post-Event Report'), style: 'title' },
        { text: formatDateRange(event?.eventDate, event?.numDays), style: 'subtitle', margin: [0, 0, 0, 16] },

        // Event summary chips
        ...(event?.status ? [{ text: t('report.chip.status', 'Status: {{value}}', { value: event.status }), style: 'chip' }] : []),
        ...(event?.eventHost ? [{ text: t('report.chip.host', 'Host: {{value}}', { value: event.eventHost }), style: 'chip' }] : []),
        ...(event?.eventLocation ? [{ text: t('report.chip.location', 'Location: {{value}}', { value: event.eventLocation }), style: 'chip' }] : []),

        { text: t('report.salesSummary', 'Sales Summary'), style: 'sectionHeader', margin: [0, 16, 0, 4] },
        buildTable([
          ['', ''],
          [t('report.grossSales', 'Gross Sales'), fmt(sales.grossSales)],
          [t('report.returns', 'Returns'), `-${fmt(sales.refunds)}`],
          [t('report.discounts', 'Discounts'), `-${fmt(sales.discounts)}`],
          [t('report.netSales', 'Net Sales'), fmt(sales.netSales)],
        ]),
      ];

      // Labor table
      if (laborEntries.length > 0) {
        content.push({ text: t('report.labor', 'Labor'), style: 'sectionHeader', margin: [0, 12, 0, 4] });
        content.push({
          table: {
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
              [{ text: t('report.laborName', 'Name'), bold: true }, { text: t('report.laborHours', 'Hours'), bold: true }, { text: t('report.laborWage', 'Wage'), bold: true }, { text: t('report.laborTotal', 'Total'), bold: true }],
              ...laborEntries.map((r: Record<string, unknown>) => [
                String(r['name'] ?? ''),
                String(Number(r['hours']).toFixed(2)),
                t('report.wagePerHour', '{{amount}}/hr', { amount: fmt(r['wage'] as number) }),
                fmt(r['total'] as number),
              ]),
              [{ text: t('report.totalLabor', 'Total Labor'), bold: true, colSpan: 3 }, {}, {}, { text: fmt(summary.laborFees), bold: true }],
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 8],
        });
      }

      // Supplies table
      if (supplies.length > 0) {
        content.push({ text: t('report.supplies', 'Supplies'), style: 'sectionHeader', margin: [0, 12, 0, 4] });
        content.push({
          table: {
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
              [{ text: t('report.suppliesItem', 'Item'), bold: true }, { text: t('report.suppliesQty', 'Qty'), bold: true }, { text: t('report.suppliesUnitCost', 'Unit Cost'), bold: true }, { text: t('report.suppliesTotal', 'Total'), bold: true }],
              ...supplies.map((r: Record<string, unknown>) => [
                String(r['name'] ?? ''),
                String(Number(r['quantity']).toFixed(2)),
                fmt(r['unitCost'] as number),
                fmt(r['total'] as number),
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 8],
        });
      }

      // Expenses
      content.push({ text: t('report.operatingExpenses', 'Operating Expenses'), style: 'sectionHeader', margin: [0, 12, 0, 4] });
      content.push(buildTable([
        ['', ''],
        [t('report.healthDeptFee', 'Health Dept Fee'), `-${fmt(expenses.healthDeptFee)}`],
        [t('report.eventFee', 'Event Fee'), `-${fmt(expenses.eventFee)}`],
        [t('report.mileageReimbursement', 'Mileage Reimbursement'), `-${fmt(summary.mileageReimbursement)}`],
        [t('report.employeeBonus', 'Employee Bonus'), `-${fmt(expenses.employeeBonus)}`],
        [t('report.eventRunnerFees', 'Event Runner Fees'), `-${fmt(expenses.eventRunnerFees)}`],
        [t('report.laborFees', 'Labor Fees'), `-${fmt(summary.laborFees)}`],
        [t('report.coordinatorFee', 'Coordinator Fee'), `-${fmt(expenses.coordinatorFee)}`],
        [t('report.posFees', 'POS Fees'), `-${fmt(summary.posFees)}`],
        [t('report.additionalFees', 'Additional Fees'), `-${fmt(summary.additionalFeesTotal)}`],
        [t('report.ingredientCosts', 'Ingredient Costs'), `-${fmt(summary.cogs)}`],
        [t('report.totalCosts', 'Total Costs'), `-${fmt(totalCosts)}`],
      ]));

      // Net Profit
      content.push({
        table: {
          widths: ['*', 'auto'],
          body: [[
            { text: t('report.netProfit', 'NET PROFIT'), bold: true, fontSize: 14 },
            { text: fmt(netProfit), bold: true, fontSize: 14, color: profitColor },
          ]],
        },
        layout: 'noBorders',
        margin: [0, 16, 0, 8],
      });

      // For your records
      content.push({ text: t('report.forYourRecords', 'For Your Records (Informational)'), style: 'sectionHeader', margin: [0, 12, 0, 4] });
      content.push(buildTable([
        ['', ''],
        [t('report.tipsPassThrough', 'Tips (pass-through to staff)'), fmt(summary.tips)],
        ...(pdfPosLines.length > 0
          // Real POS taxes — the computed state/local split reads 0.00% here.
          ? pdfPosLines.map((l) => [
              t('report.posLine', '{{name}} ({{rate}}%)', { name: l.name, rate: (Number(l.rate) * 100).toFixed(2) }),
              fmt(Number(l.amount)),
            ])
          : [
              [t('report.salesTaxState', 'Sales tax — {{name}} ({{rate}}%)', { name: taxes.jurisdiction?.state ?? t('report.stateFallback', 'State'), rate: (Number(taxes.stateRate ?? 0) * 100).toFixed(2) }), fmt(Number(taxes.stateTax ?? 0))],
              [t('report.salesTaxLocal', 'Sales tax — {{name}} ({{rate}}%)', { name: taxes.jurisdiction?.city ?? taxes.jurisdiction?.county ?? t('report.localFallback', 'Local'), rate: (Number(taxes.localRate ?? 0) * 100).toFixed(2) }), fmt(Number(taxes.localTax ?? 0))],
            ]),
        [t('report.totalSalesTaxCollected', 'Total sales tax collected (to remit)'), fmt(Number(taxes.taxCollected ?? 0))],
      ]));

      const docDef = {
        content,
        styles: {
          title: { fontSize: 20, bold: true, color: '#0B2A4A' },
          subtitle: { fontSize: 11, color: '#64748b' },
          chip: { fontSize: 10, color: '#5B6B7C', margin: [0, 2, 4, 0] },
          sectionHeader: { fontSize: 9, bold: true, color: '#64748b', decoration: 'underline' as const },
        },
        defaultStyle: { fontSize: 10, font: 'Roboto' },
      };

      pdfMake.createPdf(docDef).download(`PostEventReport_${(event?.eventName ?? 'Event').replace(/[^a-z0-9]/gi, '_')}.pdf`);
      showToast(t('toast.pdfDownloaded', 'PDF downloaded!'), 'success');
    } catch (err) {
      showToast(t('toast.pdfFailed', 'PDF export failed: {{error}}', { error: err instanceof Error ? err.message : t('toast.unknownError', 'unknown error') }), 'error');
    }
  }

  function downloadCSV() {
    if (!report) return;
    try {
      const n = (v: unknown) => Number(v ?? 0);
      const rows: (string | number)[][] = [['Section', 'Item', 'Amount']];
      const add = (section: string, item: string, amount: string | number) => rows.push([section, item, amount]);

      add('Event', 'Name', event?.eventName ?? '');
      add('Event', 'Date', formatDateRange(event?.eventDate, event?.numDays));
      if (event?.status) add('Event', 'Status', event.status);
      if (event?.eventHost) add('Event', 'Host', event.eventHost);
      if (event?.eventLocation) add('Event', 'Location', event.eventLocation);

      add('Sales Summary', 'Gross Sales', n(sales.grossSales).toFixed(2));
      add('Sales Summary', 'Returns', (-n(sales.refunds)).toFixed(2));
      add('Sales Summary', 'Discounts', (-n(sales.discounts)).toFixed(2));
      add('Sales Summary', 'Net Sales', n(sales.netSales).toFixed(2));

      for (const r of laborEntries as Array<Record<string, unknown>>) {
        add('Labor', `${String(r['name'] ?? '')} (${n(r['hours']).toFixed(2)}h @ ${n(r['wage']).toFixed(2)}/hr)`, n(r['total']).toFixed(2));
      }
      add('Labor', 'Total Labor', n(summary.laborFees).toFixed(2));

      for (const r of supplies as Array<Record<string, unknown>>) {
        add('Supplies', `${String(r['name'] ?? '')} (${n(r['quantity']).toFixed(2)} @ ${n(r['unitCost']).toFixed(2)})`, n(r['total']).toFixed(2));
      }

      add('Operating Expenses', 'Health Dept Fee', (-n(expenses.healthDeptFee)).toFixed(2));
      add('Operating Expenses', 'Event Fee', (-n(expenses.eventFee)).toFixed(2));
      add('Operating Expenses', 'Mileage Reimbursement', (-n(summary.mileageReimbursement)).toFixed(2));
      add('Operating Expenses', 'Employee Bonus', (-n(expenses.employeeBonus)).toFixed(2));
      add('Operating Expenses', 'Event Runner Fees', (-n(expenses.eventRunnerFees)).toFixed(2));
      add('Operating Expenses', 'Labor Fees', (-n(summary.laborFees)).toFixed(2));
      add('Operating Expenses', 'Coordinator Fee', (-n(expenses.coordinatorFee)).toFixed(2));
      add('Operating Expenses', 'POS Fees', (-n(summary.posFees)).toFixed(2));
      add('Operating Expenses', 'Additional Fees', (-n(summary.additionalFeesTotal)).toFixed(2));
      add('Operating Expenses', 'Ingredient Costs', (-n(summary.cogs)).toFixed(2));
      add('Operating Expenses', 'Total Costs', (-(n(summary.totalExpenses) + n(summary.cogs))).toFixed(2));

      add('Net Profit', 'Net Profit', n(summary.netProfit).toFixed(2));

      add('For Your Records', 'Tips (pass-through to staff)', n(summary.tips).toFixed(2));
      const csvPosLines = (taxes.lines ?? []) as Array<{ name: string; rate: number; amount: number }>;
      if (csvPosLines.length > 0) {
        for (const l of csvPosLines) {
          add('For Your Records', `${l.name} (${(Number(l.rate) * 100).toFixed(2)}%)`, n(l.amount).toFixed(2));
        }
      } else {
        add('For Your Records', 'State sales tax', n(taxes.stateTax).toFixed(2));
        add('For Your Records', 'Local sales tax', n(taxes.localTax).toFixed(2));
      }
      add('For Your Records', 'Total sales tax collected (to remit)', n(taxes.taxCollected).toFixed(2));

      const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = rows.map(r => r.map(esc).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PostEventReport_${(event?.eventName ?? 'Event').replace(/[^a-z0-9]/gi, '_')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      showToast(t('toast.csvDownloaded', 'CSV downloaded!'), 'success');
    } catch (err) {
      showToast(t('toast.csvFailed', 'CSV export failed: {{error}}', { error: err instanceof Error ? err.message : t('toast.unknownError', 'unknown error') }), 'error');
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner spinner-dark" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>;
  }

  if (error || !report) {
    return <div className="inline-error"><span><i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /></span><span>{t('report.loadError', 'Could not load report.')} {error?.message}</span></div>;
  }

  const netProfit = Number(summary.netProfit ?? 0);
  // See the PDF builder above: cogs is excluded from the server's totalExpenses.
  const totalCosts = Number(summary.totalExpenses ?? 0) + Number(summary.cogs ?? 0);
  const posLines = (taxes.lines ?? []) as Array<{ name: string; rate: number; amount: number }>;
  const stateRate = Number(taxes.stateRate ?? 0);
  const localRate = Number(taxes.localRate ?? 0);
  const stateTax = Number(taxes.stateTax ?? 0);
  const localTax = Number(taxes.localTax ?? 0);
  const taxCollected = Number(taxes.taxCollected ?? 0);
  const jur = taxes.jurisdiction ?? null;

  return (
    <>
      {/* Print: show only the report card, nothing else on the page. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-content, #report-content * { visibility: visible; }
          #report-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            max-width: none !important;
            margin: 0;
            border: none;
            box-shadow: none;
          }
        }
      `}</style>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div ref={exportRef} style={{ position: 'relative' }}>
          <button className="btn-primary" onClick={() => setExportOpen(o => !o)} aria-haspopup="menu" aria-expanded={exportOpen}>
            <i className="fa-solid fa-arrow-down" aria-hidden="true" /> {t('report.export', 'Export')} <span style={{ fontSize: '0.7em' }}>▾</span>
          </button>
          {exportOpen && (
            <div
              role="menu"
              style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: 180, background: '#fff', border: '1px solid var(--vv-border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(11,42,74,0.12)', padding: 4 }}
            >
              <button
                role="menuitem"
                className="dropdown-item"
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '9px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--vv-navy)' }}
                onClick={() => { setExportOpen(false); downloadPDF(); }}
              ><i className="fa-solid fa-file-lines" aria-hidden="true" /> {t('report.exportPdf', 'Export to PDF')}</button>
              <button
                role="menuitem"
                className="dropdown-item"
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '9px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--vv-navy)' }}
                onClick={() => { setExportOpen(false); downloadCSV(); }}
              ><i className="fa-solid fa-chart-column" aria-hidden="true" /> {t('report.exportCsv', 'Export to CSV')}</button>
            </div>
          )}
        </div>
        <button className="btn-secondary" onClick={() => window.print()}><i className="fa-solid fa-print" aria-hidden="true" /> {t('report.print', 'Print')}</button>
        <Link to={`/companies/${companyId}/events/${eventId}`} className="btn-secondary" style={{ textDecoration: 'none' }}><i className="fa-solid fa-arrow-left" aria-hidden="true" /> {t('report.backToDashboard', 'Back to Dashboard')}</Link>
      </div>

      {/* Report card */}
      <div className="card" id="report-content" style={{ maxWidth: 760 }}>
        {/* Header */}
        <div style={{ borderBottom: '2px solid var(--vv-navy)', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <h1 style={{ margin: '0 0 4px', fontSize: '1.6rem', color: 'var(--vv-navy)', fontFamily: 'DM Serif Display, serif' }}>
              <i className="fa-solid fa-chart-bar" /> {t('report.title', 'Post-Event Report')}
            </h1>
            <img src={venviewLogo} alt={t('report.logoAlt', 'venOS')} style={{ height: 48, width: 'auto', flexShrink: 0 }} />
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--vv-navy)', marginBottom: 2 }}>
            {event?.eventName}
          </div>
          <div style={{ fontSize: '0.88rem', color: 'var(--muted)' }}>
            {formatDateRange(event?.eventDate, event?.numDays)}
            {event?.isFinalized && <span className="finalized-badge-large" style={{ marginLeft: 10 }}>{t('report.finalizedBadge', 'FINALIZED')}</span>}
          </div>
          {/* Meta */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, fontSize: '0.85rem', color: 'var(--muted)' }}>
            {event?.status && <span><strong>{t('report.metaStatus', 'Status:')}</strong> {event.status}</span>}
            {event?.eventHost && <span><strong>{t('report.metaHost', 'Host:')}</strong> {event.eventHost}</span>}
            {event?.eventLocation && <span><strong>{t('report.metaLocation', 'Location:')}</strong> {event.eventLocation}</span>}
            {event?.coordinator && <span><strong>{t('report.metaCoordinator', 'Coordinator:')}</strong> {event.coordinator}</span>}
          </div>
        </div>

        {/* Sales Summary */}
        <SectionHeader title={t('report.salesSummary', 'Sales Summary')} />
        <Row label={t('report.grossSales', 'Gross Sales')} value={fmt(sales.grossSales)} />
        <Row label={t('report.returns', 'Returns')} value={`-${fmt(sales.refunds)}`} />
        <Row label={t('report.discounts', 'Discounts')} value={`-${fmt(sales.discounts)}`} />
        <Row label={t('report.netSales', 'Net Sales')} value={fmt(sales.netSales)} bold />

        {/* Labor */}
        {laborEntries.length > 0 && (
          <>
            <SectionHeader title={t('report.labor', 'Labor')} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600 }}>{t('report.laborName', 'Name')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.laborHours', 'Hours')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.laborWage', 'Wage')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.laborTotal', 'Total')}</th>
                </tr>
              </thead>
              <tbody>
                {laborEntries.map((r: Record<string, unknown>, i: number) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>{r['name'] as string}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{Number(r['hours']).toFixed(2)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{t('report.wagePerHour', '{{amount}}/hr', { amount: fmt(r['wage'] as number) })}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{fmt(r['total'] as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Row label={t('report.totalLabor', 'Total Labor')} value={`-${fmt(summary.laborFees)}`} bold />
          </>
        )}

        {/* Supplies */}
        {supplies.length > 0 && (
          <>
            <SectionHeader title={t('report.supplies', 'Supplies')} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600 }}>{t('report.suppliesItem', 'Item')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.suppliesQty', 'Qty')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.suppliesUnitCost', 'Unit Cost')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.suppliesTotal', 'Total')}</th>
                </tr>
              </thead>
              <tbody>
                {supplies.map((r: Record<string, unknown>, i: number) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>{r['name'] as string}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{Number(r['quantity']).toFixed(2)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{fmt(r['unitCost'] as number)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{fmt(r['total'] as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Inventory Sales */}
        {inventorySales.length > 0 && (
          <>
            <SectionHeader title={t('report.itemsSold', 'Items Sold (Inventory)')} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600 }}>{t('report.suppliesItem', 'Item')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.qtySold', 'Qty Sold')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.suppliesUnitCost', 'Unit Cost')}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{t('report.totalCogs', 'Total COGS')}</th>
                </tr>
              </thead>
              <tbody>
                {inventorySales.map((r: Record<string, unknown>, i: number) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>{r['name'] as string}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{Number(r['quantitySold'])}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{r['unitCost'] != null ? fmt(r['unitCost'] as number) : '—'}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>{fmt(r['totalCost'] as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Operating Expenses */}
        <SectionHeader title={t('report.operatingExpenses', 'Operating Expenses')} />
        {Number(expenses.healthDeptFee ?? 0) > 0 && <Row label={t('report.healthDeptFee', 'Health Dept Fee')} value={`-${fmt(expenses.healthDeptFee)}`} />}
        {Number(expenses.eventFee ?? 0) > 0 && <Row label={t('report.eventFee', 'Event Fee')} value={`-${fmt(expenses.eventFee)}`} />}
        {Number(summary.mileageReimbursement ?? 0) > 0 && <Row label={t('report.mileageReimbursement', 'Mileage Reimbursement')} value={`-${fmt(summary.mileageReimbursement)}`} />}
        {Number(expenses.employeeBonus ?? 0) > 0 && <Row label={t('report.employeeBonus', 'Employee Bonus')} value={`-${fmt(expenses.employeeBonus)}`} />}
        {Number(expenses.eventRunnerFees ?? 0) > 0 && <Row label={t('report.eventRunnerFees', 'Event Runner Fees')} value={`-${fmt(expenses.eventRunnerFees)}`} />}
        {Number(summary.laborFees ?? 0) > 0 && <Row label={t('report.laborFees', 'Labor Fees')} value={`-${fmt(summary.laborFees)}`} />}
        {Number(expenses.coordinatorFee ?? 0) > 0 && <Row label={t('report.coordinatorFee', 'Coordinator Fee')} value={`-${fmt(expenses.coordinatorFee)}`} />}
        {Number(summary.posFees ?? 0) > 0 && <Row label={t('report.posFees', 'POS Fees')} value={`-${fmt(summary.posFees)}`} />}
        {Number(summary.additionalFeesTotal ?? 0) !== 0 && <Row label={t('report.additionalFeesDiscounts', 'Additional Fees / Discounts')} value={`-${fmt(summary.additionalFeesTotal)}`} />}
        {Number(summary.cogs ?? 0) > 0 && <Row label={t('report.ingredientCosts', 'Ingredient Costs')} value={`-${fmt(summary.cogs)}`} />}
        <Row label={t('report.totalCosts', 'Total Costs')} value={`-${fmt(totalCosts)}`} bold />

        {/* Net Profit */}
        <div style={{ background: netProfit >= 0 ? '#f0fdf4' : '#fef2f2', border: `2px solid ${netProfit >= 0 ? '#bbf7d0' : '#fecaca'}`, borderRadius: 10, padding: '16px 18px', margin: '18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--vv-navy)' }}>{t('report.netProfit', 'NET PROFIT')}</span>
          <span style={{ fontWeight: 800, fontSize: '1.3rem', color: netProfit >= 0 ? '#166534' : '#991b1b', fontVariantNumeric: 'tabular-nums' }}>{fmt(netProfit)}</span>
        </div>

        {/* For your records */}
        <SectionHeader title={t('report.forYourRecords', 'For Your Records (Informational)')} />
        <Row label={t('report.tipsPassThrough', 'Tips (pass-through to staff)')} value={fmt(summary.tips)} />
        {posLines.length > 0 ? (
          posLines.map((l, i) => (
            <Row key={i} label={t('report.posLine', '{{name}} ({{rate}}%)', { name: l.name, rate: (Number(l.rate) * 100).toFixed(2) })} value={fmt(Number(l.amount))} />
          ))
        ) : (
          <>
            <Row label={t('report.salesTaxRemitState', 'Sales tax — remit to {{name}} ({{rate}}%)', { name: jur?.state ?? t('report.stateFallback', 'State'), rate: (stateRate * 100).toFixed(2) })} value={fmt(stateTax)} />
            <Row label={t('report.salesTaxRemitLocal', 'Sales tax — remit to {{name}} ({{rate}}%)', { name: jur?.city ?? jur?.county ?? t('report.localFallback', 'Local'), rate: (localRate * 100).toFixed(2) })} value={fmt(localTax)} />
          </>
        )}
        <Row label={t('report.totalSalesTaxCollected', 'Total sales tax collected (to remit)')} value={fmt(taxCollected)} />
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 8 }}>
          {t('report.incomeTaxNote', 'ⓘ Income taxes are calculated annually — consult your accountant.')}
        </p>
      </div>
    </>
  );
}

// ── PDF helper ────────────────────────────────────────────────────────────────

function buildTable(rows: string[][]): unknown {
  return {
    table: {
      widths: ['*', 'auto'],
      body: rows.map(([label, value]) => [
        { text: label, color: '#374151' },
        { text: value, alignment: 'right', color: '#374151' },
      ]),
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 4],
  };
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useCurrency } from '../../i18n/useCurrency';
import { formatDate } from '../../i18n/format';
import { showToast } from '@org/data';

const GET_EVENTS = gql`
  query GetEvents($companyId: ID!, $filter: String, $search: String) {
    events(companyId: $companyId, filter: $filter, search: $search) {
      id eventName eventDate status isFinalized posLocationId
      netProfit
      sales { grossSales netSales }
    }
  }
`;

const GET_KPI = gql`
  query GetEventKpi($companyId: ID!) {
    eventKpi(companyId: $companyId) { totalEvents finalizedCount grossSales netSales }
  }
`;

const GET_TREND = gql`
  query GetEventTrend($companyId: ID!) {
    eventTrend(companyId: $companyId) { eventId name date netProfit }
  }
`;

type FilterType = 'all' | 'finalized' | 'notfinalized';

export function EventsPage() {
  const { t } = useTranslation('events');
  const { fmt } = useCurrency();
  const eventDate = (d: string | null | undefined) =>
    d ? formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const { companyId } = useCurrentCompany();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filterVar = filter === 'all' ? undefined : filter;

  const { data: eventsData, loading: eventsLoading } = useQuery(GET_EVENTS, {
    variables: { companyId, filter: filterVar, search: search || undefined },
    skip: !companyId,
  });
  const { data: kpiData } = useQuery(GET_KPI, { variables: { companyId }, skip: !companyId });
  const { data: trendData } = useQuery(GET_TREND, { variables: { companyId }, skip: !companyId });

  const events = eventsData?.events ?? [];
  const kpi = kpiData?.eventKpi;
  const trend = (trendData?.eventTrend ?? []).map((tr: { date: string; netProfit: number; name: string; eventId: string }) => ({
    ...tr,
    date: eventDate(tr.date),
    profit: Number(tr.netProfit.toFixed(2)),
  }));

  function handleSearch() {
    setSearch(searchInput);
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
  }

  function exportCSV() {
    const rows = [
      [
        t('csv.eventName', 'Event Name'),
        t('csv.date', 'Date'),
        t('csv.status', 'Status'),
        t('csv.grossSales', 'Gross Sales'),
        t('csv.netProfit', 'Net Profit'),
        t('csv.finalized', 'Finalized'),
      ],
      ...events.map((e: Record<string, unknown>) => [
        e['eventName'],
        eventDate(e['eventDate'] as string),
        e['status'] ?? '',
        fmt((e as { sales?: { grossSales?: number } })['sales']?.grossSales),
        fmt(e['netProfit'] as number),
        e['isFinalized'] ? t('csv.yes', 'Yes') : t('csv.no', 'No'),
      ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'events.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast(t('toast.csvExported', 'CSV exported'), 'success');
  }

  if (!companyId) return null;

  return (
    <>
      <div className="card">
        <h2 style={{ margin: '0 0 16px', color: 'var(--vv-navy)' }}>{t('list.title', 'Manage Events')}</h2>

        {/* KPI chips */}
        {kpi && (
          <div className="flex gap-3.5 flex-wrap mb-5">
            {([
              { label: t('list.kpi.totalEvents', 'Total Events'), value: kpi.totalEvents },
              { label: t('list.kpi.finalized', 'Finalized'), value: kpi.finalizedCount },
              { label: t('list.kpi.grossSales', 'Gross Sales'), value: fmt(kpi.grossSales) },
              { label: t('list.kpi.netSales', 'Net Sales'), value: fmt(kpi.netSales) },
            ] as { label: string; value: string | number }[]).map(chip => (
              <div key={chip.label} className="bg-white border border-[rgba(11,42,74,0.12)] rounded-[10px] px-[18px] py-3 flex-1 min-w-[130px]">
                <span className="text-[0.72rem] font-semibold text-[#64748b] uppercase tracking-[0.05em] block mb-[3px]">{chip.label}</span>
                <span className="text-[1.4rem] font-bold text-[#0B2A4A]">{chip.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Profit chart */}
        {trend.length > 1 && (
          <div style={{ background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 16px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, color: '#374151', fontSize: '0.9rem' }}>{t('list.chart.title', 'Net Profit per Event')}</span>
              <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{t('list.chart.subtitle', 'All events · sorted by date')}</span>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#19B37A" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#19B37A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => fmt(v)} />
                <Tooltip formatter={(v: number) => [fmt(v), t('list.chart.tooltipLabel', 'Net Profit')]} />
                <Area type="monotone" dataKey="profit" stroke="#19B37A" strokeWidth={2} fill="url(#profitGrad)" dot={{ r: 3, fill: '#19B37A' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Filter + search bar */}
        <div className="flex gap-2 mb-3.5 flex-wrap">
          {(['all', 'finalized', 'notfinalized'] as FilterType[]).map(f => (
            <button
              key={f}
              className={filter === f ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setFilter(f)}
              style={{ fontSize: '0.83rem', padding: '6px 13px' }}
            >
              {f === 'all' ? t('list.filter.all', 'All') : f === 'finalized' ? t('list.filter.finalized', 'Finalized') : t('list.filter.notFinalized', 'Not Finalized')}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap mb-4 items-end">
          <input
            type="text"
            placeholder={t('list.searchPlaceholder', 'Event name')}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ maxWidth: 220 }}
          />
          <button className="btn-secondary" onClick={handleSearch}><i className="fa-solid fa-magnifying-glass" /> {t('list.search', 'Search')}</button>
          <button className="btn-secondary" onClick={clearSearch}><i className="fa-solid fa-broom" /> {t('list.clear', 'Clear')}</button>
          <button className="btn-secondary" onClick={exportCSV}><i className="fa-solid fa-file-arrow-down" /> {t('list.exportCsv', 'Export CSV')}</button>
          <Link to={`/companies/${companyId}/events/new`} className="btn-primary ml-auto">
            {t('list.addEvent', '+ Add Event')}
          </Link>
        </div>

        {/* Events table */}
        <div className="overflow-x-auto">
          {eventsLoading ? (
            <p className="text-[#64748b] text-[0.88rem] py-4">{t('list.loading', 'Loading events…')}</p>
          ) : events.length === 0 ? (
            <p className="text-[#64748b] text-[0.88rem] py-4 text-center">
              {t('list.empty', 'No events found.')} <Link to={`/companies/${companyId}/events/new`} className="text-[#0B2A4A] font-semibold">{t('list.emptyCta', 'Add your first event')} <i className="fa-solid fa-arrow-right" aria-hidden="true" /></Link>
            </p>
          ) : (
            <table className="w-full border-collapse text-[0.87rem]">
              <thead>
                <tr>
                  {[
                    t('list.table.eventName', 'Event Name'),
                    t('list.table.date', 'Date'),
                    t('list.table.status', 'Status'),
                    t('list.table.grossSales', 'Gross Sales'),
                    t('list.table.netProfit', 'Net Profit'),
                    t('list.table.finalized', 'Finalized'),
                  ].map(h => (
                    <th key={h} className="px-3 py-[9px] text-left text-[0.72rem] font-semibold text-[#64748b] uppercase tracking-[0.05em] border-b-2 border-[#dde3f0] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e: Record<string, unknown>) => (
                  <tr
                    key={e['id'] as string}
                    className="cursor-pointer hover:[&>td]:bg-[#f8fafc]"
                    onClick={() => navigate(`/companies/${companyId}/events/${e['id']}`)}
                  >
                    <td className="px-3 py-[11px] border-b border-[#f1f5f9] align-middle font-semibold">{e['eventName'] as string}</td>
                    <td className="px-3 py-[11px] border-b border-[#f1f5f9] align-middle">{eventDate(e['eventDate'] as string)}</td>
                    <td className="px-3 py-[11px] border-b border-[#f1f5f9] align-middle">
                      <span className="text-[0.8rem] bg-[#f1f5f9] px-2 py-[2px] rounded-full">
                        {(e['status'] as string) || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-[11px] border-b border-[#f1f5f9] align-middle">{fmt((e as { sales?: { grossSales?: number } })['sales']?.grossSales)}</td>
                    <td className={`px-3 py-[11px] border-b border-[#f1f5f9] align-middle font-semibold ${Number(e['netProfit']) >= 0 ? 'text-[#166534]' : 'text-[#991b1b]'}`}>
                      {fmt(e['netProfit'] as number)}
                    </td>
                    <td className="px-3 py-[11px] border-b border-[#f1f5f9] align-middle">
                      {e['isFinalized']
                        ? <span className="finalized-badge-large">{t('list.finalizedBadge', 'FINALIZED')}</span>
                        : <span className="text-[#64748b] text-[0.82rem]">{t('list.no', 'No')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

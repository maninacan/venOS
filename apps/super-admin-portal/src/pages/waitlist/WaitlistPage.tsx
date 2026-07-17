import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { ActiveTableFilterOption } from '@org/data';
import type { TableHeaderItem, TableDataRow, TableFilter } from '@org/data';
import { Table } from '@org/common-components';

const GET_WAITLIST_SIGNUPS = gql`
  query GetWaitlistSignups {
    waitlistSignups {
      id
      email
      source
      createdAt
    }
  }
`;

interface WaitlistRow {
  id: string;
  email: string;
  source: string;
  createdAt: string;
}

const HEADERS: TableHeaderItem[] = [
  { id: 'email', headerLabel: 'Email' },
  { id: 'source', headerLabel: 'Source' },
  { id: 'createdAt', headerLabel: 'Signed up' },
];

const SOURCE_FILTER: TableFilter = {
  id: 'source',
  value: 'Source',
  options: [
    { key: 'all', value: 'all', label: 'All Sources', isAllOption: true },
    { key: 'hero', value: 'hero', label: 'Hero', filter: (row) => (row as WaitlistRow).source === 'hero' },
    { key: 'cta', value: 'cta', label: 'CTA', filter: (row) => (row as WaitlistRow).source === 'cta' },
  ],
};

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WaitlistPage() {
  const { data, loading } = useQuery(GET_WAITLIST_SIGNUPS);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ActiveTableFilterOption[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => { setCurrentPage(1); }, [search, activeFilters]);

  const allSignups = useMemo<WaitlistRow[]>(() => {
    const signups: { id: string; email: string; source: string | null; createdAt: string | null }[] =
      data?.waitlistSignups ?? [];
    return signups.map(s => ({
      id: s.id,
      email: s.email,
      source: s.source ?? '',
      createdAt: s.createdAt ?? '',
    }));
  }, [data]);

  const filtered = useMemo(() => {
    let result = allSignups;
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(s => s.email.toLowerCase().includes(lower));
    }
    for (const f of activeFilters) {
      if (f.filter) result = result.filter(f.filter as (row: WaitlistRow) => boolean);
    }
    return result;
  }, [allSignups, search, activeFilters]);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function handleExportCsv() {
    const header = ['Email', 'Source', 'Signed up'];
    const rows = filtered.map(s => [s.email, s.source, s.createdAt]);
    const escape = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'waitlist-signups.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mt-0 mb-1 text-[1.4rem] font-bold text-[#0B2A4A]">Waitlist</h1>
          <p className="m-0 text-[0.88rem] text-[#64748b]">
            {filtered.length} email{filtered.length === 1 ? '' : 's'} signed up on the marketing page.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="px-[14px] py-[9px] rounded-lg text-[0.85rem] font-semibold text-white bg-[#0B2A4A] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      <Table<WaitlistRow>
        label="Waitlist"
        headerList={HEADERS}
        dataList={paginated as TableDataRow<WaitlistRow>[]}
        loading={loading}
        searchValue={search}
        handleSearch={setSearch}
        filters={[SOURCE_FILTER]}
        activeFilters={activeFilters}
        setActiveFilters={setActiveFilters}
        mapData={(row) => ({
          ...row,
          source: (row.source as string) || '—',
          createdAt: formatDate(row.createdAt as string),
        })}
        pagination={{
          totalItems: filtered.length,
          itemsPerPage: PAGE_SIZE,
          currentPage,
          onPageChange: setCurrentPage,
        }}
      />
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import {
  showToast,
  TableCellContentAlignEnum,
  ActiveTableFilterOption,
} from '@org/data';
import type { TableHeaderItem, TableDataRow, TableFilter } from '@org/data';
import { Table } from '@org/common-components';

const GET_ADMIN_COMPANIES = gql`
  query GetAdminCompanies {
    adminCompanies {
      id
      name
      plan
      ownerEmail
      createdAt
      memberCount
      members {
        userId
        email
        role
        status
        joinedAt
      }
    }
  }
`;

const UPDATE_PLAN = gql`
  mutation UpdateCompanyPlan($companyId: ID!, $plan: String!) {
    updateCompanyPlan(companyId: $companyId, plan: $plan) { id name plan }
  }
`;

interface CompanyMember {
  userId: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
  plan: string;
  ownerEmail: string;
  createdAt: string | null;
  memberCount: number;
  members: CompanyMember[];
}

const HEADERS: TableHeaderItem[] = [
  { id: 'name', headerLabel: 'Company' },
  { id: 'ownerEmail', headerLabel: 'Owner' },
  { id: 'plan', headerLabel: 'Plan' },
  { id: 'memberCount', headerLabel: 'Members', alignment: TableCellContentAlignEnum.RIGHT },
];

const PLAN_FILTER: TableFilter = {
  id: 'plan',
  value: 'Plan',
  options: [
    { key: 'all', value: 'all', label: 'All Plans', isAllOption: true },
    { key: 'starter', value: 'starter', label: 'Starter', filter: (row) => (row as CompanyRow).plan === 'starter' },
    { key: 'pro', value: 'pro', label: 'Pro', filter: (row) => (row as CompanyRow).plan === 'pro' },
  ],
};

const PAGE_SIZE = 20;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CompaniesPage() {
  const { data, loading, refetch } = useQuery(GET_ADMIN_COMPANIES);
  const [updatePlan] = useMutation(UPDATE_PLAN);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ActiveTableFilterOption[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<CompanyRow | null>(null);

  useEffect(() => { setCurrentPage(1); }, [search, activeFilters]);

  const allCompanies = useMemo<CompanyRow[]>(() => {
    return (data?.adminCompanies ?? []) as CompanyRow[];
  }, [data]);

  // Keep the open detail modal in sync with refetched data (e.g. after a plan change).
  const selectedLive = useMemo(
    () => (selected ? allCompanies.find(c => c.id === selected.id) ?? selected : null),
    [selected, allCompanies]
  );

  const filtered = useMemo(() => {
    let result = allCompanies;
    if (search) {
      const lower = search.trim().toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(lower) ||
        c.ownerEmail.toLowerCase().includes(lower) ||
        c.members.some(m => m.email.toLowerCase().includes(lower))
      );
    }
    for (const f of activeFilters) {
      if (f.filter) result = result.filter(f.filter as (row: CompanyRow) => boolean);
    }
    return result;
  }, [allCompanies, search, activeFilters]);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  async function handleUpdatePlan(companyId: string, plan: string, companyName: string) {
    try {
      await updatePlan({ variables: { companyId, plan } });
      showToast(`Updated ${companyName} to ${plan}`, 'success');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update plan', 'error');
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="mt-0 mb-1 text-[1.4rem] font-bold text-[#0B2A4A]">Companies</h1>
        <p className="m-0 text-[0.88rem] text-[#64748b]">Manage plans across all companies. Click a row for details.</p>
      </div>

      <Table<CompanyRow>
        label="Companies"
        headerList={HEADERS}
        dataList={paginated as TableDataRow<CompanyRow>[]}
        loading={loading}
        searchValue={search}
        handleSearch={setSearch}
        filters={[PLAN_FILTER]}
        activeFilters={activeFilters}
        setActiveFilters={setActiveFilters}
        onClickRow={(row) => setSelected(row as CompanyRow)}
        mapData={(row) => ({
          ...row,
          plan: (
            <select
              value={row.plan as string}
              onClick={e => e.stopPropagation()}
              onChange={e => handleUpdatePlan(row.id as string, e.target.value, row.name as string)}
              style={{ width: 'auto', fontSize: '0.8rem', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5 }}
            >
              <option value="starter">starter</option>
              <option value="pro">pro</option>
            </select>
          ),
        })}
        pagination={{
          totalItems: filtered.length,
          itemsPerPage: PAGE_SIZE,
          currentPage,
          onPageChange: setCurrentPage,
        }}
      />

      {selectedLive && (
        <CompanyDetailModal
          company={selectedLive}
          onClose={() => setSelected(null)}
          onUpdatePlan={handleUpdatePlan}
        />
      )}
    </>
  );
}

interface CompanyDetailModalProps {
  company: CompanyRow;
  onClose: () => void;
  onUpdatePlan: (companyId: string, plan: string, companyName: string) => void;
}

function CompanyDetailModal({ company, onClose, onUpdatePlan }: CompanyDetailModalProps) {
  const sortedMembers = useMemo(() => {
    const rank: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return [...company.members].sort((a, b) => {
      // Active before pending, then by role, then by email.
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      const ra = rank[a.role] ?? 3;
      const rb = rank[b.role] ?? 3;
      if (ra !== rb) return ra - rb;
      return a.email.localeCompare(b.email);
    });
  }, [company.members]);

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark" aria-hidden="true" /></button>

        <h2 className="mt-0 mb-1 text-[1.2rem] font-bold text-[#0B2A4A]">{company.name}</h2>
        <p className="m-0 mb-5 text-[0.82rem] text-[#64748b]">Created {formatDate(company.createdAt)}</p>

        <dl className="grid grid-cols-2 gap-3 mb-6">
          <div>
            <dt className="text-[0.72rem] uppercase tracking-wide text-[#94a3b8] mb-1">Owner</dt>
            <dd className="m-0 text-[0.88rem] text-[#0B2A4A] break-all">{company.ownerEmail || '—'}</dd>
          </div>
          <div>
            <dt className="text-[0.72rem] uppercase tracking-wide text-[#94a3b8] mb-1">Members</dt>
            <dd className="m-0 text-[0.88rem] text-[#0B2A4A]">{company.memberCount}</dd>
          </div>
          <div>
            <dt className="text-[0.72rem] uppercase tracking-wide text-[#94a3b8] mb-1">Plan</dt>
            <dd className="m-0">
              <select
                value={company.plan}
                onChange={e => onUpdatePlan(company.id, e.target.value, company.name)}
                style={{ width: 'auto', fontSize: '0.8rem', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5 }}
              >
                <option value="starter">starter</option>
                <option value="pro">pro</option>
              </select>
            </dd>
          </div>
        </dl>

        <h3 className="mt-0 mb-2 text-[0.95rem] font-semibold text-[#0B2A4A]">Team Members</h3>
        {sortedMembers.length === 0 ? (
          <p className="m-0 text-[0.85rem] text-[#64748b]">No members.</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col divide-y divide-[rgba(11,42,74,0.08)]">
            {sortedMembers.map(m => (
              <li key={m.userId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[0.86rem] text-[#0B2A4A] break-all">{m.email || m.userId}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[0.75rem] font-medium text-[#64748b] capitalize">{m.role}</span>
                  {m.status !== 'active' && (
                    <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[#b45309] bg-[#fef3c7] rounded px-1.5 py-0.5">
                      {m.status}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { CompanyCard, CompanyCardSkeleton } from '../../components/companies/CompanyCard';
import { GetStartedEmptyState } from '../../components/companies/GetStartedEmptyState';
import { showToast } from '@org/data';

const GET_MY_COMPANIES = gql`
  query GetMyCompanies {
    me {
      id
      companies {
        id name vendorCategory plan
        members { userId role }
      }
      pendingCompanies {
        id name vendorCategory plan lastRemindedAt
      }
    }
  }
`;

const REQUEST_ACCESS = gql`
  mutation RequestAccess($joinCode: String!) {
    requestAccess(joinCode: $joinCode) { companyName status }
  }
`;

export function CompaniesPage() {
  const { t } = useTranslation('companies');
  const [joinCode, setJoinCode] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joining, setJoining] = useState(false);

  const { data, loading, refetch } = useQuery(GET_MY_COMPANIES);
  const [requestAccess] = useMutation(REQUEST_ACCESS);

  const companies = data?.me?.companies ?? [];
  const pendingCompanies = data?.me?.pendingCompanies ?? [];
  const isFirstRun = !loading && data?.me && companies.length === 0 && pendingCompanies.length === 0;

  // Request access to a company by join code. Shared by the inline join form and
  // the first-run empty state.
  async function submitJoin(code: string) {
    if (!code.trim()) return;
    setJoining(true);
    try {
      const { data: result } = await requestAccess({ variables: { joinCode: code.trim().toUpperCase() } });
      const { companyName, status } = result.requestAccess;
      if (status === 'active') {
        showToast(t('toast.alreadyMember', "You're already a member of {{name}}.", { name: companyName }), 'info');
        refetch();
      } else {
        showToast(t('toast.accessRequested', 'Access requested for {{name}} — pending owner approval.', { name: companyName }), 'success', 6000);
        refetch();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.invalidJoinCode', 'Invalid join code'), 'error');
    } finally {
      setJoining(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    await submitJoin(joinCode);
    setJoinCode('');
    setShowJoinForm(false);
  }

  if (isFirstRun) {
    return <GetStartedEmptyState onJoin={submitJoin} joining={joining} />;
  }

  return (
    <>
      <div className="mb-2">
        <h1 className="text-[1.5rem] font-bold text-[#0B2A4A] mt-0 mb-1">
          {data?.me ? t('welcomeBack', 'Welcome back!') : t('myCompanies', 'My Companies')}
        </h1>
        <p className="text-[#64748b] text-[0.9rem] m-0">{t('subtitle', 'Select a company to manage its events, inventory, and recipes.')}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[18px] mt-6">
        {loading && [0, 1, 2].map(i => <CompanyCardSkeleton key={i} />)}

        {!loading && companies.map((c: Parameters<typeof CompanyCard>[0]['company']) => (
          <CompanyCard key={c.id} company={c} />
        ))}

        {!loading && pendingCompanies.map((c: Parameters<typeof CompanyCard>[0]['company']) => (
          <CompanyCard key={c.id} company={c} pending />
        ))}

        <Link
          to="/companies/new"
          className="bg-[#f8fafc] border-2 border-dashed border-[rgba(11,42,74,0.12)] rounded-[14px] p-[22px] min-h-[150px] flex flex-col items-center justify-center gap-2 cursor-pointer no-underline text-[#64748b] font-semibold text-[0.9rem] transition-[border-color,background,color] hover:border-[#0B2A4A] hover:bg-[#eff6ff] hover:text-[#0B2A4A]"
        >
          <span className="text-[1.8rem] opacity-40">+</span>
          {t('createNew', 'Create a new company')}
        </Link>
      </div>

      <div className="flex gap-3 mt-7 flex-wrap">
        {!showJoinForm ? (
          <button className="btn-secondary" onClick={() => setShowJoinForm(true)}>
            <i className="fa-solid fa-link" /> {t('requestToJoin', 'Request to join a company')}
          </button>
        ) : (
          <form onSubmit={handleJoin} className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              placeholder={t('joinCodePlaceholder', 'Enter join code (e.g. ABC123)')}
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              style={{ width: 220 }}
              autoFocus
            />
            <button type="submit" className="btn-primary" disabled={joining}>
              {joining && <span className="spinner" />} <span>{t('requestAccess', 'Request access')}</span>
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowJoinForm(false)}>{t('cancel', 'Cancel')}</button>
          </form>
        )}
      </div>
    </>
  );
}

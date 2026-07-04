import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { showToast } from '@org/data';

interface Company {
  id: string;
  name: string;
  vendorCategory?: string | null;
  plan: string;
  members?: Array<unknown>;
  lastRemindedAt?: string | null;
}

interface Props {
  company: Company;
  /** The user has requested to join this company and is awaiting owner approval. */
  pending?: boolean;
}

// Keep in sync with REMINDER_COOLDOWN_MS in apps/venview-api (remindJoinRequest).
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const REMIND_JOIN_REQUEST = gql`
  mutation RemindJoinRequest($companyId: ID!) {
    remindJoinRequest(companyId: $companyId) { ok lastRemindedAt }
  }
`;

function formatRemaining(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin >= 60) return `${Math.ceil(totalMin / 60)}h`;
  return `${totalMin}m`;
}

export function CompanyCard({ company, pending }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation('companies');
  const [remind, { loading: reminding }] = useMutation(REMIND_JOIN_REQUEST);
  const [lastReminded, setLastReminded] = useState<string | null>(company.lastRemindedAt ?? null);

  // Pending: the user isn't a member yet, so the card is non-interactive and
  // visually distinct — dashed border, reduced opacity, and an amber status badge.
  if (pending) {
    const remainingMs = lastReminded
      ? new Date(lastReminded).getTime() + REMINDER_COOLDOWN_MS - Date.now()
      : 0;
    const cooling = remainingMs > 0;

    async function handleRemind() {
      try {
        const { data } = await remind({ variables: { companyId: company.id } });
        setLastReminded(data?.remindJoinRequest?.lastRemindedAt ?? new Date().toISOString());
        showToast(t('toast.reminderSent', 'Reminder sent to the owner.'), 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : t('toast.reminderFailed', 'Could not send reminder.'), 'error');
      }
    }

    return (
      <div
        className="bg-white border-2 border-dashed border-[rgba(11,42,74,0.22)] rounded-[14px] p-[22px] relative min-h-[150px] flex flex-col opacity-70"
        aria-label={t('pending.aria', '{{name}} — awaiting approval', { name: company.name })}
      >
        <div className="text-[1.05rem] font-bold text-[#0B2A4A] mb-[5px]">{company.name}</div>
        {company.vendorCategory && (
          <div className="text-[0.82rem] text-[#64748b] mb-1">{company.vendorCategory}</div>
        )}
        <div className="text-[0.78rem] text-[#94a3b8] mb-3">
          {t('pending.hint', 'Your request to join is pending the owner’s approval.')}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold px-[9px] py-[3px] rounded-full bg-[#fef3c7] text-[#92400e]">
            ⏳ {t('pending.badge', 'Awaiting approval')}
          </span>
          <button
            type="button"
            onClick={handleRemind}
            disabled={reminding || cooling}
            title={cooling ? t('pending.remindAgainIn', 'Remind again in {{time}}', { time: formatRemaining(remainingMs) }) : undefined}
            className="text-[0.75rem] font-semibold text-[#0B2A4A] underline decoration-dotted underline-offset-2 disabled:no-underline disabled:text-[#94a3b8] disabled:cursor-not-allowed"
          >
            {reminding
              ? t('pending.reminding', 'Sending…')
              : cooling
                ? t('pending.remindAgainIn', 'Remind again in {{time}}', { time: formatRemaining(remainingMs) })
                : t('pending.remind', 'Send reminder')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-white border-2 border-[rgba(11,42,74,0.12)] rounded-[14px] p-[22px] cursor-pointer transition-[border-color,box-shadow,transform] duration-200 relative min-h-[150px] flex flex-col hover:border-[#0B2A4A] hover:shadow-[0_12px_30px_rgba(11,42,74,0.12)] hover:-translate-y-0.5"
      onClick={() => navigate(`/companies/${company.id}/events`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/companies/${company.id}/events`)}
    >
      <div className="text-[1.05rem] font-bold text-[#0B2A4A] mb-[5px]">{company.name}</div>
      {company.vendorCategory && (
        <div className="text-[0.82rem] text-[#64748b] mb-3">{company.vendorCategory}</div>
      )}
      <div className="mt-auto flex items-center justify-between">
        <span className={`inline-flex items-center text-[0.75rem] font-semibold px-[9px] py-[2px] rounded-full ${company.plan === 'pro' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
          {company.plan === 'pro' ? <><i className="fa-solid fa-bolt" aria-hidden="true" /> Pro</> : 'Starter'}
        </span>
        {(company.members?.length ?? 0) > 1 && (
          <span className="text-[0.78rem] text-[#64748b]">
<i className="fa-solid fa-users" aria-hidden="true" /> {company.members?.length} members
          </span>
        )}
      </div>
    </div>
  );
}

export function CompanyCardSkeleton() {
  return (
    <div
      className="bg-[#e2e8f0] rounded-[14px] min-h-[150px]"
      style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
    />
  );
}

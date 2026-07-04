import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useCompanyJourney } from '../../hooks/useCompanyJourney';
import { NextStepBanner } from '../../components/guidance/NextStepBanner';
import { OnboardingChecklist } from '../../components/guidance/OnboardingChecklist';
import { OnboardingQuestions } from '../../components/guidance/OnboardingQuestions';
import { deriveEventStage, PHASE_LABELS, type EventStage } from '../../lib/eventStage';
import { formatDate } from '../../i18n/format';

const GET_HOME_EVENTS = gql`
  query GetHomeEvents($companyId: ID!) {
    events(companyId: $companyId) {
      id eventName eventDate isFinalized posLocationId
      sales { grossSales netSales }
    }
  }
`;

interface HomeEvent {
  id: string; eventName: string; eventDate: string | null;
  isFinalized: boolean; posLocationId: string | null;
  sales: { grossSales: number | null; netSales: number | null } | null;
}

const PHASE_CHIP: Record<string, string> = {
  plan: 'bg-[#f1f5f9] text-[#64748b]',
  reconcile: 'bg-[#dbeafe] text-[#1d4ed8]',
  finalize: 'bg-[#fef3c7] text-[#92400e]',
  done: 'bg-[#dcfce7] text-[#166534]',
};

export function HomePage() {
  const { t } = useTranslation('home');
  const { companyId, company } = useCurrentCompany();
  const posConnected = !!company?.posStatus?.connected;
  const journey = useCompanyJourney(companyId);

  const questionsSkipKey = `venview_onboarding_q_skipped_${companyId}`;
  const [questionsSkipped, setQuestionsSkipped] = useState(() => localStorage.getItem(questionsSkipKey) === '1');

  const { data } = useQuery(GET_HOME_EVENTS, { variables: { companyId }, skip: !companyId });
  const events: HomeEvent[] = data?.events ?? [];

  const withStage = events.map(e => ({ event: e, stage: deriveEventStage({ ...e, posConnected }) }));
  const activeEvents = withStage.filter(w => w.stage.phase !== 'done');

  // Pick the single most important next action.
  let banner: { eyebrow: string; title: string; description?: string; ctaLabel: string; to: string } | null = null;
  if (!journey.coreComplete && journey.activeSteps.length > 0) {
    const step = journey.activeSteps[0];
    banner = { eyebrow: t('banner.getSetUp', 'Get set up'), title: step.label, description: step.description, ctaLabel: step.ctaLabel, to: step.to };
  } else {
    // Most urgent event: ready-to-finalize first, then needs-reconcile.
    const urgent = activeEvents.find(w => w.stage.phase === 'finalize') ?? activeEvents.find(w => w.stage.phase === 'reconcile');
    if (urgent) {
      banner = {
        eyebrow: t('banner.nextForEvent', 'Next for {{eventName}}', { eventName: urgent.event.eventName }),
        title: urgent.stage.nextStep.label,
        ctaLabel: t('banner.openEvent', 'Open event'),
        to: `/companies/${companyId}/events/${urgent.event.id}`,
      };
    }
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[1.5rem] font-bold text-[#0B2A4A] mt-0 mb-1">{company?.name ?? t('page.defaultTitle', 'Home')}</h1>
        <p className="text-[#64748b] text-[0.9rem] m-0">{t('page.subtitle', "Here's what to focus on next.")}</p>
      </div>

      {banner && <NextStepBanner {...banner} />}

      {companyId && !journey.loading && !journey.answered && !questionsSkipped && (
        <OnboardingQuestions
          companyId={companyId}
          onSaved={() => journey.refetch()}
          onSkip={() => { localStorage.setItem(questionsSkipKey, '1'); setQuestionsSkipped(true); }}
        />
      )}

      {!journey.dismissed && (
        <OnboardingChecklist
          steps={journey.steps}
          doneCount={journey.doneCount}
          total={journey.total}
          coreComplete={journey.coreComplete}
          onSkip={journey.skipStep}
        />
      )}

      {/* Active events needing attention */}
      <div className="bg-white rounded-xl border border-[rgba(11,42,74,0.12)] shadow-[0_4px_12px_rgba(11,42,74,0.08)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f1f5f9]">
          <h3 className="m-0 text-[1.05rem] font-bold text-[#0B2A4A]">{t('events.heading', 'Events in progress')}</h3>
          <Link to={`/companies/${companyId}/events`} className="text-[0.82rem] text-[#0085b0] no-underline font-semibold">{t('events.allEvents', 'All events')} <i className="fa-solid fa-arrow-right" aria-hidden="true" /></Link>
        </div>

        {activeEvents.length === 0 ? (
          <div className="px-5 py-8 text-center text-[#64748b] text-[0.88rem]">
            {events.length === 0
              ? <>{t('events.emptyNoEvents', 'No events yet.')} <Link to={`/companies/${companyId}/events/new`} className="text-[#0B2A4A] font-semibold no-underline">{t('events.createFirst', 'Create your first event')} <i className="fa-solid fa-arrow-right" aria-hidden="true" /></Link></>
              : <>{t('events.allFinalized', 'All events are finalized.')} <i className="fa-solid fa-party-horn" aria-hidden="true" /></>}
          </div>
        ) : (
          <ul className="list-none m-0 p-0">
            {activeEvents.map(({ event, stage }: { event: HomeEvent; stage: EventStage }) => (
              <li key={event.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#f8fafc] last:border-0">
                <div className="min-w-0 flex-1">
                  <Link to={`/companies/${companyId}/events/${event.id}`} className="text-[0.92rem] font-semibold text-[#0B2A4A] no-underline hover:underline">{event.eventName}</Link>
                  <div className="text-[0.78rem] text-[#64748b]">{formatDate(event.eventDate, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </div>
                <span className={`text-[0.72rem] font-semibold px-2.5 py-1 rounded-full ${PHASE_CHIP[stage.phase]}`}>
                  {PHASE_LABELS[stage.phase as keyof typeof PHASE_LABELS] ?? t('events.phaseDone', 'Done')}
                </span>
                <Link to={`/companies/${companyId}/events/${event.id}`} className="btn-secondary shrink-0" style={{ fontSize: '0.78rem', padding: '4px 10px' }}>
                  {stage.nextStep.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

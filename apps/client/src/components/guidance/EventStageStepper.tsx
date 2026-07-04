import { useTranslation } from 'react-i18next';
import { PHASE_LABELS, type EventStage } from '../../lib/eventStage';

const PHASES: Array<keyof typeof PHASE_LABELS> = ['plan', 'reconcile', 'finalize'];

const DESCRIPTION_DEFAULTS: Record<string, string> = {
  plan: 'Event details & venue',
  reconcile: 'Capture sales, labor & costs',
  finalize: 'Review profit & lock it in',
};

// Horizontal Plan → Reconcile → Finalize progress stepper for an event.
export function EventStageStepper({ stage }: { stage: EventStage }) {
  const { t } = useTranslation('onboarding');
  const activeIndex = stage.stepIndex;
  const isDone = stage.phase === 'done';

  return (
    <div className="bg-white rounded-xl border border-[rgba(11,42,74,0.12)] mb-2.5 shadow-[0_4px_12px_rgba(11,42,74,0.08)] px-3 py-3">
      <div className="flex items-stretch">
        {PHASES.map((phase, i) => {
          const complete = isDone || i < activeIndex;
          const active = !isDone && i === activeIndex;
          return (
            <div key={phase} className="flex-1 flex items-center min-w-0">
              <div className="flex flex-col items-center text-center flex-1 min-w-0 px-1">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.8rem] font-bold mb-1 ${
                    complete ? 'bg-[#16a34a] text-white' : active ? 'bg-[#0B2A4A] text-white' : 'bg-[#e2e8f0] text-[#94a3b8]'
                  }`}
                >
                  {complete ? <i className="fa-solid fa-check" aria-hidden="true" /> : i + 1}
                </span>
                <span className={`text-[0.82rem] font-semibold ${active || complete ? 'text-[#0B2A4A]' : 'text-[#94a3b8]'}`}>
                  {PHASE_LABELS[phase]}
                </span>
                <span className="text-[0.7rem] text-[#94a3b8] leading-tight">{t(`stepper.descriptions.${phase}`, DESCRIPTION_DEFAULTS[phase])}</span>
              </div>
              {i < PHASES.length - 1 && (
                <span className={`h-0.5 flex-1 min-w-[12px] -mt-5 ${i < activeIndex || isDone ? 'bg-[#16a34a]' : 'bg-[#e2e8f0]'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

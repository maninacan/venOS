import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { JourneyStep } from '../../hooks/useCompanyJourney';

interface Props {
  steps: JourneyStep[];
  doneCount: number;
  total: number;
  coreComplete: boolean;
  onSkip: (key: string) => void;
}

// Guided-but-skippable setup checklist. Collapses to a small strip once the
// core path (company + first event) is complete.
export function OnboardingChecklist({ steps, doneCount, total, coreComplete, onSkip }: Props) {
  const [collapsed, setCollapsed] = useState(coreComplete);
  const { t } = useTranslation('onboarding');

  // Hide steps the user has explicitly skipped (still counts as not-done).
  const visible = steps.filter(s => !s.skipped);
  const pct = Math.round((doneCount / total) * 100);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full text-left bg-white rounded-xl border border-[rgba(11,42,74,0.12)] px-4 py-3 mb-4 shadow-[0_4px_12px_rgba(11,42,74,0.08)] cursor-pointer flex items-center justify-between hover:bg-[#f8fafc]"
      >
        <span className="text-[0.9rem] font-semibold text-[#0B2A4A]">
          {coreComplete ? <><i className="fa-solid fa-check" aria-hidden="true" /> {t('checklist.setupComplete', 'Setup complete')}</> : t('checklist.gettingStarted', 'Getting started')} · {t('checklist.counter', '{{done}}/{{total}}', { done: doneCount, total })}
        </span>
        <span className="text-[0.78rem] text-[#64748b]">{t('checklist.showSetup', 'Show setup ▾')}</span>
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[rgba(11,42,74,0.12)] mb-4 shadow-[0_4px_12px_rgba(11,42,74,0.08)] overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-[#f1f5f9]">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-[1.05rem] font-bold text-[#0B2A4A]">{t('checklist.gettingStarted', 'Getting started')}</h3>
          <button onClick={() => setCollapsed(true)} className="text-[0.78rem] text-[#64748b] bg-transparent border-0 cursor-pointer">{t('checklist.hide', 'Hide ▴')}</button>
        </div>
        <div className="mt-2 h-2 rounded-full bg-[#e2e8f0] overflow-hidden">
          <div className="h-full bg-[#16a34a] rounded-full transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[0.78rem] text-[#64748b] mt-1">{t('checklist.progress', '{{done}} of {{total}} complete', { done: doneCount, total })}</div>
      </div>

      <ul className="list-none m-0 p-0">
        {visible.map(step => (
          <li key={step.key} className="flex items-center gap-3 px-5 py-3 border-b border-[#f8fafc] last:border-0">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.7rem] font-bold shrink-0 ${step.done ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f1f5f9] text-[#94a3b8]'}`}
            >
              {step.done ? <i className="fa-solid fa-check" aria-hidden="true" /> : ''}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-[0.9rem] font-semibold ${step.done ? 'text-[#94a3b8] line-through' : 'text-[#0B2A4A]'}`}>
                {step.label}{step.optional && !step.done && <span className="ml-2 text-[0.7rem] font-normal text-[#94a3b8]">{t('checklist.optional', 'optional')}</span>}
              </div>
              {!step.done && <div className="text-[0.8rem] text-[#64748b]">{step.description}</div>}
            </div>
            {!step.done && (
              <div className="flex items-center gap-2 shrink-0">
                <Link to={step.to} className="btn-primary" style={{ fontSize: '0.8rem', padding: '4px 12px' }}>{step.ctaLabel}</Link>
                {step.optional && (
                  <button onClick={() => onSkip(step.key)} className="text-[0.78rem] text-[#64748b] bg-transparent border-0 cursor-pointer hover:underline">{t('checklist.skip', 'Skip')}</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

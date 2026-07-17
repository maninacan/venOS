import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LanguageSwitcher } from '../settings/LanguageSwitcher';
import { useLanguage } from '../../i18n/useLanguage';

interface Props {
  /** Submit a join-code access request. Resolves once the request completes. */
  onJoin: (code: string) => Promise<void>;
  joining: boolean;
}

type Step = 'language' | 'paths';

// First-run guide shown on the companies page when the user belongs to no
// companies and has no pending requests. Two steps: pick a language first
// (defaulting to the browser-detected language), then choose to create or join
// a company. Returning users never see this — CompaniesPage renders its grid.
export function GetStartedEmptyState({ onJoin, joining }: Props) {
  const { t } = useTranslation('companies');
  const { current, changeLanguage } = useLanguage();
  const [step, setStep] = useState<Step>('language');
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState('');

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    await onJoin(code.trim().toUpperCase());
    setCode('');
    setShowJoin(false);
  }

  const cardClass =
    'bg-white rounded-xl border border-[rgba(11,42,74,0.12)] shadow-[0_4px_12px_rgba(11,42,74,0.08)]';

  return (
    <div className="max-w-[720px] mx-auto mt-6">
      <div className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#64748b] mb-2">
        {t('getStarted.stepOf', 'Step {{current}} of {{total}}', {
          current: step === 'language' ? 1 : 2,
          total: 2,
        })}
      </div>

      {step === 'language' ? (
        <div className={`${cardClass} p-8 text-center`}>
          <div className="text-[2.4rem] mb-2 text-[#0B2A4A]">
            <i className="fa-solid fa-language" aria-hidden="true" />
          </div>
          <h1 className="text-[1.4rem] font-bold text-[#0B2A4A] mt-0 mb-1.5">
            {t('getStarted.languageHeading', 'Choose your language')}
          </h1>
          <p className="text-[#64748b] text-[0.9rem] mt-0 mb-6">
            {t('getStarted.languageSub', 'You can change this anytime in Settings.')}
          </p>
          <div className="flex justify-center mb-7">
            <LanguageSwitcher variant="settings" />
          </div>
          <button
            type="button"
            className="btn-primary justify-center px-6 py-[11px] text-base"
            onClick={async () => {
              // Persist the detected/selected language to the account even if the
              // user accepted the default without tapping a pill.
              await changeLanguage(current);
              setStep('paths');
            }}
          >
            <span>
              {t('getStarted.continue', 'Continue')}{' '}
              <i className="fa-solid fa-arrow-right text-[0.8rem]" aria-hidden="true" />
            </span>
          </button>
        </div>
      ) : (
        <div>
          <div className="text-center mb-6">
            <h1 className="text-[1.5rem] font-bold text-[#0B2A4A] mt-0 mb-1.5">
              {t('getStarted.heading', 'Welcome to venOS!')}
            </h1>
            <p className="text-[#64748b] text-[0.9rem] m-0">
              {t('getStarted.subheading', "Let's set up your workspace. Choose how you'd like to start:")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Create a company */}
            <div className={`${cardClass} p-6 flex flex-col items-center text-center`}>
              <div className="text-[2rem] mb-3 text-[#0B2A4A]">
                <i className="fa-solid fa-building" aria-hidden="true" />
              </div>
              <h2 className="text-[1.05rem] font-bold text-[#0B2A4A] mt-0 mb-1.5">
                {t('getStarted.createTitle', 'Create a company')}
              </h2>
              <p className="text-[#64748b] text-[0.85rem] mt-0 mb-5 grow">
                {t('getStarted.createDesc', 'Start fresh as the owner — set up events, recipes, inventory, and connect your POS.')}
              </p>
              <Link
                to="/companies/new"
                className="bg-[#00ABE2] hover:bg-[#0085b0] text-white no-underline font-semibold rounded-full px-5 py-2.5 text-[0.9rem] inline-flex items-center gap-2 transition-colors"
              >
                {t('getStarted.createCta', 'Create company')}{' '}
                <i className="fa-solid fa-arrow-right text-[0.8rem]" aria-hidden="true" />
              </Link>
            </div>

            {/* Join a company */}
            <div className={`${cardClass} p-6 flex flex-col items-center text-center`}>
              <div className="text-[2rem] mb-3 text-[#0B2A4A]">
                <i className="fa-solid fa-link" aria-hidden="true" />
              </div>
              <h2 className="text-[1.05rem] font-bold text-[#0B2A4A] mt-0 mb-1.5">
                {t('getStarted.joinTitle', 'Join a company')}
              </h2>
              <p className="text-[#64748b] text-[0.85rem] mt-0 mb-5 grow">
                {t('getStarted.joinDesc', 'Have a join code from your team? Request access and an owner will approve you.')}
              </p>
              {!showJoin ? (
                <button
                  type="button"
                  className="btn-secondary rounded-full px-5 py-2.5 text-[0.9rem]"
                  onClick={() => setShowJoin(true)}
                >
                  {t('getStarted.joinCta', 'Enter join code')}{' '}
                  <i className="fa-solid fa-arrow-right text-[0.8rem]" aria-hidden="true" />
                </button>
              ) : (
                <form onSubmit={handleJoin} className="flex flex-col gap-2 items-stretch w-full">
                  <input
                    type="text"
                    placeholder={t('joinCodePlaceholder', 'Enter join code (e.g. ABC123)')}
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    autoFocus
                  />
                  <button type="submit" className="btn-primary justify-center" disabled={joining}>
                    {joining && <span className="spinner" />}{' '}
                    <span>{t('getStarted.joinSubmit', 'Request access')}</span>
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="text-center mt-6">
            <button
              type="button"
              className="text-[#64748b] text-[0.85rem] bg-transparent border-0 cursor-pointer hover:underline"
              onClick={() => { setStep('language'); setShowJoin(false); }}
            >
              <i className="fa-solid fa-arrow-left text-[0.75rem]" aria-hidden="true" />{' '}
              {t('getStarted.back', 'Back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

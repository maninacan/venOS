import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  companyId: string;
  onClose: () => void;
}

export function WelcomeModal({ companyId, onClose }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation('modals');

  function goCreateEvent() {
    onClose();
    navigate(`/companies/${companyId}/events/new`);
  }

  function goManageEvents() {
    onClose();
    navigate(`/companies/${companyId}/events`);
  }

  const stepNum = 'w-7 h-7 bg-[#0B2A4A] text-white rounded-full flex items-center justify-center font-bold text-[0.85rem] mb-2';

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-[20px] w-full max-w-[640px] max-h-[90vh] overflow-y-auto">
        <div className="px-8 pb-[18px] pt-7 text-center">
          <div className="inline-block bg-[#fef3c7] text-[#92400e] text-[0.75rem] font-bold px-2.5 py-[3px] rounded-full mb-2.5"><i className="fa-solid fa-flask" aria-hidden="true" /> {t('welcome.beta', 'Beta')}</div>
          <h2 className="text-[#0B2A4A] mt-0 mb-1.5 text-[1.4rem]">{t('welcome.title', 'Welcome to venOS!')}</h2>
          <p className="text-[#64748b] text-[0.88rem] mt-0 mb-2">{t('welcome.intro', "You're helping us build the simplest way for event vendors to know if they actually made money.")}</p>
          <p className="text-[0.84rem] mt-0 mb-1.5">{t('welcome.focusPrefix', 'This beta version is focused on one thing:')}<br /><strong>{t('welcome.focusHighlight', 'Getting you from event → to true profit in minutes.')}</strong></p>
        </div>

        <div className="px-8 pb-6">
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-3.5">{t('welcome.stepsHeading', 'Get started in 3 steps')}</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3.5 mb-5">
            <div className="bg-[#f8fafc] rounded-xl p-4">
              <div className={stepNum}>1</div>
              <h3 className="mt-0 mb-1.5 text-[0.93rem] font-bold">{t('welcome.step1.title', 'Add a Real Event')}</h3>
              <p className="mt-0 mb-2.5 text-[0.83rem] text-[#64748b]">{t('welcome.step1.description', 'Use a past event from the last 30 days.')}</p>
              <ul className="mt-0 mb-2.5 text-[0.83rem] text-[#64748b] pl-4">
                <li>{t('welcome.step1.example1', 'Farmers Market')}</li>
                <li>{t('welcome.step1.example2', 'Catering job')}</li>
                <li>{t('welcome.step1.example3', 'School event')}</li>
                <li>{t('welcome.step1.example4', 'Festival')}</li>
              </ul>
              <button className="btn-primary w-full justify-center text-[0.82rem] py-[7px] mt-1" onClick={goCreateEvent}>{t('welcome.step1.cta', 'Create Your First Event')}</button>
            </div>

            <div className="bg-[#f8fafc] rounded-xl p-4">
              <div className={stepNum}>2</div>
              <h3 className="mt-0 mb-1.5 text-[0.93rem] font-bold">{t('welcome.step2.title', 'Connect & Sync Sales')}</h3>
              <p className="mt-0 mb-2.5 text-[0.83rem] text-[#64748b]">{t('welcome.step2.description', 'If you use Square, connect it in Settings. venOS will pull your real sales and tax data automatically.')}</p>
              <p className="mt-0 mb-2.5 text-[0.83rem] text-[#64748b]">{t('welcome.step2.descriptionAlt', 'If not, enter totals manually.')}</p>
              <button className="btn-secondary w-full justify-center text-[0.82rem] py-[7px] mt-1" onClick={goManageEvents}>{t('welcome.step2.cta', 'Sync Sales')}</button>
            </div>

            <div className="bg-[#f8fafc] rounded-xl p-4">
              <div className={stepNum}>3</div>
              <h3 className="mt-0 mb-1.5 text-[0.93rem] font-bold">{t('welcome.step3.title', 'Add Your Costs')}</h3>
              <p className="mt-0 mb-2.5 text-[0.83rem] text-[#64748b]">{t('welcome.step3.description', 'Enter labor, supplies, event fees, and food tax. Then open your Profit Summary.')}</p>
              <button className="btn-secondary w-full justify-center text-[0.82rem] py-[7px] mt-1" onClick={goManageEvents}>{t('welcome.step3.cta', 'View Profit Summary')}</button>
            </div>
          </div>

          <div className="bg-[#f8fafc] rounded-[10px] p-[14px_16px] mb-4">
            <h3 className="mt-0 mb-2 text-[0.95rem]">{t('welcome.discover.heading', "What You'll Discover")}</h3>
            <ul className="m-0 pl-[18px] text-[0.86rem] leading-[1.8] text-[#222]">
              <li><i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('welcome.discover.item1', 'Your true net profit (after tax + fees)')}</li>
              <li><i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('welcome.discover.item2', 'Your real labor cost impact')}</li>
              <li><i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('welcome.discover.item3', 'Whether the event was worth it')}</li>
              <li><i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('welcome.discover.item4', 'Where you lost margin')}</li>
            </ul>
          </div>

          <p className="text-[0.78rem] text-[#64748b] m-0">
            {t('welcome.disclaimer', 'This is a beta version. Please report bugs. Financial calculations are based on the data entered or synced. If something looks incorrect, tell us.')}
          </p>
        </div>

        <div className="px-8 pb-7 flex flex-col gap-2">
          <button
            className="block w-full py-3 rounded-[10px] text-[0.93rem] font-bold cursor-pointer border-0 font-[inherit] bg-[#0B2A4A] text-white hover:bg-[#0A3A67]"
            style={{ transition: 'background 0.15s' }}
            onClick={goCreateEvent}
          >
            <i className="fa-solid fa-rocket" aria-hidden="true" /> {t('welcome.ctaPrimary', "Let's Go — Create My First Event")}
          </button>
          <button
            className="block w-full py-3 rounded-[10px] text-[0.83rem] font-medium cursor-pointer border-0 font-[inherit] bg-transparent text-[#64748b]"
            onClick={onClose}
          >
            {t('welcome.ctaExplore', "I'll explore on my own")}
          </button>
        </div>
      </div>
    </div>
  );
}

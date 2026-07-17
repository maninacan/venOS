import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Shown only when a page was reached from the getting-started checklist
// (links carry ?setup=1). Lets the user jump back to the home checklist to
// continue setup after adding items — used on the iterative pages (recipes,
// inventory, team) where we don't auto-redirect.
export function BackToSetupButton() {
  const [searchParams] = useSearchParams();
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('onboarding');

  if (searchParams.get('setup') !== '1' || !companyId) return null;

  return (
    <button
      onClick={() => navigate(`/companies/${companyId}`)}
      className="w-full text-left bg-white rounded-xl border border-[rgba(11,42,74,0.12)] px-4 py-3 mb-4 shadow-[0_4px_12px_rgba(11,42,74,0.08)] cursor-pointer flex items-center gap-2 text-[0.9rem] font-semibold text-[#0B2A4A] hover:bg-[#f8fafc]"
    >
      <i className="fa-solid fa-arrow-left text-[#00ABE2]" />
      {t('backToSetup', 'Back to setup checklist')}
    </button>
  );
}

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
  ctaLabel: string;
  /** Either a route to link to, or a click handler. */
  to?: string;
  onClick?: () => void;
  onDismiss?: () => void;
}

// Prominent "what to do next" card. Reused on the Home page and Event Dashboard.
export function NextStepBanner({ eyebrow, title, description, ctaLabel, to, onClick, onDismiss }: Props) {
  const { t } = useTranslation('onboarding');
  return (
    <div className="relative bg-gradient-to-br from-[#0B2A4A] to-[#0A3A67] text-white rounded-xl px-5 py-4 mb-4 shadow-[0_4px_12px_rgba(11,42,74,0.18)]">
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label={t('banner.dismiss', 'Dismiss')}
          className="absolute top-2.5 right-3 text-[rgba(255,255,255,0.6)] hover:text-white bg-transparent border-0 cursor-pointer text-[0.95rem]"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {eyebrow && <div className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#FFD84D] mb-1">{eyebrow}</div>}
          <div className="text-[1.05rem] font-bold leading-snug">{title}</div>
          {description && <div className="text-[0.85rem] text-[rgba(255,255,255,0.8)] mt-0.5">{description}</div>}
        </div>
        {to ? (
          <Link
            to={to}
            className="shrink-0 bg-[#00ABE2] hover:bg-[#0085b0] text-white no-underline font-semibold rounded-full px-5 py-2.5 text-[0.9rem] inline-flex items-center gap-2 transition-colors"
          >
            {ctaLabel} <i className="fa-solid fa-arrow-right text-[0.8rem]" />
          </Link>
        ) : (
          <button
            onClick={onClick}
            className="shrink-0 bg-[#00ABE2] hover:bg-[#0085b0] text-white border-0 cursor-pointer font-semibold rounded-full px-5 py-2.5 text-[0.9rem] inline-flex items-center gap-2 transition-colors"
          >
            {ctaLabel} <i className="fa-solid fa-arrow-right text-[0.8rem]" />
          </button>
        )}
      </div>
    </div>
  );
}

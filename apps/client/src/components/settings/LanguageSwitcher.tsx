import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../i18n/useLanguage';

/**
 * Language selector. `variant="menu"` renders a compact inline control;
 * `variant="settings"` renders labeled buttons for a settings card.
 */
export function LanguageSwitcher({ variant = 'settings' }: { variant?: 'menu' | 'settings' }) {
  const { t } = useTranslation('settings');
  const { current, changeLanguage, languages } = useLanguage();

  if (variant === 'menu') {
    return (
      <select
        aria-label={t('language.label', 'Language')}
        value={current}
        onChange={e => changeLanguage(e.target.value)}
        className="w-auto text-sm rounded-md border border-gray-300 bg-white px-2 py-1"
      >
        {languages.map(l => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    );
  }

  return (
    <div role="radiogroup" aria-label={t('language.label', 'Language')} className="flex gap-2 flex-wrap">
      {languages.map(l => {
        const active = current === l.code;
        return (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => changeLanguage(l.code)}
            className={`px-3 py-1.5 rounded-lg text-[0.86rem] font-medium border transition-colors ${
              active
                ? 'bg-[#0B2A4A] text-white border-[#0B2A4A]'
                : 'bg-white text-[#0B2A4A] border-[rgba(11,42,74,0.2)] hover:bg-[#f1f5f9]'
            }`}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

/**
 * Translation resources are split into per-feature namespace files under
 * `locales/<lng>/<namespace>.json`. They are bundled synchronously (two
 * languages, single SPA) so `i18n.t()` works immediately — including from
 * non-React modules (toasts, PDF/CSV builders) — with no Suspense flicker.
 *
 * Adding a new namespace file is zero-config: drop `locales/en/foo.json` and
 * `locales/es/foo.json` and it is picked up here automatically.
 */
const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lng, ns] = match;
  resources[lng] ??= {};
  resources[lng][ns] = mod.default;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', label: 'English', base: 'en' },
  { code: 'es-MX', label: 'Español', base: 'es' },
  { code: 'pt-BR', label: 'Português', base: 'pt' },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'pt'],
    // en-US / es-MX resolve to the en / es resource bundles, while
    // i18n.language keeps the full region tag that drives Intl formatting.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'venos.lang',
      caches: ['localStorage'],
    },
    react: { useSuspense: false },
  });

export default i18n;

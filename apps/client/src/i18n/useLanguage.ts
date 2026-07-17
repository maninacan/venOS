import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, useAuth } from '@org/data';
import { SUPPORTED_LANGUAGES } from './index';

/** Normalize any i18n.language value to one of our supported region tags. */
export function toSupportedCode(lng: string | undefined | null): string {
  const base = (lng ?? 'en').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.find(l => l.base === base)?.code ?? 'en-US';
}

/**
 * Language preference wiring.
 *
 * Precedence on boot: the signed-in user's `user_metadata.lang` (account-synced)
 * wins over the localStorage/browser value chosen by the detector. Changing the
 * language updates i18next (which caches to localStorage) and persists to the
 * account so it follows the user across devices.
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  const { user } = useAuth();

  // Seed from the account once the user is known, if it differs from the
  // detector's choice.
  useEffect(() => {
    const accountLang = user?.user_metadata?.['lang'] as string | undefined;
    if (accountLang && toSupportedCode(accountLang) !== toSupportedCode(i18n.language)) {
      i18n.changeLanguage(accountLang);
    }
  }, [user, i18n]);

  const current = toSupportedCode(i18n.language);

  const changeLanguage = useCallback(
    async (code: string) => {
      await i18n.changeLanguage(code);
      // Persist to the account (no-op if signed out). Same pattern as ProfilePage.
      if (user) {
        await supabase.auth.updateUser({ data: { lang: code } });
      }
    },
    [i18n, user]
  );

  return { current, changeLanguage, languages: SUPPORTED_LANGUAGES };
}

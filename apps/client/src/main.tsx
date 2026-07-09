import i18n from './i18n'; // FIRST — initializes the i18next singleton before render
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { PostHogProvider } from '@posthog/react';
import App from './app/app';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { showToast } from '@org/data';

window.addEventListener('unhandledrejection', (event) => {
  console.error('[UnhandledRejection]', event.reason);
  showToast(i18n.t('toast:unexpectedError', 'An unexpected error occurred.'), 'error');
});

const posthogOptions = {
  api_host: import.meta.env['VITE_POSTHOG_HOST'] || 'https://us.i.posthog.com',
  defaults: '2026-05-30',
} as const;

// Only enable PostHog when a project token is configured (i.e. prod). In dev the
// token is unset, so we skip the provider entirely — no analytics and no
// "You must initialize it manually" warning.
const posthogKey = import.meta.env['VITE_POSTHOG_PROJECT_TOKEN'];

const app = (
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    {posthogKey
      ? <PostHogProvider apiKey={posthogKey} options={posthogOptions}>{app}</PostHogProvider>
      : app}
  </StrictMode>,
);

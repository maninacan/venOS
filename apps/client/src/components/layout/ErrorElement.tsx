import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function ErrorElement() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useTranslation('nav');

  console.error('[RouteError]', error);

  const message = isRouteErrorResponse(error)
    ? t('error.statusMessage', '{{status}} — {{statusText}}', { status: error.status, statusText: error.statusText })
    : error instanceof Error
      ? error.message
      : t('error.generic', 'An unexpected error occurred.');

  return (
    <div className="card max-w-[560px] mx-auto mt-10 text-center">
      <div className="text-[2.5rem] mb-3"><i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /></div>
      <h2 className="text-[#0B2A4A] mt-0 mb-2">{t('error.title', 'Something went wrong')}</h2>
      <p className="text-[#64748b] text-[0.9rem] mt-0 mb-5 leading-relaxed">{message}</p>
      <div className="flex gap-2.5 justify-center">
        <button className="btn-primary" onClick={() => window.location.reload()}>{t('error.tryAgain', 'Try Again')}</button>
        <button className="btn-secondary" onClick={() => navigate(-1)}><i className="fa-solid fa-arrow-left" aria-hidden="true" /> {t('error.goBack', 'Go Back')}</button>
      </div>
    </div>
  );
}

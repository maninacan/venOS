import { useTranslation } from 'react-i18next';

/** Translated labels to pass to a Table/Pagination `pagination.labels` prop. */
export function usePaginationLabels() {
  const { t } = useTranslation('common');
  return {
    showing: t('pagination.showing', 'Showing'),
    to: t('pagination.to', 'to'),
    of: t('pagination.of', 'of'),
    results: t('pagination.results', 'results'),
    perPage: t('pagination.perPage', '/ page'),
    previous: t('previous', 'Previous'),
    next: t('next', 'Next'),
  };
}

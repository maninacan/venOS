import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation, Trans } from 'react-i18next';
import { formatDate } from '../../i18n/format';

const GET_ALERTS = gql`
  query GetInventoryAlerts($companyId: ID!) {
    inventoryAlerts(companyId: $companyId) {
      id isRead triggeredAt
      item { id name }
    }
  }
`;

const MARK_ALL_READ = gql`
  mutation MarkAllAlertsRead($companyId: ID!) {
    markAllAlertsRead(companyId: $companyId)
  }
`;

interface Props {
  companyId: string;
}

export function AlertsBell({ companyId }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('nav');

  const { data, refetch } = useQuery(GET_ALERTS, {
    variables: { companyId },
    pollInterval: 60000,
  });

  const [markAll] = useMutation(MARK_ALL_READ, {
    variables: { companyId },
    onCompleted: () => refetch(),
  });

  const alerts = data?.inventoryAlerts ?? [];
  const unread = alerts.filter((a: { isRead: boolean }) => !a.isRead).length;

  return (
    <>
      <button
        className="relative bg-transparent border-0 text-[#555] text-[1.1rem] cursor-pointer px-2.5 py-1.5 rounded-md ml-1 transition-colors hover:bg-[rgba(11,42,74,0.06)]"
        onClick={() => setOpen(o => !o)}
        aria-label={t('alerts.label', 'Reorder alerts')}
      >
        <i className="fa-solid fa-bell" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-[#dc2626] text-white text-[0.62rem] font-bold min-w-[15px] h-[15px] rounded-full flex items-center justify-center px-[3px]">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[199]" onClick={() => setOpen(false)} />
          <div className="fixed top-16 right-4 bg-white border border-[rgba(11,42,74,0.12)] rounded-xl w-[300px] max-h-[380px] overflow-y-auto z-[200] shadow-[0_12px_30px_rgba(11,42,74,0.12)]">
            <div className="flex items-center px-3.5 py-3 border-b border-[#dde3f0] gap-2 text-[0.88rem] font-semibold">
              <strong>{t('alerts.title', 'Reorder Alerts')}</strong>
              <button className="ml-auto bg-transparent border-0 text-[#0B2A4A] text-[0.78rem] cursor-pointer" onClick={() => markAll()}>{t('alerts.markAllRead', 'Mark all read')}</button>
              <button className="bg-transparent border-0 text-[#64748b] cursor-pointer text-[0.95rem]" onClick={() => setOpen(false)} aria-label={t('alerts.close', 'Close')}><i className="fa-solid fa-xmark" /></button>
            </div>
            {alerts.length === 0 ? (
              <p className="px-3.5 py-4 text-[#64748b] text-[0.84rem]">{t('alerts.empty', 'No reorder alerts.')}</p>
            ) : (
              alerts.map((a: { id: string; isRead: boolean; item: { name: string }; triggeredAt: string }) => (
                <div
                  key={a.id}
                  className={`px-3.5 py-2.5 border-b border-[#f1f5f9] text-[0.84rem] ${a.isRead ? 'opacity-50' : ''}`}
                >
                  <Trans i18nKey="alerts.lowStock" ns="nav" values={{ name: a.item.name }} defaults="<0>{{name}}</0> is low on stock">
                    <strong>{a.item.name}</strong> is low on stock
                  </Trans>
                  <div className="text-[0.75rem] text-[#64748b] mt-0.5">
                    {formatDate(a.triggeredAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

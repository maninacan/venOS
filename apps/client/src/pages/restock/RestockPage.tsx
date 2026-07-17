import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { showToast } from '@org/data';
import { formatDate } from '../../i18n/format';

const GET_EVENTS = gql`
  query GetEventsForRestock($companyId: ID!) {
    events(companyId: $companyId) { id eventName eventDate }
  }
`;
const GET_EVENT_INVENTORY = gql`
  query GetEventInventory($eventId: ID!) {
    eventInventory(eventId: $eventId) {
      id quantityLoaded quantitySold quantityRemaining
      item { id name unitCost }
    }
  }
`;
const RESTOCK = gql`
  mutation Restock($eventId: ID!, $eventInventoryId: ID!, $quantity: Float!) {
    restockEventInventory(eventId: $eventId, eventInventoryId: $eventInventoryId, quantity: $quantity) {
      id quantityLoaded quantitySold quantityRemaining item { name }
    }
  }
`;

interface EventInventoryItem {
  id: string;
  quantityLoaded: number;
  quantitySold: number;
  quantityRemaining: number;
  item: { id: string; name: string; unitCost: number };
}

export function RestockPage() {
  const { t } = useTranslation('restock');
  const { companyId } = useCurrentCompany();
  const [selectedEventId, setSelectedEventId] = useState('');
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState<Record<string, string>>({});

  const { data: eventsData } = useQuery(GET_EVENTS, { variables: { companyId }, skip: !companyId });
  const { data: inventoryData, loading, refetch } = useQuery(GET_EVENT_INVENTORY, {
    variables: { eventId: selectedEventId },
    skip: !selectedEventId,
  });
  const [restockItem] = useMutation(RESTOCK);

  const events = eventsData?.events ?? [];
  const eventInventory: EventInventoryItem[] = inventoryData?.eventInventory ?? [];
  const lowItems = eventInventory.filter(i => i.quantityRemaining < i.quantityLoaded * 0.25);

  async function handleRestock(item: EventInventoryItem) {
    const qty = parseFloat(restockQty[item.id] ?? String(Math.max(0, item.quantityLoaded - item.quantityRemaining)));
    if (!qty || qty <= 0) { showToast(t('toast.invalidQty', 'Enter a valid restock quantity'), 'error'); return; }
    setRestockingId(item.id);
    try {
      await restockItem({ variables: { eventId: selectedEventId, eventInventoryId: item.id, quantity: qty } });
      showToast(t('toast.restocked', 'Restocked {{qty}} units of {{name}}', { qty, name: item.item.name }), 'success');
      setRestockQty(prev => { const n = { ...prev }; delete n[item.id]; return n; });
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.restockFailed', 'Failed to restock'), 'error');
    } finally { setRestockingId(null); }
  }

  return (
    <>
      <div className="card">
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: '0 0 4px', color: 'var(--vv-navy)' }}><i className="fa-solid fa-arrows-rotate" /> {t('heading', 'Restock List')}</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem' }}>
            {t('subtitle', 'Pick an event, then mark items restocked after refilling. Restocking adds quantity back to your warehouse stock.')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>{t('event', 'Event')}</label>
            <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
              <option value="">{t('selectEvent', 'Select an event…')}</option>
              {events.map((e: { id: string; eventName: string; eventDate?: string }) => (
                <option key={e.id} value={e.id}>{e.eventName}{e.eventDate ? ` (${formatDate(e.eventDate)})` : ''}</option>
              ))}
            </select>
          </div>
          {selectedEventId && (
            <button className="btn-secondary" onClick={() => refetch()} style={{ marginTop: 20 }}><i className="fa-solid fa-arrows-rotate" aria-hidden="true" /> {t('refresh', 'Refresh')}</button>
          )}
          {selectedEventId && eventInventory.length > 0 && (
            <span style={{ marginTop: 20, fontSize: '0.82rem', color: lowItems.length > 0 ? '#92400e' : 'var(--muted)' }}>
              {lowItems.length > 0
                ? <><i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {t('lowWarning', '{{count}} items running low', { count: lowItems.length })}</>
                : t('itemsTracked', '{{count}} items tracked', { count: eventInventory.length })}
            </span>
          )}
        </div>

        {!selectedEventId && (
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', padding: '16px 0' }}>{t('selectPrompt', 'Select an event above to see its restock list.')}</p>
        )}

        {selectedEventId && loading && (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <span className="spinner spinner-dark" style={{ width: 22, height: 22, borderWidth: 2 }} />
          </div>
        )}

        {selectedEventId && !loading && eventInventory.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', padding: '16px 0' }}>
            {t('noInventory', 'No truck inventory loaded for this event. Add inventory from the Event Dashboard.')}
          </p>
        )}

        {eventInventory.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {eventInventory.map(item => {
              const pctRemaining = item.quantityLoaded > 0 ? item.quantityRemaining / item.quantityLoaded : 1;
              const isLow = pctRemaining < 0.25;
              const suggestedRestock = Math.max(0, item.quantityLoaded - item.quantityRemaining);

              return (
                <div
                  key={item.id}
                  style={{
                    background: isLow ? '#fffbeb' : '#f8fafc',
                    border: `1px solid ${isLow ? '#fde68a' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.item.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
                      {t('loaded', 'Loaded')}: {item.quantityLoaded} · {t('sold', 'Sold')}: {item.quantitySold} · {t('remaining', 'Remaining')}: <strong style={{ color: isLow ? '#92400e' : undefined }}>{item.quantityRemaining.toFixed(2)}</strong>
                    </div>
                    {/* Stock bar */}
                    <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, marginTop: 6, width: 120 }}>
                      <div style={{ height: '100%', width: `${Math.min(100, pctRemaining * 100)}%`, background: isLow ? '#f59e0b' : '#19B37A', borderRadius: 2 }} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', marginBottom: 2 }}>{t('restockQty', 'Restock qty')}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={restockQty[item.id] ?? suggestedRestock}
                        onChange={e => setRestockQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                        style={{ width: 80, textAlign: 'right' }}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      style={{ fontSize: '0.82rem', padding: '7px 14px', marginTop: 18 }}
                      disabled={restockingId === item.id}
                      onClick={() => handleRestock(item)}
                    >
                      {restockingId === item.id && <span className="spinner" />}
                      <span><i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('markRestocked', 'Mark Restocked')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useCurrency } from '../../i18n/useCurrency';
import { formatDate } from '../../i18n/format';
import { ProfitSummaryCard } from '../../components/dashboard/ProfitSummaryCard';
import { EventStageStepper } from '../../components/guidance/EventStageStepper';
import { NextStepBanner } from '../../components/guidance/NextStepBanner';
import { deriveEventStage, deriveEventTiming, hasSales, PHASE_LABELS } from '../../lib/eventStage';
import { showToast } from '@org/data';

const GET_REPORT = gql`
  query GetEventReport($id: ID!) {
    eventReport(id: $id) {
      event {
        id eventName eventDate endDate numDays isFinalized finalizedDate
        posLocationId status eventType eventHost eventLocation
        coordinator time eventRating applicationDate notes
      }
      sales {
        grossSales netSales discounts refunds squareFees tips
        taxRate stateTaxRate localTaxRate taxOverride totalCollected
      }
      expenses {
        healthDeptFee eventFee mileage mileageRate coordinatorFee
        posFee employeeBonus eventRunnerFees laborFees additionalFees
      }
      taxes { stateRate localRate combinedRate stateTax localTax taxCollected jurisdiction }
      summary {
        posFees cogs grossProfit totalExpenses netProfit
        tips stateFoodTax laborFees additionalFeesTotal mileageReimbursement
      }
      inventorySales { name quantitySold unitPrice totalCost }
      laborEntries { id employeeId name hours wage total }
      supplies { id name quantity unitCost total }
      additionalFees { id label amount isDiscount }
    }
  }
`;

const DUPLICATE_EVENT = gql`
  mutation DuplicateEvent($id: ID!) { duplicateEvent(id: $id) { id } }
`;
const DELETE_EVENT = gql`
  mutation DeleteEvent($id: ID!) { deleteEvent(id: $id) }
`;

// Which POS providers support labor sync (mirrors the server registry
// capabilities). Shopify is sales-only; Square and Toast also do labor.
const POS_HAS_LABOR: Record<string, boolean> = { square: true, toast: true, shopify: false };
function providerHasLabor(provider?: string | null) {
  return provider ? POS_HAS_LABOR[provider] ?? false : false;
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
function shortDate(d: string | null | undefined) {
  return d ? formatDate(d, SHORT_DATE) : '—';
}
function formatDateRange(start: string | null | undefined, numDays: number | null | undefined, t: TFunction) {
  if (!start) return '';
  const s = shortDate(start);
  if (!numDays || numDays <= 1) return s;
  const end = new Date(start + 'T00:00:00');
  end.setDate(end.getDate() + numDays - 1);
  return t('dashboard.dateRange', '{{start}} – {{end}}', { start: s, end: formatDate(end, SHORT_DATE) });
}

export function EventDashboardPage() {
  const { t } = useTranslation('events');
  const { fmt } = useCurrency();
  const { eventId } = useParams<{ eventId: string }>();
  const { companyId, company } = useCurrentCompany();
  const navigate = useNavigate();

  const { data, loading, error, refetch } = useQuery(GET_REPORT, {
    variables: { id: eventId },
    skip: !eventId,
  });

  const [deleteEvent] = useMutation(DELETE_EVENT);
  const [duplicateEvent, { loading: duplicating }] = useMutation(DUPLICATE_EVENT);
  const [syncSalesMut] = useMutation(gql`mutation AutoSyncSales($eventId: ID!) { syncSales(eventId: $eventId) { success } }`);
  const [syncLaborMut] = useMutation(gql`mutation AutoSyncLabor($eventId: ID!) { syncLabor(eventId: $eventId) { success } }`);
  const [activeTab, setActiveTab] = useState(0);
  const [autoPulling, setAutoPulling] = useState(false);
  const [forceShowData, setForceShowData] = useState(false);
  const autoPulledRef = useRef(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const finalizeRef = useRef<HTMLDivElement>(null);

  const report = data?.eventReport;
  const event = report?.event;
  const sales = report?.sales ?? {};
  const expenses = report?.expenses ?? {};
  const summary = report?.summary ?? {};
  const taxes = report?.taxes ?? {};
  const inventorySales = report?.inventorySales ?? [];
  const laborEntries = report?.laborEntries ?? [];
  const supplies = report?.supplies ?? [];
  const additionalFees = report?.additionalFees ?? [];

  // Opening a PAST event with a POS connected + no sales yet → auto-pull sales
  // (and labor, if the provider supports it) once. Guarded so it never re-pulls
  // or clobbers entered data.
  useEffect(() => {
    if (autoPulledRef.current || !event || !eventId) return;
    const isPast = deriveEventTiming(event) === 'past';
    const canPull = !!company?.posStatus?.connected && !!event.posLocationId;
    if (isPast && canPull && !hasSales(sales)) {
      autoPulledRef.current = true;
      setAutoPulling(true);
      const pulls = [syncSalesMut({ variables: { eventId } })];
      if (providerHasLabor(company?.posStatus?.provider)) {
        pulls.push(syncLaborMut({ variables: { eventId } }));
      }
      Promise.allSettled(pulls).then(() => refetch()).finally(() => setAutoPulling(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, company?.posStatus?.connected, eventId]);

  async function handleDelete() {
    if (!confirm(t('dashboard.deleteConfirm', 'Delete "{{name}}"? This cannot be undone.', { name: event?.eventName }))) return;
    try {
      await deleteEvent({ variables: { id: eventId } });
      showToast(t('toast.eventDeleted', 'Event deleted'), 'info');
      navigate(`/companies/${companyId}/events`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.deleteFailed', 'Failed to delete'), 'error');
    }
  }

  async function handleDuplicate() {
    try {
      const { data } = await duplicateEvent({ variables: { id: eventId } });
      const newId = data?.duplicateEvent?.id;
      showToast(t('toast.duplicated', 'Duplicated as a new event!'), 'success');
      navigate(`/companies/${companyId}/events/${newId}/edit`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.duplicateFailed', 'Failed to duplicate event'), 'error');
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <span className="spinner spinner-dark" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="inline-error">
        <span>⚠️</span>
        <span>{t('dashboard.loadError', 'Could not load event.')} {error?.message}</span>
        <button className="inline-error-retry" onClick={() => refetch()}>{t('dashboard.retry', 'Retry')}</button>
      </div>
    );
  }

  // Meta chips
  const metaFields = [
    { label: t('dashboard.meta.type', 'Type'), value: event?.eventType },
    { label: t('dashboard.meta.host', 'Host'), value: event?.eventHost },
    { label: t('dashboard.meta.coordinator', 'Coordinator'), value: event?.coordinator },
    { label: t('dashboard.meta.location', 'Location'), value: event?.eventLocation },
    { label: t('dashboard.meta.status', 'Status'), value: event?.status },
    { label: t('dashboard.meta.time', 'Time'), value: event?.time },
    { label: t('dashboard.meta.rating', 'Rating'), value: event?.eventRating },
    { label: t('dashboard.meta.applied', 'Applied'), value: event?.applicationDate ? shortDate(event.applicationDate) : null },
    { label: t('dashboard.meta.notes', 'Notes'), value: event?.notes },
  ].filter(f => f.value);

  // Event-data tabs (Inventory Sales → Ingredient Costs)
  const tabs: Array<{ title: string; headerRight?: ReactNode; content: ReactNode }> = [
    {
      title: t('dashboard.tabs.inventorySales', 'Inventory Sales'),
      content: inventorySales.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.86rem', margin: 0 }}>{t('dashboard.noInventorySales', 'No Inventory Sales recorded. Pull sales to populate.')}</p>
      ) : (
        <div className="table-container">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
            <thead><tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>{t('dashboard.invItem', 'Item')}</th>
              <th style={{ padding: '6px 8px' }}>{t('dashboard.invQtySold', 'Qty Sold')}</th>
              <th style={{ padding: '6px 8px' }}>{t('dashboard.invUnitCost', 'Unit Cost')}</th>
              <th style={{ padding: '6px 8px' }}>{t('dashboard.invTotalCogs', 'Total COGS')}</th>
            </tr></thead>
            <tbody>
              {inventorySales.map((r: Record<string, unknown>, i: number) => (
                <tr key={i}>
                  <td style={{ padding: '6px 8px' }}>{r['name'] as string}</td>
                  <td style={{ padding: '6px 8px' }}>{Number(r['quantitySold'])}</td>
                  <td style={{ padding: '6px 8px' }}>{r['unitPrice'] != null ? fmt(r['unitPrice'] as number) : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{fmt(r['totalCost'] as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      title: t('dashboard.tabs.truckInventory', 'Truck Inventory'),
      content: <p style={{ color: 'var(--muted)', fontSize: '0.86rem', margin: 0 }}>{t('dashboard.truckInventoryComing', 'Truck inventory tracking coming in Phase 5.')}</p>,
    },
    {
      title: t('dashboard.tabs.manualSalesEntry', 'Manual Sales Entry'),
      content: <ManualSalesForm eventId={eventId!} sales={sales} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.discounts', 'Discounts'),
      content: <AdjustmentForm eventId={eventId!} field="discounts" label={t('dashboard.discountsLabel', 'Discounts')} currentValue={Number(sales.discounts ?? 0)} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.labor', 'Labor'),
      headerRight: company?.posStatus?.connected && providerHasLabor(company?.posStatus?.provider)
        ? <SyncLaborButton eventId={eventId!} posLocationId={event?.posLocationId} onSynced={refetch} />
        : undefined,
      content: <LaborSection eventId={eventId!} companyId={companyId!} laborEntries={laborEntries} laborMethod={company?.laborMethod} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.additionalFees', 'Additional Fees'),
      content: <AdditionalFeesSection eventId={eventId!} fees={additionalFees} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.expenses', 'Expenses'),
      content: <ExpensesForm eventId={eventId!} expenses={expenses} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.tips', 'Tips'),
      content: <AdjustmentForm eventId={eventId!} field="tips" label={t('dashboard.tipsLabel', 'Tips (pass-through)')} currentValue={Number(sales.tips ?? 0)} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.salesTax', 'Sales Tax'),
      content: <TaxSection eventId={eventId!} hasPos={!!event?.posLocationId} taxes={taxes} onSaved={refetch} />,
    },
    {
      title: t('dashboard.tabs.ingredientCosts', 'Ingredient Costs (Recipe Matching)'),
      content: <p style={{ color: 'var(--muted)', fontSize: '0.86rem', margin: 0 }}>{t('dashboard.recipeMatchingComing', 'Recipe matching coming in Phase 5. Connect recipes to auto-calculate COGS.')}</p>,
    },
  ];
  const active = tabs[Math.min(activeTab, tabs.length - 1)];

  // Lifecycle stage + the single recommended next action for this event.
  const stage = deriveEventStage({
    isFinalized: event?.isFinalized,
    posLocationId: event?.posLocationId,
    sales,
    posConnected: !!company?.posStatus?.connected,
  });

  function goToNextStep() {
    switch (stage.nextStep.action) {
      case 'review-finalize': finalizeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'enter-sales': setActiveTab(2); tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'add-costs': setActiveTab(4); tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      default: setActiveTab(0); tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; // pull-sales
    }
  }

  // Pre-event vs post-event: before the event happens (and before any sales),
  // show a planning view rather than the reconcile/profit data.
  const isUpcoming = deriveEventTiming(event ?? {}) === 'upcoming';
  const showData = !isUpcoming || hasSales(sales) || forceShowData;

  // Pull-sales buttons for each connected integration. Only show a source when
  // its company-level connection exists; add future POS integrations here.
  const salesSourceButtons: ReactNode[] = [];
  if (company?.posStatus?.connected) {
    salesSourceButtons.push(
      <SyncSalesButton key="pos" eventId={eventId!} posLocationId={event?.posLocationId} onSynced={refetch} />
    );
  }

  return (
    <>
      {/* Dashboard header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <div className="text-[1.35rem] font-bold text-[#0B2A4A]">{event?.eventName}</div>
          {event?.isFinalized && <span className="finalized-badge-large">{t('dashboard.finalizedBadge', 'FINALIZED')}</span>}
        </div>
        <div className="text-[0.88rem] text-[#64748b] font-medium mb-1.5">{formatDateRange(event?.eventDate, event?.numDays, t)}</div>
        {event?.finalizedDate && (
          <div className="text-[0.78rem] text-[#64748b] mt-0.5">
            {t('dashboard.finalizedOn', 'Finalized on: {{date}}', { date: shortDate(event.finalizedDate) })}
          </div>
        )}

        {metaFields.length > 0 && (
          <div className="flex flex-wrap gap-[7px] mt-2">
            {metaFields.map(f => (
              <span key={f.label} className="inline-flex items-center gap-1 bg-[#f1f5f9] rounded-full px-2.5 py-[3px] text-[0.78rem]">
                <span className="text-[#64748b] font-medium">{f.label}</span>
                <span className="text-[#0B2A4A] font-semibold">{f.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-[7px] mb-[18px] mt-3.5">
          <div className="flex flex-wrap gap-2 items-center">
            {salesSourceButtons}
            <Link to={`/companies/${companyId}/events/${eventId}/edit`} className="btn-secondary"><i className="fa-solid fa-pen-to-square" /> {t('dashboard.editEvent', 'Edit Event')}</Link>
            <Link to={`/companies/${companyId}/events/${eventId}/report`} className="btn-secondary"><i className="fa-solid fa-chart-bar" /> {t('dashboard.postEventReport', 'Post-Event Report')}</Link>
            <button className="btn-secondary" onClick={handleDuplicate} disabled={duplicating}>
              {duplicating ? <span className="spinner" /> : <i className="fa-solid fa-copy" />} {t('dashboard.duplicateEvent', 'Duplicate Event')}
            </button>
            <button className="btn-danger-subtle" onClick={handleDelete}><i className="fa-solid fa-trash" /> {t('dashboard.deleteEvent', 'Delete Event')}</button>
          </div>
        </div>
      </div>

      {/* ── Lifecycle stepper + next-step ── */}
      <EventStageStepper stage={stage} />

      {autoPulling && (
        <div className="bg-[#eff6ff] border border-[#bfdbfe] text-[#1d4ed8] rounded-xl px-5 py-3 mb-4 text-[0.9rem] font-semibold flex items-center gap-2">
          <span className="spinner spinner-dark" style={{ width: 16, height: 16, borderWidth: 2 }} />
          {t('dashboard.pullingSalesLabor', 'Pulling your sales & labor from your POS…')}
        </div>
      )}

      {!autoPulling && (
        isUpcoming && !showData ? (
          <NextStepBanner
            eyebrow={t('dashboard.banner.upcomingEyebrow', 'Upcoming')}
            title={t('dashboard.banner.upcomingTitle', "This event hasn't happened yet")}
            description={t('dashboard.banner.upcomingDesc', 'Sales & labor will appear automatically after the event. You can fill in details now.')}
            ctaLabel={t('dashboard.banner.editDetails', 'Edit details')}
            to={`/companies/${companyId}/events/${eventId}/edit`}
          />
        ) : stage.phase === 'done' ? (
          <NextStepBanner
            eyebrow={t('dashboard.banner.finalizedEyebrow', 'Finalized')}
            title={t('dashboard.banner.finalizedTitle', 'This event is finalized')}
            description={t('dashboard.banner.finalizedDesc', 'View or download the full profit report.')}
            ctaLabel={t('dashboard.banner.viewReport', 'View report')}
            to={`/companies/${companyId}/events/${eventId}/report`}
          />
        ) : (
          <NextStepBanner
            eyebrow={PHASE_LABELS[stage.phase]}
            title={stage.nextStep.label}
            description={stage.phase === 'finalize' ? t('dashboard.banner.finalizeDesc', 'Sales are in — review the numbers and lock the event.') : t('dashboard.banner.captureDesc', 'Capture this event’s sales, then add labor and expenses.')}
            ctaLabel={stage.nextStep.label}
            onClick={goToNextStep}
          />
        )
      )}

      {!showData && (
        <div className="bg-white rounded-xl border border-[rgba(11,42,74,0.12)] shadow-[0_4px_12px_rgba(11,42,74,0.08)] px-5 py-8 mb-2.5 text-center">
          <div className="text-[2rem] mb-2">📅</div>
          <h3 className="m-0 mb-1 text-[1.05rem] font-bold text-[#0B2A4A]">{t('dashboard.planningMode', 'Planning mode')}</h3>
          <p className="m-0 mb-4 text-[0.86rem] text-[#64748b]">{t('dashboard.planningModeDesc', 'Sales, labor, and profit show up after the event. Use this time to finalize the details.')}</p>
          <button className="btn-secondary" onClick={() => setForceShowData(true)}>{t('dashboard.enterDataAnyway', 'Enter data anyway')}</button>
        </div>
      )}

      {showData && (
        <>
          {/* ── Reconcile: event data tabs (Inventory Sales → Ingredient Costs) ── */}
          <div ref={tabsRef} className="bg-white rounded-xl border border-[rgba(11,42,74,0.12)] overflow-hidden mb-2.5 shadow-[0_4px_12px_rgba(11,42,74,0.08)]">
            <div className="flex bg-[#f8fafc] border-b border-[rgba(11,42,74,0.12)]" role="tablist">
              {tabs.map((t, i) => (
                <button
                  key={t.title}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === i}
                  onClick={() => setActiveTab(i)}
                  className={`flex-1 min-w-0 px-2 py-2.5 text-[0.85rem] font-semibold break-words text-center border-0 bg-transparent cursor-pointer border-b-2 transition-colors ${activeTab === i ? 'text-[#0B2A4A] border-[#0B2A4A]' : 'text-[#64748b] border-transparent hover:text-[#0B2A4A]'}`}
                >
                  {t.title}
                </button>
              ))}
            </div>
            <div className="px-[18px] pt-3.5 pb-[18px]">
              {active.headerRight && <div className="flex justify-end mb-3">{active.headerRight}</div>}
              {active.content}
            </div>
          </div>

          {/* Finalize: Event Profit Summary */}
          <div ref={finalizeRef}>
            <ProfitSummaryCard
              eventId={eventId!}
              isFinalized={Boolean(event?.isFinalized)}
              sales={sales}
              expenses={expenses}
              summary={summary}
              taxes={taxes}
              onFinalized={refetch}
            />
          </div>
        </>
      )}
    </>
  );
}

// ── POS Sales Sync button ─────────────────────────────────────────────────────
function SyncSalesButton({ eventId, posLocationId, onSynced }: { eventId: string; posLocationId?: string | null; onSynced: () => void }) {
  const SYNC = gql`
    mutation SyncSales($eventId: ID!) {
      syncSales(eventId: $eventId) { success message unmatchedCount }
    }
  `;
  const [sync] = useMutation(SYNC);
  const [syncing, setSyncing] = useState(false);
  const { t } = useTranslation('events');

  async function handleSync() {
    if (!posLocationId) {
      showToast(t('toast.noPosLocation', 'No POS location linked to this event. Edit the event to add one.'), 'warning', 5000);
      return;
    }
    setSyncing(true);
    try {
      const { data } = await sync({ variables: { eventId } });
      const result = data.syncSales;
      showToast(result.message, result.success ? 'success' : 'warning', 5000);
      if (result.success) onSynced();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.syncFailed', 'Sync failed'), 'error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button className="btn-primary" onClick={handleSync} disabled={syncing}>
      {syncing && <span className="spinner" />}
      <span><i className="fa-solid fa-arrows-rotate" /> {t('dashboard.pullSales', 'Pull Sales')}</span>
    </button>
  );
}

function SyncLaborButton({ eventId, posLocationId, onSynced }: { eventId: string; posLocationId?: string | null; onSynced: () => void }) {
  const SYNC = gql`
    mutation SyncLabor($eventId: ID!) {
      syncLabor(eventId: $eventId) { success message }
    }
  `;
  const [sync] = useMutation(SYNC);
  const [syncing, setSyncing] = useState(false);
  const { t } = useTranslation('events');

  async function handleSync() {
    if (!posLocationId) {
      showToast(t('toast.noPosLocation', 'No POS location linked to this event. Edit the event to add one.'), 'warning', 5000);
      return;
    }
    setSyncing(true);
    try {
      const { data } = await sync({ variables: { eventId } });
      const result = data.syncLabor;
      showToast(result.message, result.success ? 'success' : 'warning', 5000);
      if (result.success) onSynced();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.laborSyncFailed', 'Labor sync failed'), 'error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button className="btn-secondary" onClick={handleSync} disabled={syncing} style={{ fontSize: '0.8rem', padding: '3px 10px' }}>
      {syncing && <span className="spinner" />}
      <span>{t('dashboard.pullLabor', 'Pull Labor')}</span>
    </button>
  );
}

// ── Sales Tax section ─────────────────────────────────────────────────────────
function TaxSection({ eventId, hasPos, taxes, onSaved }: {
  eventId: string;
  hasPos: boolean;
  taxes: Record<string, unknown>;
  onSaved: () => void;
}) {
  const SET_RATES = gql`
    mutation SetEventTaxRates($eventId: ID!, $stateTaxRate: Float!, $localTaxRate: Float!) {
      setEventTaxRates(eventId: $eventId, stateTaxRate: $stateTaxRate, localTaxRate: $localTaxRate) { taxRate }
    }
  `;
  const REFRESH_RATES = gql`
    mutation RefreshEventTaxRates($eventId: ID!) {
      refreshEventTaxRates(eventId: $eventId) { taxRate }
    }
  `;
  const [setRates] = useMutation(SET_RATES);
  const [refreshRates] = useMutation(REFRESH_RATES);
  const { t } = useTranslation('events');
  const { fmt } = useCurrency();

  const statePctInit = (Number(taxes?.['stateRate'] ?? 0) * 100).toString();
  const localPctInit = (Number(taxes?.['localRate'] ?? 0) * 100).toString();
  const [statePct, setStatePct] = useState(statePctInit);
  const [localPct, setLocalPct] = useState(localPctInit);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const j = (taxes?.['jurisdiction'] as { state?: string; county?: string; city?: string } | null) ?? {};
  const stateName = j.state || t('dashboard.tax.stateFallback', 'State');
  const localName = j.city || j.county || t('dashboard.tax.localFallback', 'Local');
  const stateTax = Number(taxes?.['stateTax'] ?? 0);
  const localTax = Number(taxes?.['localTax'] ?? 0);
  const taxCollected = Number(taxes?.['taxCollected'] ?? 0);

  async function save() {
    setSaving(true);
    try {
      await setRates({ variables: { eventId, stateTaxRate: (parseFloat(statePct) || 0) / 100, localTaxRate: (parseFloat(localPct) || 0) / 100 } });
      showToast(t('toast.taxRatesSaved', 'Tax rates saved'), 'success');
      onSaved();
    } catch (e) { showToast(e instanceof Error ? e.message : t('toast.saveRatesFailed', 'Failed to save rates'), 'error'); }
    finally { setSaving(false); }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshRates({ variables: { eventId } });
      showToast(t('toast.ratesRefreshed', 'Rates refreshed from ZIP'), 'success');
      onSaved();
    } catch (e) { showToast(e instanceof Error ? e.message : t('toast.refreshFailed', 'Failed to refresh'), 'error'); }
    finally { setRefreshing(false); }
  }

  const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem' };

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: '0 0 12px' }}>
        {t('dashboard.tax.intro', "Sales tax is a pass-through you remit to the taxing authorities — it's tracked here for your records and never counted as profit.")}
        {hasPos ? ' ' + t('dashboard.tax.fromPos', 'Amounts come from your actual POS sales.') : ' ' + t('dashboard.tax.estimated', 'Amounts are estimated from the rates below.')}
      </p>

      <div style={{ marginBottom: 14 }}>
        <div style={rowStyle}><span>{t('dashboard.tax.remitState', 'Remit to {{name}} — State ({{rate}}%)', { name: stateName, rate: (Number(taxes?.['stateRate'] ?? 0) * 100).toFixed(2) })}</span><strong>{fmt(stateTax)}</strong></div>
        <div style={rowStyle}><span>{t('dashboard.tax.local', '{{name}} — Local ({{rate}}%)', { name: localName, rate: (Number(taxes?.['localRate'] ?? 0) * 100).toFixed(2) })}</span><strong>{fmt(localTax)}</strong></div>
        <div style={{ ...rowStyle, borderBottom: 'none', fontWeight: 700, color: 'var(--vv-navy)' }}><span>{t('dashboard.tax.totalCollected', 'Total tax collected')}</span><strong>{fmt(taxCollected)}</strong></div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>{t('dashboard.tax.stateRate', 'State rate %')}</label>
          <input type="number" step="0.001" value={statePct} onChange={e => setStatePct(e.target.value)} style={{ width: 100 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>{t('dashboard.tax.localRate', 'Local rate %')}</label>
          <input type="number" step="0.001" value={localPct} onChange={e => setLocalPct(e.target.value)} style={{ width: 100 }} />
        </div>
        <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={save} disabled={saving}>
          {saving && <span className="spinner" />} <span>{t('dashboard.tax.saveRates', 'Save rates')}</span>
        </button>
        <button className="btn-secondary" style={{ fontSize: '0.82rem' }} onClick={refresh} disabled={refreshing}>
          {refreshing && <span className="spinner" />} <span>{t('dashboard.tax.refreshFromZip', 'Refresh from ZIP')}</span>
        </button>
      </div>
    </div>
  );
}

// ── Inline sub-forms ─────────────────────────────────────────────────────────

function ManualSalesForm({ eventId, sales, onSaved }: { eventId: string; sales: Record<string, unknown>; onSaved: () => void }) {
  const UPDATE = gql`
    mutation UpdateManualSales($eventId: ID!, $input: ManualSalesInput!) {
      updateManualSales(eventId: $eventId, input: $input) { grossSales netSales }
    }
  `;
  const [updateSales] = useMutation(UPDATE);
  const { t } = useTranslation('events');
  const [vals, setVals] = useState({
    grossSales: String(sales.grossSales ?? '0'),
    refunds: String(sales.refunds ?? '0'),
    discounts: String(sales.discounts ?? '0'),
    totalCollected: String(sales.totalCollected ?? '0'),
  });
  const [saving, setSaving] = useState(false);

  const fieldLabels: Record<string, string> = {
    grossSales: t('dashboard.manualSales.grossSales', 'gross Sales'),
    refunds: t('dashboard.manualSales.refunds', 'refunds'),
    discounts: t('dashboard.manualSales.discounts', 'discounts'),
    totalCollected: t('dashboard.manualSales.totalCollected', 'total Collected'),
  };

  async function save() {
    setSaving(true);
    try {
      await updateSales({ variables: { eventId, input: { grossSales: +vals.grossSales, refunds: +vals.refunds, discounts: +vals.discounts, totalCollected: +vals.totalCollected } } });
      showToast(t('toast.salesSaved', 'Sales saved!'), 'success');
      onSaved();
    } catch (e) { showToast(t('toast.saveFailedGeneric', 'Failed to save'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
      {(['grossSales', 'refunds', 'discounts', 'totalCollected'] as const).map(k => (
        <div key={k} className="form-group" style={{ margin: 0 }}>
          <label style={{ textTransform: 'capitalize' }}>{fieldLabels[k]}</label>
          <input type="number" step="0.01" value={vals[k]} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} />
        </div>
      ))}
      <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
        <button className="btn-primary" onClick={save} disabled={saving} style={{ fontSize: '0.86rem' }}>
          {saving && <span className="spinner" />} <span><i className="fa-solid fa-floppy-disk" /> {t('dashboard.saveSalesData', 'Save Sales Data')}</span>
        </button>
      </div>
    </div>
  );
}

function AdjustmentForm({ eventId, field, label, currentValue, onSaved }: { eventId: string; field: 'tips' | 'discounts'; label: string; currentValue: number; onSaved: () => void }) {
  const UPDATE = gql`
    mutation UpdateAdjustments($eventId: ID!, $tips: Float, $posFee: Float) {
      updateAdjustments(eventId: $eventId, tips: $tips, posFee: $posFee)
    }
  `;
  const [update] = useMutation(UPDATE);
  const { t } = useTranslation('events');
  const [val, setVal] = useState(String(currentValue));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await update({ variables: { eventId, [field]: +val } });
      showToast(t('toast.fieldSaved', '{{label}} saved!', { label }), 'success');
      onSaved();
    } catch { showToast(t('toast.saveFailedGeneric', 'Failed to save'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
      <div className="form-group" style={{ margin: 0, flex: 1, maxWidth: 200 }}>
        <label>{label}</label>
        <input type="number" step="0.01" value={val} onChange={e => setVal(e.target.value)} />
      </div>
      <button className="btn-primary" onClick={save} disabled={saving} style={{ fontSize: '0.86rem', marginBottom: 0 }}>
        {saving && <span className="spinner" />} <span>{t('dashboard.save', 'Save')}</span>
      </button>
    </div>
  );
}

function LaborSection({ eventId, companyId, laborEntries, laborMethod, onSaved }: { eventId: string; companyId: string; laborEntries: Array<Record<string, unknown>>; laborMethod?: string | null; onSaved: () => void }) {
  const flatMode = laborMethod === 'flat_rate';
  const CREATE = gql`
    mutation CreateLabor($eventId: ID!, $input: LaborEntryInput!) {
      createLaborEntry(eventId: $eventId, input: $input) { id name hours wage total }
    }
  `;
  const DELETE_LABOR = gql`
    mutation DeleteLabor($id: ID!) { deleteLaborEntry(id: $id) }
  `;
  const GET_EMPLOYEES = gql`
    query GetEmp($companyId: ID!) { employees(companyId: $companyId) { id name defaultWage } }
  `;

  const [create] = useMutation(CREATE);
  const [deleteLabor] = useMutation(DELETE_LABOR);
  const { data: empData } = useQuery(GET_EMPLOYEES, { variables: { companyId } });
  const employees = empData?.employees ?? [];
  const { t } = useTranslation('events');
  const { fmt } = useCurrency();

  const [form, setForm] = useState({ name: '', hours: '', wage: '', flatRate: '' });
  const [saving, setSaving] = useState(false);

  async function addShift() {
    if (flatMode) {
      if (!form.name || !form.flatRate) { showToast(t('toast.fillNameFlatRate', 'Fill in name and flat rate'), 'error'); return; }
    } else if (!form.name || !form.hours || !form.wage) {
      showToast(t('toast.fillNameHoursWage', 'Fill in name, hours, and wage'), 'error'); return;
    }
    setSaving(true);
    try {
      const input = flatMode
        ? { name: form.name, flatRate: +form.flatRate }
        : { name: form.name, hours: +form.hours, wage: +form.wage };
      await create({ variables: { eventId, input } });
      setForm({ name: '', hours: '', wage: '', flatRate: '' });
      showToast(t('toast.shiftAdded', 'Shift added'), 'success');
      onSaved();
    } catch { showToast(t('toast.addShiftFailed', 'Failed to add shift'), 'error'); }
    finally { setSaving(false); }
  }

  async function removeShift(id: string) {
    await deleteLabor({ variables: { id } });
    onSaved();
  }

  function pickEmployee(emp: { name: string; defaultWage: number }) {
    setForm(f => ({ ...f, name: emp.name, wage: String(emp.defaultWage) }));
  }

  return (
    <div>
      {laborEntries.length > 0 && (
        <table className="w-full border-collapse text-[0.86rem] mt-2">
          <thead><tr>
            {[
              t('dashboard.labor.name', 'Name'),
              t('dashboard.labor.hours', 'Hours'),
              t('dashboard.labor.wage', 'Wage'),
              t('dashboard.labor.total', 'Total'),
              '',
            ].map((h, hi) => (
              <th key={hi} className="px-2 py-1.5 text-left text-[0.72rem] font-semibold text-[#64748b] uppercase tracking-[0.04em] border-b border-[#dde3f0]">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {laborEntries.map(r => (
              <tr key={r['id'] as string}>
                <td className="px-2 py-[7px] border-b border-[#f8fafc] align-middle">{r['name'] as string}</td>
                <td className="px-2 py-[7px] border-b border-[#f8fafc] align-middle">{Number(r['hours']).toFixed(2)}</td>
                <td className="px-2 py-[7px] border-b border-[#f8fafc] align-middle">{t('dashboard.labor.wagePerHour', '{{amount}}/hr', { amount: fmt(r['wage'] as number) })}</td>
                <td className="px-2 py-[7px] border-b border-[#f8fafc] align-middle font-semibold">{fmt(r['total'] as number)}</td>
                <td className="px-2 py-[7px] border-b border-[#f8fafc] align-middle"><button onClick={() => removeShift(r['id'] as string)} className="bg-transparent border-0 text-[#dc2626] cursor-pointer text-[0.85rem]"><i className="fa-solid fa-xmark" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: laborEntries.length > 0 ? 12 : 0, alignItems: 'flex-end' }}>
        {employees.length > 0 && (
          <div className="form-group" style={{ margin: 0 }}>
            <label>{t('dashboard.labor.quickPick', 'Quick pick')}</label>
            <select onChange={e => { const emp = employees.find((x: { id: string }) => x.id === e.target.value); if (emp) pickEmployee(emp); e.target.value = ''; }} style={{ width: 160 }}>
              <option value="">{t('dashboard.labor.employeePlaceholder', 'Employee…')}</option>
              {employees.map((emp: { id: string; name: string; defaultWage: number }) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-group" style={{ margin: 0 }}>
          <label>{t('dashboard.labor.name', 'Name')}</label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ width: 140 }} />
        </div>
        {flatMode ? (
          <div className="form-group" style={{ margin: 0 }}>
            <label>{t('dashboard.labor.flatRateShift', 'Flat rate / shift')}</label>
            <input type="number" step="0.01" value={form.flatRate} onChange={e => setForm(f => ({ ...f, flatRate: e.target.value }))} style={{ width: 110 }} />
          </div>
        ) : (
          <>
            <div className="form-group" style={{ margin: 0 }}>
              <label>{t('dashboard.labor.hours', 'Hours')}</label>
              <input type="number" step="0.25" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} style={{ width: 80 }} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>{t('dashboard.labor.wagePerHrLabel', 'Wage/hr')}</label>
              <input type="number" step="0.01" value={form.wage} onChange={e => setForm(f => ({ ...f, wage: e.target.value }))} style={{ width: 90 }} />
            </div>
          </>
        )}
        <button className="btn-primary" onClick={addShift} disabled={saving} style={{ marginBottom: 0 }}>
          {saving && <span className="spinner" />} <span>{t('dashboard.labor.addShift', '+ Add Shift')}</span>
        </button>
      </div>
    </div>
  );
}

function AdditionalFeesSection({ eventId, fees, onSaved }: { eventId: string; fees: Array<Record<string, unknown>>; onSaved: () => void }) {
  const CREATE = gql`
    mutation CreateFee($eventId: ID!, $input: AdditionalFeeInput!) {
      createAdditionalFee(eventId: $eventId, input: $input) { id label amount isDiscount }
    }
  `;
  const DELETE_FEE = gql`
    mutation DeleteFee($id: ID!) { deleteAdditionalFee(id: $id) }
  `;
  const [create] = useMutation(CREATE);
  const [deleteFee] = useMutation(DELETE_FEE);
  const { t } = useTranslation('events');
  const { fmt } = useCurrency();
  const [form, setForm] = useState({ label: '', amount: '', isDiscount: false });
  const [saving, setSaving] = useState(false);

  async function addFee() {
    if (!form.label || !form.amount) return;
    setSaving(true);
    try {
      await create({ variables: { eventId, input: { label: form.label, amount: +form.amount, isDiscount: form.isDiscount } } });
      setForm({ label: '', amount: '', isDiscount: false });
      onSaved();
    } catch { showToast(t('toast.failed', 'Failed'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      {fees.map(f => (
        <div key={f['id'] as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.86rem' }}>
          <span>{f['label'] as string}{f['isDiscount'] ? t('dashboard.fees.discountSuffix', ' (discount)') : ''}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <span>{f['isDiscount'] ? '-' : ''}{fmt(Number(f['amount']))}</span>
            <button onClick={() => { deleteFee({ variables: { id: f['id'] } }); onSaved(); }} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><i className="fa-solid fa-xmark" /></button>
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>{t('dashboard.fees.label', 'Label')}</label>
          <input type="text" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={{ width: 160 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>{t('dashboard.fees.amount', 'Amount')}</label>
          <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 100 }} />
        </div>
        <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.isDiscount} onChange={e => setForm(f => ({ ...f, isDiscount: e.target.checked }))} id="feeDiscount" />
          <label htmlFor="feeDiscount" style={{ marginBottom: 0 }}>{t('dashboard.fees.discount', 'Discount')}</label>
        </div>
        <button className="btn-primary" onClick={addFee} disabled={saving} style={{ marginBottom: 0 }}>
          {saving && <span className="spinner" />} <span>{t('dashboard.fees.add', '+ Add')}</span>
        </button>
      </div>
    </div>
  );
}

function ExpensesForm({ eventId, expenses, onSaved }: { eventId: string; expenses: Record<string, unknown>; onSaved: () => void }) {
  const UPDATE = gql`
    mutation UpdateExpenses($eventId: ID!, $input: ExpensesInput!) {
      updateExpenses(eventId: $eventId, input: $input) {
        healthDeptFee eventFee mileage mileageRate coordinatorFee posFee employeeBonus eventRunnerFees
      }
    }
  `;
  const [update] = useMutation(UPDATE);
  const { t } = useTranslation('events');
  const fields = [
    { key: 'healthDeptFee', label: t('dashboard.expenses.healthDeptFee', 'Health Dept Fee') },
    { key: 'eventFee', label: t('dashboard.expenses.eventFee', 'Event Fee') },
    { key: 'mileage', label: t('dashboard.expenses.mileage', 'Mileage (miles)') },
    { key: 'mileageRate', label: t('dashboard.expenses.mileageRate', 'Mileage Rate ($/mi)') },
    { key: 'coordinatorFee', label: t('dashboard.expenses.coordinatorFee', 'Coordinator Fee') },
    { key: 'posFee', label: t('dashboard.expenses.posFee', 'Manual POS Fee') },
    { key: 'employeeBonus', label: t('dashboard.expenses.employeeBonus', 'Employee Bonus') },
    { key: 'eventRunnerFees', label: t('dashboard.expenses.eventRunnerFees', 'Event Runner Fees') },
  ];
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.key, String(expenses[f.key] ?? '0')]))
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const input = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, +v]));
      await update({ variables: { eventId, input } });
      showToast(t('toast.expensesSaved', 'Expenses saved!'), 'success');
      onSaved();
    } catch { showToast(t('toast.saveFailedGeneric', 'Failed to save'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {fields.map(f => (
          <div key={f.key} className="form-group" style={{ margin: 0 }}>
            <label>{f.label}</label>
            <input type="number" step="0.01" value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} />
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={save} disabled={saving} style={{ marginTop: 12, fontSize: '0.86rem' }}>
        {saving && <span className="spinner" />} <span><i className="fa-solid fa-floppy-disk" /> {t('dashboard.expenses.save', 'Save Expenses')}</span>
      </button>
    </div>
  );
}

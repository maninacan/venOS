import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation, Trans } from 'react-i18next';
import { showToast } from '@org/data';
import { Combobox } from '../Combobox';

const GET_AI_RECOMMENDATIONS = gql`
  query PosModifierMappingRecommendations($companyId: ID!, $posModifierIds: [String!]) {
    posModifierMappingRecommendations(companyId: $companyId, posModifierIds: $posModifierIds) {
      posModifierId recipeId inventoryId confidence reason
    }
  }
`;

const GET_DATA = gql`
  query GetPosModifierMappingData($companyId: ID!) {
    posModifierCatalog(companyId: $companyId) { posModifierId posModifierName price }
    inventory(companyId: $companyId) { id name unitCost }
    posModifierMappings(companyId: $companyId) { posModifierId inventoryItemId recipeId quantity }
  }
`;
const SAVE_MAPPINGS = gql`
  mutation SavePosModifierMappings($companyId: ID!, $mappings: [PosModifierMappingInput!]!) {
    savePosModifierMappings(companyId: $companyId, mappings: $mappings)
  }
`;
const CREATE_INVENTORY_ITEM = gql`
  mutation CreateInventoryItem($companyId: ID!, $input: CreateInventoryItemInput!) {
    createInventoryItem(companyId: $companyId, input: $input) { id name unitCost }
  }
`;

interface CatalogItem { posModifierId: string; posModifierName: string; price?: number | null; }
interface InventoryOption { id: string; name: string; unitCost: number; }
// A modifier maps to one inventory item plus the amount used per drink. Cost =
// amount × unitCost; a NEGATIVE amount removes an ingredient (reduces COGS, e.g.
// "No SCM" = -1). recipeId is retained (loaded/saved back) so any recipe mapping
// created elsewhere isn't wiped, but it can't be set here.
interface Mapping { posModifierId: string; inventoryItemId: string | null; recipeId: string | null; quantity: number; suggested?: boolean; }
const DEFAULT_QTY = 1;

interface Props {
  companyId: string;
  onClose: () => void;
}

export function PosModifierMappingModal({ companyId, onClose }: Props) {
  const { t } = useTranslation('modals');
  const { data, loading, refetch } = useQuery(GET_DATA, { variables: { companyId } });
  const [saveMappings] = useMutation(SAVE_MAPPINGS);
  const [createInventoryItem] = useMutation(CREATE_INVENTORY_ITEM);
  const [fetchAiRecommendations] = useLazyQuery(GET_AI_RECOMMENDATIONS);
  const [mappings, setMappings] = useState<Map<string, Mapping>>(new Map());
  // Inline "quick add inventory item": which modifier row triggered it + form fields.
  const [invAdd, setInvAdd] = useState<{ posModifierId: string; name: string; unitCost: string } | null>(null);
  const [invSaving, setInvSaving] = useState(false);
  // Display order of catalog rows. Unmapped items are floated to the top, but the
  // order is snapshotted (on load and after AI-suggest) rather than recomputed on
  // every keystroke, so rows don't jump around while the user is mapping.
  const [sortedIds, setSortedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiElapsed, setAiElapsed] = useState(0);
  const aiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drive the elapsed timer shown in the AI progress window.
  useEffect(() => {
    if (aiLoading) {
      setAiElapsed(0);
      aiTimerRef.current = setInterval(() => setAiElapsed(s => s + 1), 1000);
    } else if (aiTimerRef.current) {
      clearInterval(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    return () => { if (aiTimerRef.current) clearInterval(aiTimerRef.current); };
  }, [aiLoading]);

  const catalogItems: CatalogItem[] = data?.posModifierCatalog ?? [];
  const inventoryItems: InventoryOption[] = data?.inventory ?? [];
  const existingMaps: Array<{ posModifierId: string; inventoryItemId: string | null; recipeId: string | null; quantity: number | null }> = data?.posModifierMappings ?? [];

  // Initialize mappings from saved values.
  useEffect(() => {
    if (!data) return;
    const m = new Map<string, Mapping>();
    const savedMap = new Map(existingMaps.map(e => [e.posModifierId, e]));

    for (const item of catalogItems) {
      const saved = savedMap.get(item.posModifierId);
      m.set(item.posModifierId, {
        posModifierId: item.posModifierId,
        inventoryItemId: saved?.inventoryItemId ?? null,
        recipeId: saved?.recipeId ?? null,
        quantity: saved?.quantity ?? DEFAULT_QTY,
        suggested: false,
      });
    }
    setMappings(m);
    setSortedIds(orderIds(m));
  }, [data]); // eslint-disable-line

  function setMapping(posModifierId: string, patch: Partial<Mapping>) {
    setMappings(prev => {
      const next = new Map(prev);
      const cur = next.get(posModifierId) ?? { posModifierId, inventoryItemId: null, recipeId: null, quantity: DEFAULT_QTY };
      // Selecting an inventory item where there was none defaults the amount to 1.
      const patched = { ...cur, ...patch, posModifierId, suggested: false };
      if (patch.inventoryItemId && !cur.inventoryItemId && patch.quantity == null) patched.quantity = DEFAULT_QTY;
      next.set(posModifierId, patched);
      return next;
    });
  }

  // Create an inventory item inline (name + unit cost) and map the triggering row to it.
  async function handleQuickAddInventory() {
    if (!invAdd) return;
    const name = invAdd.name.trim();
    if (!name) { showToast(t('posModifierMapping.invNameRequired', 'Item name is required'), 'error'); return; }
    setInvSaving(true);
    try {
      const res = await createInventoryItem({ variables: { companyId, input: { name, unitCost: Number(invAdd.unitCost) || 0 } } });
      const created = (res.data as { createInventoryItem?: { id: string } } | null)?.createInventoryItem;
      const posModifierId = invAdd.posModifierId;
      setInvAdd(null);
      await refetch();
      if (created?.id) setMapping(posModifierId, { inventoryItemId: created.id });
      showToast(t('posModifierMapping.invAdded', 'Inventory item added.'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posModifierMapping.invAddFailed', 'Failed to add item'), 'error');
    } finally { setInvSaving(false); }
  }

  const isUnmapped = (m?: Mapping) => !m?.inventoryItemId;

  // Order catalog rows with unmapped items first; Array.sort is stable so items
  // within each group keep their original catalog order.
  function orderIds(map: Map<string, Mapping>): string[] {
    return [...catalogItems]
      .sort((a, b) => Number(isUnmapped(map.get(b.posModifierId))) - Number(isUnmapped(map.get(a.posModifierId))))
      .map(i => i.posModifierId);
  }

  async function handleSuggestAI() {
    // Only ask the AI about modifiers that are still unmapped — never re-process
    // ones the user has already mapped (or that were previously suggested).
    const unmappedIds = Array.from(mappings.values()).filter(m => !m.inventoryItemId).map(m => m.posModifierId);
    if (unmappedIds.length === 0) {
      showToast(t('posModifierMapping.aiAllMapped', 'All modifiers are already mapped — nothing for AI to match.'), 'info', 5000);
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await fetchAiRecommendations({ variables: { companyId, posModifierIds: unmappedIds } });
      if (error) throw error;
      const recs: Array<{ posModifierId: string; recipeId: string | null; inventoryId: string | null }> =
        data?.posModifierMappingRecommendations ?? [];
      // Build the next map and count synchronously from current state — do NOT
      // count inside the setMappings updater, which React defers until render.
      let applied = 0;
      const next = new Map(mappings);
      for (const rec of recs) {
        const cur = next.get(rec.posModifierId) ?? { posModifierId: rec.posModifierId, inventoryItemId: null, recipeId: null, quantity: DEFAULT_QTY };
        // Respect deliberate user choices — only fill blanks or replace prior suggestions.
        const userConfirmed = !cur.suggested && cur.inventoryItemId;
        if (userConfirmed) continue;
        // Modifiers map to inventory items — ignore recipe-only recommendations.
        if (!rec.inventoryId) continue;
        next.set(rec.posModifierId, {
          posModifierId: rec.posModifierId,
          inventoryItemId: rec.inventoryId,
          recipeId: cur.recipeId ?? null,
          // AI can't know the amount used per drink — keep any prior amount, else default.
          quantity: cur.quantity ?? DEFAULT_QTY,
          suggested: true,
        });
        applied += 1;
      }
      setMappings(next);
      setSortedIds(orderIds(next));
      showToast(
        applied > 0
          ? t('posModifierMapping.aiApplied', 'AI suggested {{count}} mapping(s). Review and Save.', { count: applied })
          : t('posModifierMapping.aiNone', 'No confident AI matches found. Map the modifiers manually.'),
        applied > 0 ? 'success' : 'info',
        5000,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posModifierMapping.aiFailed', 'AI suggestion failed. Please try again.'), 'error');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const mapsArray = Array.from(mappings.values()).map(m => ({
        posSystem: 'square',
        posModifierId: m.posModifierId,
        posModifierName: catalogItems.find(c => c.posModifierId === m.posModifierId)?.posModifierName ?? '',
        inventoryId: m.inventoryItemId,
        recipeId: m.recipeId,
        quantity: m.inventoryItemId ? m.quantity : DEFAULT_QTY,
      }));
      await saveMappings({ variables: { companyId, mappings: mapsArray } });
      showToast(t('posModifierMapping.toast.saved', 'Modifier mappings saved! Cost calculations are now accurate.'), 'success', 5000);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posModifierMapping.toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSaving(false); }
  }

  const unmappedCount = Array.from(mappings.values()).filter(m => !m.inventoryItemId).length;
  const suggestedCount = Array.from(mappings.values()).filter(m => m.suggested && m.inventoryItemId).length;

  // Inventory options for the combobox — built once, shared by every row.
  const inventoryOptions = inventoryItems.map(i => ({
    id: i.id,
    label: t('posModifierMapping.inventoryOption', '{{name}} (${{cost}}/unit)', { name: i.name, cost: Number(i.unitCost).toFixed(2) }),
  }));
  const inventoryById = new Map(inventoryItems.map(i => [i.id, i]));
  // Per-drink modifier cost = amount × the item's unit cost (negative = removal).
  function perDrinkCost(m?: Mapping): number | null {
    if (!m?.inventoryItemId) return null;
    const inv = inventoryById.get(m.inventoryItemId);
    if (!inv) return null;
    return Number(inv.unitCost) * (Number.isFinite(m.quantity) ? m.quantity : 0);
  }

  // Rows in display order (unmapped floated to top via the sortedIds snapshot).
  const catalogById = new Map(catalogItems.map(c => [c.posModifierId, c]));
  const orderedItems: CatalogItem[] = sortedIds.length
    ? sortedIds.map(id => catalogById.get(id)).filter((c): c is CatalogItem => !!c)
    : catalogItems;

  const aiSteps = [
    t('posModifierMapping.aiStep1', 'Reading your POS modifiers'),
    t('posModifierMapping.aiStep2', 'Comparing modifiers to your inventory'),
    t('posModifierMapping.aiStep3', 'Matching ingredient costs'),
    t('posModifierMapping.aiStep4', 'Scoring match confidence'),
    t('posModifierMapping.aiStep5', 'Finalizing suggestions'),
  ];
  const aiStepIndex = aiElapsed < 6 ? 0 : aiElapsed < 15 ? 1 : aiElapsed < 30 ? 2 : aiElapsed < 55 ? 3 : 4;

  return (
    <>
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 820, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', margin: '40px 16px' }}>
        {/* Header */}
        <div style={{ padding: '22px 26px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem', fontWeight: 700, color: 'var(--vv-navy)' }}>
            {t('posModifierMapping.title', 'Match Your POS Modifiers to Your Inventory')}
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            <Trans t={t} i18nKey="posModifierMapping.description" defaults='Map each modifier (flavor add-ons, whip, …) to the inventory item it uses and the amount used per drink — venOS adds that cost to every drink the modifier is on, so COGS stays accurate without a separate menu item per flavor. Use a <2>negative amount</2> for removals (e.g. "No SCM" = -1). Choose "No inventory item" for free modifiers.'>
              Map each modifier (flavor add-ons, whip, …) to the inventory item it uses and the amount used per drink — venOS adds that cost to every drink the modifier is on, so COGS stays accurate without a separate menu item per flavor. Use a <em>negative amount</em> for removals (e.g. "No SCM" = -1). Choose "No inventory item" for free modifiers.
            </Trans>
          </p>
        </div>

        {/* Auto-suggest legend */}
        {suggestedCount > 0 && (
          <div style={{ padding: '8px 26px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: '0.8rem', color: '#78350f' }}>
<i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> <Trans t={t} i18nKey="posModifierMapping.suggestedLegend" count={suggestedCount} values={{ count: suggestedCount }} defaults="<1>{{count}} modifier(s)</1> were matched by AI — marked <3>suggested</3>. Review before saving.">
              <strong>{{ count: suggestedCount }} modifier(s)</strong> were matched by AI — marked <span style={{ background: '#fef3c7', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>suggested</span>. Review before saving.
            </Trans>
          </div>
        )}

        {/* Unmapped warning */}
        {unmappedCount > 0 && (
          <div style={{ padding: '8px 26px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: '0.8rem', color: '#c2410c' }}>
<i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> <Trans t={t} i18nKey="posModifierMapping.unmappedWarning" count={unmappedCount} values={{ count: unmappedCount }} defaults="<1>{{count}} modifier(s)</1> have no inventory item — their cost won’t be added to COGS.">
              <strong>{{ count: unmappedCount }} modifier(s)</strong> have no inventory item — their cost won’t be added to COGS.
            </Trans>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <span className="spinner spinner-dark" style={{ width: 24, height: 24, borderWidth: 2 }} />
          </div>
        ) : catalogItems.length === 0 ? (
          <div style={{ padding: '24px 26px', color: 'var(--muted)', fontSize: '0.88rem' }}>
            {t('posModifierMapping.empty', 'No POS modifiers found. Make sure your POS is connected and has modifiers configured.')}
          </div>
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 400 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb', width: '32%' }}>{t('posModifierMapping.colModifier', 'Modifier')}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb' }}>{t('posModifierMapping.colInventory', 'Inventory Item')}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb', width: '30%' }}>{t('posModifierMapping.colAmount', 'Amount / drink')}</th>
                </tr>
              </thead>
              <tbody>
                {orderedItems.map(item => {
                  const mapping = mappings.get(item.posModifierId);
                  const isSuggested = mapping?.suggested ?? false;
                  const rowUnmapped = isUnmapped(mapping);

                  return (
                    <tr key={item.posModifierId} style={rowUnmapped ? { background: '#fff7ed' } : undefined}>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0', fontSize: '0.87rem', color: '#333', borderLeft: rowUnmapped ? '3px solid #f59e0b' : '3px solid transparent', fontWeight: rowUnmapped ? 600 : 400 }}>
                        {rowUnmapped && <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" style={{ color: '#f59e0b', marginRight: 6, fontSize: '0.78rem' }} />}
                        {item.posModifierName}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <Combobox
                              options={inventoryOptions}
                              value={mapping?.inventoryItemId ?? null}
                              onChange={id => setMapping(item.posModifierId, { inventoryItemId: id })}
                              highlight={isSuggested && !!mapping?.inventoryItemId}
                              noneLabel={t('posModifierMapping.noInventory', '— No inventory item —')}
                              placeholder={t('posModifierMapping.searchInventory', 'Search inventory…')}
                              noMatchesLabel={t('posModifierMapping.noMatches', 'No matching items')}
                            />
                          </div>
                          {isSuggested && mapping?.inventoryItemId && (
                            <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('posModifierMapping.suggestedBadge', 'suggested')}</span>
                          )}
                          <button
                            className="btn-secondary"
                            style={{ fontSize: '0.75rem', padding: '4px 8px', whiteSpace: 'nowrap' }}
                            title={t('posModifierMapping.newItemTitle', 'Create a new inventory item and map it here')}
                            onClick={() => setInvAdd({ posModifierId: item.posModifierId, name: item.posModifierName, unitCost: '' })}
                          >
                            <i className="fa-solid fa-plus" aria-hidden="true" /> {t('posModifierMapping.newItem', 'New')}
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0' }}>
                        {mapping?.inventoryItemId ? (() => {
                          const cost = perDrinkCost(mapping);
                          const costLabel = cost == null ? '' : `${cost < 0 ? '-' : ''}$${Math.abs(cost).toFixed(2)}`;
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="number"
                                step="any"
                                value={Number.isFinite(mapping.quantity) ? mapping.quantity : ''}
                                onChange={e => setMapping(item.posModifierId, { quantity: e.target.value === '' ? NaN : Number(e.target.value) })}
                                style={{ width: 74, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.83rem' }}
                                aria-label={t('posModifierMapping.colAmount', 'Amount / drink')}
                              />
                              <span style={{ fontSize: '0.8rem', color: cost != null && cost < 0 ? '#16a34a' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                                = {costLabel}
                              </span>
                            </div>
                          );
                        })() : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 26px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: '#fff' }}>
          <button
            className="btn-secondary"
            onClick={handleSuggestAI}
            disabled={aiLoading || loading || catalogItems.length === 0}
            title={t('posModifierMapping.aiTitle', 'Let AI suggest matches for the unmapped modifiers — mapped ones are left untouched')}
          >
            {aiLoading && <span className="spinner" />} <span><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> {t('posModifierMapping.suggestAiUnmapped', 'Suggest unmapped with AI')}</span>
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={onClose}>{t('posModifierMapping.cancel', 'Cancel')}</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving && <span className="spinner" />} <span>{t('posModifierMapping.save', 'Save Mappings')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* AI progress window — mirrors the streaming AI features elsewhere in the app */}
    {aiLoading && (
      <div className="modal-overlay" style={{ zIndex: 1100 }}>
        <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.22)', overflow: 'hidden', margin: '40px 16px' }}>
          <div style={{ padding: '24px 28px 14px' }}>
            <h3 style={{ margin: '0 0 4px', color: 'var(--vv-navy)', fontSize: '1.05rem' }}>
              <i className="fa-solid fa-wand-magic-sparkles fa-fade" style={{ marginRight: 8 }} />
              <span>{t('posModifierMapping.aiWorkingTitle', 'Claude is matching your unmapped modifiers…')}</span>
            </h3>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{t('posModifierMapping.aiWorkingNote', 'Analyzing {{count}} unmapped modifier(s) against your inventory — already-mapped modifiers are left untouched. This can take a minute or two.', { count: unmappedCount })}</span>
              <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.88rem', color: 'var(--vv-navy)', fontWeight: 600 }}>
                {`${Math.floor(aiElapsed / 60)}:${String(aiElapsed % 60).padStart(2, '0')}`}
              </span>
            </p>
          </div>
          <div style={{ padding: '4px 28px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {aiSteps.map((label, i) => {
              const done = i < aiStepIndex;
              const active = i === aiStepIndex;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.86rem', color: done ? 'var(--vv-navy)' : active ? 'var(--vv-navy)' : 'var(--muted)', opacity: done || active ? 1 : 0.55 }}>
                  <span style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>
                    {done
                      ? <i className="fa-solid fa-circle-check" style={{ color: '#16a34a' }} />
                      : active
                        ? <span className="spinner spinner-dark" style={{ width: 13, height: 13, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle' }} />
                        : <i className="fa-regular fa-circle" style={{ color: '#cbd5e1' }} />}
                  </span>
                  <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {/* Inline "quick add inventory item" (nested overlay at zIndex 1100) */}
    {invAdd && (
      <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => { if (e.target === e.currentTarget && !invSaving) setInvAdd(null); }}>
        <div className="modal-box" style={{ maxWidth: 420 }}>
          <button className="modal-close" onClick={() => setInvAdd(null)}><i className="fa-solid fa-xmark" /></button>
          <h3 style={{ margin: '0 0 14px' }}>{t('posModifierMapping.newItemHeading', 'New inventory item')}</h3>
          <div className="form-group">
            <label>{t('posModifierMapping.invName', 'Item name *')}</label>
            <input type="text" value={invAdd.name} onChange={e => setInvAdd(a => a && { ...a, name: e.target.value })} autoFocus />
          </div>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label>{t('posModifierMapping.invUnitCost', 'Unit cost')}</label>
            <input type="number" step="0.0001" value={invAdd.unitCost} onChange={e => setInvAdd(a => a && { ...a, unitCost: e.target.value })} placeholder="0.00" />
          </div>
          <p style={{ margin: '8px 0 14px', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.45 }}>
            {t('posModifierMapping.invHint', 'This item is added to your inventory and mapped to this modifier. Cost per drink = unit cost × amount.')}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" onClick={handleQuickAddInventory} disabled={invSaving}>
              {invSaving && <span className="spinner" />} <span>{t('posModifierMapping.invAdd', 'Add item')}</span>
            </button>
            <button className="btn-secondary" onClick={() => setInvAdd(null)} disabled={invSaving}>{t('posModifierMapping.cancel', 'Cancel')}</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

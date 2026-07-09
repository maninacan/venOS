import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation, Trans } from 'react-i18next';
import { showToast } from '@org/data';
import { Combobox } from '../Combobox';

const GET_AI_RECOMMENDATIONS = gql`
  query PosMappingRecommendations($companyId: ID!, $posItemIds: [String!]) {
    posMappingRecommendations(companyId: $companyId, posItemIds: $posItemIds) {
      posItemId recipeId inventoryId confidence reason
    }
  }
`;

const GET_DATA = gql`
  query GetPosMappingData($companyId: ID!) {
    posCatalog(companyId: $companyId) { posItemId posItemName variationName price }
    recipes(companyId: $companyId) { id name totalCost }
    posMappings(companyId: $companyId) { posItemId inventoryItemId recipeId }
  }
`;
const SAVE_MAPPINGS = gql`
  mutation SavePosMappings($companyId: ID!, $mappings: [PosMappingInput!]!) {
    savePosMappings(companyId: $companyId, mappings: $mappings)
  }
`;

interface CatalogItem { posItemId: string; posItemName: string; variationName?: string | null; price?: number | null; }
interface RecipeItem { id: string; name: string; totalCost: number; }
// inventoryItemId is retained (loaded and saved back) so removing the inventory
// UI doesn't wipe any inventory mappings a company saved previously — but it can
// no longer be set from this modal. POS items map to recipes only.
interface Mapping { posItemId: string; inventoryItemId: string | null; recipeId: string | null; suggested?: boolean; }

interface Props {
  companyId: string;
  onClose: () => void;
}

export function PosMappingModal({ companyId, onClose }: Props) {
  const { t } = useTranslation('modals');
  const { data, loading } = useQuery(GET_DATA, { variables: { companyId } });
  const [saveMappings] = useMutation(SAVE_MAPPINGS);
  const [fetchAiRecommendations] = useLazyQuery(GET_AI_RECOMMENDATIONS);
  const [mappings, setMappings] = useState<Map<string, Mapping>>(new Map());
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

  const catalogItems: CatalogItem[] = data?.posCatalog ?? [];
  const recipeItems: RecipeItem[] = data?.recipes ?? [];
  const existingMaps: Array<{ posItemId: string; inventoryItemId: string | null; recipeId: string | null }> = data?.posMappings ?? [];

  // Initialize mappings: saved first, then auto-suggest inventory for unmapped
  useEffect(() => {
    if (!data) return;
    const m = new Map<string, Mapping>();
    const savedMap = new Map(existingMaps.map(e => [e.posItemId, e]));

    for (const item of catalogItems) {
      const saved = savedMap.get(item.posItemId);
      m.set(item.posItemId, {
        posItemId: item.posItemId,
        inventoryItemId: saved?.inventoryItemId ?? null,
        recipeId: saved?.recipeId ?? null,
        suggested: false,
      });
    }
    setMappings(m);
    setSortedIds(orderIds(m));
  }, [data]); // eslint-disable-line

  function setMapping(posItemId: string, patch: Partial<Mapping>) {
    setMappings(prev => {
      const next = new Map(prev);
      const cur = next.get(posItemId) ?? { posItemId, inventoryItemId: null, recipeId: null };
      next.set(posItemId, { ...cur, ...patch, posItemId, suggested: false });
      return next;
    });
  }

  const isUnmapped = (m?: Mapping) => !m?.recipeId;

  // Order catalog rows with unmapped items first; Array.sort is stable so items
  // within each group keep their original catalog order.
  function orderIds(map: Map<string, Mapping>): string[] {
    return [...catalogItems]
      .sort((a, b) => Number(isUnmapped(map.get(b.posItemId))) - Number(isUnmapped(map.get(a.posItemId))))
      .map(i => i.posItemId);
  }

  async function handleSuggestAI() {
    // Only ask the AI about items that are still unmapped — never re-process ones
    // the user has already mapped (or that were previously suggested).
    const unmappedIds = Array.from(mappings.values()).filter(m => !m.recipeId).map(m => m.posItemId);
    if (unmappedIds.length === 0) {
      showToast(t('posMapping.aiAllMapped', 'All items are already mapped — nothing for AI to match.'), 'info', 5000);
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await fetchAiRecommendations({ variables: { companyId, posItemIds: unmappedIds } });
      if (error) throw error;
      const recs: Array<{ posItemId: string; recipeId: string | null; inventoryId: string | null }> =
        data?.posMappingRecommendations ?? [];
      // Build the next map and count synchronously from current state — do NOT
      // count inside the setMappings updater, which React defers until render
      // (the count would still be 0 when the toast below reads it).
      let applied = 0;
      const next = new Map(mappings);
      for (const rec of recs) {
        const cur = next.get(rec.posItemId) ?? { posItemId: rec.posItemId, inventoryItemId: null, recipeId: null };
        // Respect deliberate user choices — only fill blanks or replace prior suggestions.
        const userConfirmed = !cur.suggested && cur.recipeId;
        if (userConfirmed) continue;
        // POS items map to recipes only — ignore inventory-only recommendations.
        if (!rec.recipeId) continue;
        next.set(rec.posItemId, {
          posItemId: rec.posItemId,
          recipeId: rec.recipeId,
          inventoryItemId: cur.inventoryItemId ?? null,
          suggested: true,
        });
        applied += 1;
      }
      setMappings(next);
      setSortedIds(orderIds(next));
      showToast(
        applied > 0
          ? t('posMapping.aiApplied', 'AI suggested {{count}} mapping(s). Review and Save.', { count: applied })
          : t('posMapping.aiNone', 'No confident AI matches found. Map the items manually.'),
        applied > 0 ? 'success' : 'info',
        5000,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posMapping.aiFailed', 'AI suggestion failed. Please try again.'), 'error');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const mapsArray = Array.from(mappings.values()).map(m => ({
        posSystem: 'square',
        posItemId: m.posItemId,
        posItemName: catalogItems.find(c => c.posItemId === m.posItemId)?.posItemName ?? '',
        variationName: catalogItems.find(c => c.posItemId === m.posItemId)?.variationName,
        inventoryId: m.inventoryItemId,
        recipeId: m.recipeId,
      }));
      await saveMappings({ variables: { companyId, mappings: mapsArray } });
      showToast(t('posMapping.toast.saved', 'Mappings saved! Cost calculations are now accurate.'), 'success', 5000);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posMapping.toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSaving(false); }
  }

  const unmappedCount = Array.from(mappings.values()).filter(m => !m.recipeId).length;
  const suggestedCount = Array.from(mappings.values()).filter(m => m.suggested && m.recipeId).length;

  // Recipe options for the combobox — built once, shared by every row.
  const recipeOptions = recipeItems.map(r => ({ id: r.id, label: `${r.name} ($${Number(r.totalCost).toFixed(2)})` }));

  // Rows in display order (unmapped floated to top via the sortedIds snapshot).
  const catalogById = new Map(catalogItems.map(c => [c.posItemId, c]));
  const orderedItems: CatalogItem[] = sortedIds.length
    ? sortedIds.map(id => catalogById.get(id)).filter((c): c is CatalogItem => !!c)
    : catalogItems;

  const aiSteps = [
    t('posMapping.aiStep1', 'Reading your POS catalog'),
    t('posMapping.aiStep2', 'Comparing items to your recipes'),
    t('posMapping.aiStep3', 'Matching against inventory'),
    t('posMapping.aiStep4', 'Scoring match confidence'),
    t('posMapping.aiStep5', 'Finalizing suggestions'),
  ];
  const aiStepIndex = aiElapsed < 6 ? 0 : aiElapsed < 15 ? 1 : aiElapsed < 30 ? 2 : aiElapsed < 55 ? 3 : 4;

  return (
    <>
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 720, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', margin: '40px 16px' }}>
        {/* Header */}
        <div style={{ padding: '22px 26px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem', fontWeight: 700, color: 'var(--vv-navy)' }}>
            {t('posMapping.title', 'Match Your POS Menu to Your Recipe Cards')}
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            <Trans t={t} i18nKey="posMapping.description" defaults='Map each POS item to the recipe that makes it — venOS uses the recipe’s ingredient cost to calculate COGS automatically every sync. Choose <2>"No recipe"</2> for tips, fees, and other non-menu items.'>
              Map each POS item to the recipe that makes it — venOS uses the recipe’s ingredient cost to calculate COGS automatically every sync. Choose <em>"No recipe"</em> for tips, fees, and other non-menu items.
            </Trans>
          </p>
        </div>

        {/* Auto-suggest legend */}
        {suggestedCount > 0 && (
          <div style={{ padding: '8px 26px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: '0.8rem', color: '#78350f' }}>
<i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> <Trans t={t} i18nKey="posMapping.suggestedLegend" count={suggestedCount} values={{ count: suggestedCount }} defaults="<1>{{count}} item(s)</1> were matched by AI — marked <3>suggested</3>. Review before saving.">
              <strong>{{ count: suggestedCount }} item(s)</strong> were matched by AI — marked <span style={{ background: '#fef3c7', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>suggested</span>. Review before saving.
            </Trans>
          </div>
        )}

        {/* Unmapped warning */}
        {unmappedCount > 0 && (
          <div style={{ padding: '8px 26px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: '0.8rem', color: '#c2410c' }}>
<i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> <Trans t={t} i18nKey="posMapping.unmappedWarning" count={unmappedCount} values={{ count: unmappedCount }} defaults="<1>{{count}} item(s)</1> have no recipe card — COGS will show as $0 for those.">
              <strong>{{ count: unmappedCount }} item(s)</strong> have no recipe card — COGS will show as $0 for those.
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
            {t('posMapping.empty', 'No POS catalog items found. Make sure your POS is connected and has items.')}
          </div>
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 400 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb', width: '45%' }}>{t('posMapping.colPosItem', 'POS Item')}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb' }}>{t('posMapping.colRecipe', 'Recipe (COGS)')}</th>
                </tr>
              </thead>
              <tbody>
                {orderedItems.map(item => {
                  const mapping = mappings.get(item.posItemId);
                  const isSuggested = mapping?.suggested ?? false;
                  const rowUnmapped = isUnmapped(mapping);
                  const displayLabel = item.variationName && item.variationName.toLowerCase() !== 'regular'
                    ? `${item.posItemName} — ${item.variationName}`
                    : item.posItemName;

                  return (
                    <tr key={item.posItemId} style={rowUnmapped ? { background: '#fff7ed' } : undefined}>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0', fontSize: '0.87rem', color: '#333', borderLeft: rowUnmapped ? '3px solid #f59e0b' : '3px solid transparent', fontWeight: rowUnmapped ? 600 : 400 }}>
                        {rowUnmapped && <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" style={{ color: '#f59e0b', marginRight: 6, fontSize: '0.78rem' }} />}
                        {displayLabel}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <Combobox
                              options={recipeOptions}
                              value={mapping?.recipeId ?? null}
                              onChange={id => setMapping(item.posItemId, { recipeId: id })}
                              highlight={isSuggested && !!mapping?.recipeId}
                              noneLabel={t('posMapping.noRecipe', '— No recipe —')}
                              placeholder={t('posMapping.searchRecipes', 'Search recipes…')}
                              noMatchesLabel={t('posMapping.noMatches', 'No matching recipes')}
                            />
                          </div>
                          {isSuggested && mapping?.recipeId && (
                            <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('posMapping.suggestedBadge', 'suggested')}</span>
                          )}
                        </div>
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
            title={t('posMapping.aiTitle', 'Let AI suggest matches for the unmapped items — mapped items are left untouched')}
          >
            {aiLoading && <span className="spinner" />} <span><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> {t('posMapping.suggestAiUnmapped', 'Suggest unmapped with AI')}</span>
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={onClose}>{t('posMapping.cancel', 'Cancel')}</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving && <span className="spinner" />} <span>{t('posMapping.save', 'Save Mappings')}</span>
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
              <span>{t('posMapping.aiWorkingTitle', 'Claude is matching your unmapped POS items…')}</span>
            </h3>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{t('posMapping.aiWorkingNote', 'Analyzing {{count}} unmapped item(s) against your recipes — already-mapped items are left untouched. This can take a minute or two.', { count: unmappedCount })}</span>
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
    </>
  );
}

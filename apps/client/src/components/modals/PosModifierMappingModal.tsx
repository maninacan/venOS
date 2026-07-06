import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation, Trans } from 'react-i18next';
import { showToast } from '@org/data';
import { Combobox } from '../Combobox';

const GET_AI_RECOMMENDATIONS = gql`
  query PosModifierMappingRecommendations($companyId: ID!) {
    posModifierMappingRecommendations(companyId: $companyId) {
      posModifierId recipeId inventoryId confidence reason
    }
  }
`;

const GET_DATA = gql`
  query GetPosModifierMappingData($companyId: ID!) {
    posModifierCatalog(companyId: $companyId) { posModifierId posModifierName price }
    recipes(companyId: $companyId) { id name totalCost }
    posModifierMappings(companyId: $companyId) { posModifierId inventoryItemId recipeId }
  }
`;
const SAVE_MAPPINGS = gql`
  mutation SavePosModifierMappings($companyId: ID!, $mappings: [PosModifierMappingInput!]!) {
    savePosModifierMappings(companyId: $companyId, mappings: $mappings)
  }
`;

interface CatalogItem { posModifierId: string; posModifierName: string; price?: number | null; }
interface RecipeItem { id: string; name: string; totalCost: number; }
// inventoryItemId is retained (loaded and saved back) so modifiers previously
// mapped to inventory aren't wiped — but it can no longer be set from this modal.
// Modifiers map to recipes only here.
interface Mapping { posModifierId: string; inventoryItemId: string | null; recipeId: string | null; suggested?: boolean; }

interface Props {
  companyId: string;
  onClose: () => void;
}

export function PosModifierMappingModal({ companyId, onClose }: Props) {
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

  const catalogItems: CatalogItem[] = data?.posModifierCatalog ?? [];
  const recipeItems: RecipeItem[] = data?.recipes ?? [];
  const existingMaps: Array<{ posModifierId: string; inventoryItemId: string | null; recipeId: string | null }> = data?.posModifierMappings ?? [];

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
        suggested: false,
      });
    }
    setMappings(m);
    setSortedIds(orderIds(m));
  }, [data]); // eslint-disable-line

  function setMapping(posModifierId: string, patch: Partial<Mapping>) {
    setMappings(prev => {
      const next = new Map(prev);
      const cur = next.get(posModifierId) ?? { posModifierId, inventoryItemId: null, recipeId: null };
      next.set(posModifierId, { ...cur, ...patch, posModifierId, suggested: false });
      return next;
    });
  }

  const isUnmapped = (m?: Mapping) => !m?.recipeId;

  // Order catalog rows with unmapped items first; Array.sort is stable so items
  // within each group keep their original catalog order.
  function orderIds(map: Map<string, Mapping>): string[] {
    return [...catalogItems]
      .sort((a, b) => Number(isUnmapped(map.get(b.posModifierId))) - Number(isUnmapped(map.get(a.posModifierId))))
      .map(i => i.posModifierId);
  }

  async function handleSuggestAI() {
    setAiLoading(true);
    try {
      const { data, error } = await fetchAiRecommendations({ variables: { companyId } });
      if (error) throw error;
      const recs: Array<{ posModifierId: string; recipeId: string | null; inventoryId: string | null }> =
        data?.posModifierMappingRecommendations ?? [];
      // Build the next map and count synchronously from current state — do NOT
      // count inside the setMappings updater, which React defers until render.
      let applied = 0;
      const next = new Map(mappings);
      for (const rec of recs) {
        const cur = next.get(rec.posModifierId) ?? { posModifierId: rec.posModifierId, inventoryItemId: null, recipeId: null };
        // Respect deliberate user choices — only fill blanks or replace prior suggestions.
        const userConfirmed = !cur.suggested && cur.recipeId;
        if (userConfirmed) continue;
        // Modifiers map to recipes only — ignore inventory-only recommendations.
        if (!rec.recipeId) continue;
        next.set(rec.posModifierId, {
          posModifierId: rec.posModifierId,
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
      }));
      await saveMappings({ variables: { companyId, mappings: mapsArray } });
      showToast(t('posModifierMapping.toast.saved', 'Modifier mappings saved! Cost calculations are now accurate.'), 'success', 5000);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posModifierMapping.toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSaving(false); }
  }

  const unmappedCount = Array.from(mappings.values()).filter(m => !m.recipeId).length;
  const suggestedCount = Array.from(mappings.values()).filter(m => m.suggested && m.recipeId).length;

  // Recipe options for the combobox — built once, shared by every row.
  const recipeOptions = recipeItems.map(r => ({ id: r.id, label: `${r.name} ($${Number(r.totalCost).toFixed(2)})` }));

  // Rows in display order (unmapped floated to top via the sortedIds snapshot).
  const catalogById = new Map(catalogItems.map(c => [c.posModifierId, c]));
  const orderedItems: CatalogItem[] = sortedIds.length
    ? sortedIds.map(id => catalogById.get(id)).filter((c): c is CatalogItem => !!c)
    : catalogItems;

  const aiSteps = [
    t('posModifierMapping.aiStep1', 'Reading your POS modifiers'),
    t('posModifierMapping.aiStep2', 'Comparing modifiers to your recipes'),
    t('posModifierMapping.aiStep3', 'Matching against inventory'),
    t('posModifierMapping.aiStep4', 'Scoring match confidence'),
    t('posModifierMapping.aiStep5', 'Finalizing suggestions'),
  ];
  const aiStepIndex = aiElapsed < 6 ? 0 : aiElapsed < 15 ? 1 : aiElapsed < 30 ? 2 : aiElapsed < 55 ? 3 : 4;

  return (
    <>
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 720, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', margin: '40px 16px' }}>
        {/* Header */}
        <div style={{ padding: '22px 26px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem', fontWeight: 700, color: 'var(--vv-navy)' }}>
            {t('posModifierMapping.title', 'Match Your POS Modifiers to Your Recipe Cards')}
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            <Trans t={t} i18nKey="posModifierMapping.description" defaults='Map each modifier (flavor add-ons, whip, …) to the recipe for its ingredients — venOS adds that cost to every drink the modifier is on, so COGS stays accurate without a separate menu item per flavor. Choose <2>"No recipe"</2> for free or no-cost modifiers.'>
              Map each modifier (flavor add-ons, whip, …) to the recipe for its ingredients — venOS adds that cost to every drink the modifier is on, so COGS stays accurate without a separate menu item per flavor. Choose <em>"No recipe"</em> for free or no-cost modifiers.
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
<i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> <Trans t={t} i18nKey="posModifierMapping.unmappedWarning" count={unmappedCount} values={{ count: unmappedCount }} defaults="<1>{{count}} modifier(s)</1> have no recipe card — their cost won’t be added to COGS.">
              <strong>{{ count: unmappedCount }} modifier(s)</strong> have no recipe card — their cost won’t be added to COGS.
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
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb', width: '45%' }}>{t('posModifierMapping.colModifier', 'Modifier')}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb' }}>{t('posModifierMapping.colRecipe', 'Recipe (COGS)')}</th>
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
                              options={recipeOptions}
                              value={mapping?.recipeId ?? null}
                              onChange={id => setMapping(item.posModifierId, { recipeId: id })}
                              highlight={isSuggested && !!mapping?.recipeId}
                              noneLabel={t('posModifierMapping.noRecipe', '— No recipe —')}
                              placeholder={t('posModifierMapping.searchRecipes', 'Search recipes…')}
                              noMatchesLabel={t('posModifierMapping.noMatches', 'No matching recipes')}
                            />
                          </div>
                          {isSuggested && mapping?.recipeId && (
                            <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('posModifierMapping.suggestedBadge', 'suggested')}</span>
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
            title={t('posModifierMapping.aiTitle', 'Let AI suggest matches for you to review')}
          >
            {aiLoading && <span className="spinner" />} <span><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> {t('posModifierMapping.suggestAi', 'Suggest with AI')}</span>
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
              <span>{t('posModifierMapping.aiWorkingTitle', 'Claude is matching your POS modifiers…')}</span>
            </h3>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{t('posModifierMapping.aiWorkingNote', 'Analyzing {{count}} modifiers against your recipes and inventory. This can take a minute or two.', { count: catalogItems.length })}</span>
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
                        ? <i className="fa-solid fa-spinner fa-spin" style={{ color: 'var(--vv-navy)' }} />
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

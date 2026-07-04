import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation, Trans } from 'react-i18next';
import { showToast } from '@org/data';

const GET_AI_RECOMMENDATIONS = gql`
  query PosMappingRecommendations($companyId: ID!) {
    posMappingRecommendations(companyId: $companyId) {
      posItemId recipeId inventoryId confidence reason
    }
  }
`;

const GET_DATA = gql`
  query GetPosMappingData($companyId: ID!) {
    posCatalog(companyId: $companyId) { posItemId posItemName variationName price }
    inventory(companyId: $companyId) { id name unitCost }
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
interface InventoryItem { id: string; name: string; unitCost: number; }
interface RecipeItem { id: string; name: string; totalCost: number; }
interface Mapping { posItemId: string; inventoryItemId: string | null; recipeId: string | null; suggested?: boolean; }

// Name similarity scorer — ported exactly from old app
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'for', 'with']);

function tokenize(str: string): Set<string> {
  return new Set(
    str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
  );
}

function scoreNameMatch(catalogItem: CatalogItem, inventoryName: string): number {
  const searchStr = catalogItem.variationName && catalogItem.variationName.toLowerCase() !== 'regular'
    ? `${catalogItem.posItemName} ${catalogItem.variationName}`
    : catalogItem.posItemName;
  const squareTokens = tokenize(searchStr);
  const invTokens = tokenize(inventoryName);
  if (!squareTokens.size || !invTokens.size) return 0;

  let overlap = 0;
  for (const t of squareTokens) { if (invTokens.has(t)) overlap++; }

  const variation = (catalogItem.variationName ?? '').toLowerCase().trim();
  if (variation && variation !== 'regular' && inventoryName.toLowerCase().includes(variation)) {
    overlap += 1.5;
  }
  return overlap / Math.max(squareTokens.size, invTokens.size);
}

function suggestMatch(catalogItem: CatalogItem, inventoryItems: InventoryItem[]): string | null {
  let best: { id: string; score: number } | null = null;
  for (const inv of inventoryItems) {
    const score = scoreNameMatch(catalogItem, inv.name);
    if (!best || score > best.score) best = { id: inv.id, score };
  }
  return best && best.score >= 0.45 ? best.id : null;
}

// Searchable picker used for both the Recipe and Inventory columns. Renders its
// dropdown with position:fixed so it isn't clipped by the modal's scrollable list.
function Combobox({ options, value, onChange, disabled, noneLabel, placeholder, noMatchesLabel, highlight }: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  noneLabel: string;
  placeholder: string;
  noMatchesLabel: string;
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find(o => o.id === value) ?? null;

  function place() {
    const el = inputRef.current;
    if (el) { const rc = el.getBoundingClientRect(); setCoords({ left: rc.left, top: rc.bottom + 2, width: rc.width }); }
  }
  function openMenu() { if (disabled) return; setQuery(''); place(); setOpen(true); }
  function closeMenu() { setOpen(false); setQuery(''); }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) closeMenu();
    };
    // Close when the page/modal scrolls (the fixed-position menu would detach),
    // but NOT when the user is scrolling inside the dropdown list itself.
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [open]);

  const filtered = options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={open ? query : (selected ? selected.label : '')}
        placeholder={selected ? selected.label : placeholder}
        onFocus={openMenu}
        onChange={e => { setQuery(e.target.value); if (!open) { place(); setOpen(true); } }}
        onKeyDown={e => {
          if (e.key === 'Escape') { closeMenu(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Enter' && filtered.length) { onChange(filtered[0].id); closeMenu(); (e.target as HTMLInputElement).blur(); }
        }}
        style={{ width: '100%', padding: '5px 8px', border: highlight ? '1.5px solid #f59e0b' : '1px solid #d1d5db', borderRadius: 6, fontSize: '0.83rem', background: disabled ? '#f3f4f6' : highlight ? '#fffbeb' : '#fff', opacity: disabled ? 0.6 : 1 }}
      />
      {open && coords && (
        <div ref={popRef} style={{ position: 'fixed', left: coords.left, top: coords.top, width: coords.width, maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', zIndex: 1000, fontSize: '0.83rem' }}>
          <div onMouseDown={e => { e.preventDefault(); onChange(null); closeMenu(); }}
            style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--muted)' }}>{noneLabel}</div>
          {filtered.map(o => (
            <div key={o.id} onMouseDown={e => { e.preventDefault(); onChange(o.id); closeMenu(); }}
              style={{ padding: '7px 10px', cursor: 'pointer', background: o.id === value ? '#eff6ff' : '#fff' }}>{o.label}</div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '7px 10px', color: 'var(--muted)' }}>{noMatchesLabel}</div>}
        </div>
      )}
    </div>
  );
}

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
  const inventoryItems: InventoryItem[] = data?.inventory ?? [];
  const recipeItems: RecipeItem[] = data?.recipes ?? [];
  const existingMaps: Array<{ posItemId: string; inventoryItemId: string | null; recipeId: string | null }> = data?.posMappings ?? [];

  // Initialize mappings: saved first, then auto-suggest inventory for unmapped
  useEffect(() => {
    if (!data) return;
    const m = new Map<string, Mapping>();
    const savedMap = new Map(existingMaps.map(e => [e.posItemId, e]));

    for (const item of catalogItems) {
      const saved = savedMap.get(item.posItemId);
      if (saved !== undefined) {
        m.set(item.posItemId, { posItemId: item.posItemId, inventoryItemId: saved.inventoryItemId ?? null, recipeId: saved.recipeId ?? null, suggested: false });
      } else {
        const suggestion = suggestMatch(item, inventoryItems);
        m.set(item.posItemId, { posItemId: item.posItemId, inventoryItemId: suggestion, recipeId: null, suggested: !!suggestion });
      }
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

  const isUnmapped = (m?: Mapping) => !m?.recipeId && !m?.inventoryItemId;

  // Order catalog rows with unmapped items first; Array.sort is stable so items
  // within each group keep their original catalog order.
  function orderIds(map: Map<string, Mapping>): string[] {
    return [...catalogItems]
      .sort((a, b) => Number(isUnmapped(map.get(b.posItemId))) - Number(isUnmapped(map.get(a.posItemId))))
      .map(i => i.posItemId);
  }

  async function handleSuggestAI() {
    setAiLoading(true);
    try {
      const { data, error } = await fetchAiRecommendations({ variables: { companyId } });
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
        // Respect deliberate user choices — only fill blanks or replace prior (name-based / AI) suggestions.
        const userConfirmed = !cur.suggested && (cur.recipeId || cur.inventoryItemId);
        if (userConfirmed) continue;
        if (!rec.recipeId && !rec.inventoryId) continue;
        next.set(rec.posItemId, {
          posItemId: rec.posItemId,
          recipeId: rec.recipeId ?? null,
          // Recipe wins for COGS; only carry an inventory suggestion when no recipe was matched.
          inventoryItemId: rec.recipeId ? null : (rec.inventoryId ?? null),
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

  const unmappedCount = Array.from(mappings.values()).filter(m => !m.inventoryItemId && !m.recipeId).length;
  const suggestedCount = Array.from(mappings.values()).filter(m => m.suggested && (m.inventoryItemId || m.recipeId)).length;

  // Option lists for the two comboboxes — built once, shared by every row.
  const recipeOptions = recipeItems.map(r => ({ id: r.id, label: `${r.name} ($${Number(r.totalCost).toFixed(2)})` }));
  const inventoryOptions = inventoryItems.map(i => ({
    id: i.id,
    label: t('posMapping.inventoryOption', '{{name}} (${{cost}}/unit)', { name: i.name, cost: Number(i.unitCost).toFixed(4) }),
  }));

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
            <Trans t={t} i18nKey="posMapping.description" defaults='Map each POS item to an inventory item once — venOS calculates costs automatically every sync. Use <2>"Not in my menu"</2> for tips, misc charges, etc.'>
              Map each POS item to an inventory item once — venOS calculates costs automatically every sync. Use <em>"Not in my menu"</em> for tips, misc charges, etc.
            </Trans>
          </p>
        </div>

        {/* Auto-suggest legend */}
        {suggestedCount > 0 && (
          <div style={{ padding: '8px 26px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: '0.8rem', color: '#78350f' }}>
<i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> <Trans t={t} i18nKey="posMapping.suggestedLegend" count={suggestedCount} values={{ count: suggestedCount }} defaults="<1>{{count}} item(s)</1> were auto-matched by name — marked <3>suggested</3>. Review before saving.">
              <strong>{{ count: suggestedCount }} item(s)</strong> were auto-matched by name — marked <span style={{ background: '#fef3c7', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>suggested</span>. Review before saving.
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
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb', width: '34%' }}>{t('posMapping.colPosItem', 'POS Item')}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb', width: '33%' }}>{t('posMapping.colRecipe', 'Recipe (COGS)')}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb' }}>{t('posMapping.colInventoryItem', 'Inventory Item (fallback)')}</th>
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
                        <Combobox
                          options={recipeOptions}
                          value={mapping?.recipeId ?? null}
                          onChange={id => setMapping(item.posItemId, { recipeId: id })}
                          noneLabel={t('posMapping.noRecipe', '— No recipe —')}
                          placeholder={t('posMapping.searchRecipes', 'Search recipes…')}
                          noMatchesLabel={t('posMapping.noMatches', 'No matching recipes')}
                        />
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }} title={mapping?.recipeId ? t('posMapping.recipeOverrides', 'Recipe cost is used when a recipe is selected') : undefined}>
                            <Combobox
                              options={inventoryOptions}
                              value={mapping?.inventoryItemId ?? null}
                              onChange={id => setMapping(item.posItemId, { inventoryItemId: id })}
                              disabled={!!mapping?.recipeId}
                              highlight={isSuggested && !mapping?.recipeId}
                              noneLabel={t('posMapping.notInMenu', '— Not in my menu —')}
                              placeholder={t('posMapping.searchInventory', 'Search inventory…')}
                              noMatchesLabel={t('posMapping.noInventoryMatches', 'No matching items')}
                            />
                          </div>
                          {isSuggested && !mapping?.recipeId && (
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
            title={t('posMapping.aiTitle', 'Let AI suggest matches for you to review')}
          >
            {aiLoading && <span className="spinner" />} <span><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> {t('posMapping.suggestAi', 'Suggest with AI')}</span>
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
              <span>{t('posMapping.aiWorkingTitle', 'Claude is matching your POS items…')}</span>
            </h3>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{t('posMapping.aiWorkingNote', 'Analyzing {{count}} POS items against your recipes and inventory. This can take a minute or two.', { count: catalogItems.length })}</span>
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

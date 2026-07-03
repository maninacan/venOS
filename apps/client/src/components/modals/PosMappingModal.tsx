import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation, Trans } from 'react-i18next';
import { showToast } from '@org/data';

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

interface Props {
  companyId: string;
  onClose: () => void;
}

export function PosMappingModal({ companyId, onClose }: Props) {
  const { t } = useTranslation('modals');
  const { data, loading } = useQuery(GET_DATA, { variables: { companyId } });
  const [saveMappings] = useMutation(SAVE_MAPPINGS);
  const [mappings, setMappings] = useState<Map<string, Mapping>>(new Map());
  const [saving, setSaving] = useState(false);

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
  }, [data]); // eslint-disable-line

  function setMapping(posItemId: string, patch: Partial<Mapping>) {
    setMappings(prev => {
      const next = new Map(prev);
      const cur = next.get(posItemId) ?? { posItemId, inventoryItemId: null, recipeId: null };
      next.set(posItemId, { ...cur, ...patch, posItemId, suggested: false });
      return next;
    });
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
      showToast(t('posMapping.toast.saved', '✅ Mappings saved! Cost calculations are now accurate.'), 'success', 5000);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('posMapping.toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSaving(false); }
  }

  const unmappedCount = Array.from(mappings.values()).filter(m => !m.inventoryItemId && !m.recipeId).length;
  const suggestedCount = Array.from(mappings.values()).filter(m => m.suggested && m.inventoryItemId).length;

  return (
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
            <Trans t={t} i18nKey="posMapping.suggestedLegend" count={suggestedCount} values={{ count: suggestedCount }} defaults="✨ <1>{{count}} item(s)</1> were auto-matched by name — marked <3>suggested</3>. Review before saving.">
              ✨ <strong>{{ count: suggestedCount }} item(s)</strong> were auto-matched by name — marked <span style={{ background: '#fef3c7', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>suggested</span>. Review before saving.
            </Trans>
          </div>
        )}

        {/* Unmapped warning */}
        {unmappedCount > 0 && (
          <div style={{ padding: '8px 26px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: '0.8rem', color: '#c2410c' }}>
            <Trans t={t} i18nKey="posMapping.unmappedWarning" count={unmappedCount} values={{ count: unmappedCount }} defaults="⚠️ <1>{{count}} item(s)</1> have no recipe card — COGS will show as $0 for those.">
              ⚠️ <strong>{{ count: unmappedCount }} item(s)</strong> have no recipe card — COGS will show as $0 for those.
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
                {catalogItems.map(item => {
                  const mapping = mappings.get(item.posItemId);
                  const isSuggested = mapping?.suggested ?? false;
                  const displayLabel = item.variationName && item.variationName.toLowerCase() !== 'regular'
                    ? `${item.posItemName} — ${item.variationName}`
                    : item.posItemName;

                  return (
                    <tr key={item.posItemId}>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0', fontSize: '0.87rem', color: '#333' }}>
                        {displayLabel}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0' }}>
                        <select
                          value={mapping?.recipeId ?? ''}
                          onChange={e => setMapping(item.posItemId, { recipeId: e.target.value || null })}
                          style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.83rem', background: '#fff' }}
                        >
                          <option value="">{t('posMapping.noRecipe', '— No recipe —')}</option>
                          {recipeItems.map(r => (
                            <option key={r.id} value={r.id}>{t('posMapping.recipeOption', '{{name}} (${{cost}})', { name: r.name, cost: Number(r.totalCost).toFixed(2) })}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: '1px solid #f0f0f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            value={mapping?.inventoryItemId ?? ''}
                            onChange={e => setMapping(item.posItemId, { inventoryItemId: e.target.value || null })}
                            disabled={!!mapping?.recipeId}
                            title={mapping?.recipeId ? t('posMapping.recipeOverrides', 'Recipe cost is used when a recipe is selected') : undefined}
                            style={{
                              flex: 1, padding: '5px 8px',
                              border: isSuggested ? '1.5px solid #f59e0b' : '1px solid #d1d5db',
                              borderRadius: 6, fontSize: '0.83rem',
                              background: mapping?.recipeId ? '#f3f4f6' : isSuggested ? '#fffbeb' : '#fff',
                              opacity: mapping?.recipeId ? 0.6 : 1,
                            }}
                          >
                            <option value="">{t('posMapping.notInMenu', '— Not in my menu —')}</option>
                            {inventoryItems.map(inv => (
                              <option key={inv.id} value={inv.id}>{t('posMapping.inventoryOption', '{{name}} (${{cost}}/unit)', { name: inv.name, cost: Number(inv.unitCost).toFixed(4) })}</option>
                            ))}
                          </select>
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
        <div style={{ padding: '14px 26px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fff' }}>
          <button className="btn-secondary" onClick={onClose}>{t('posMapping.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving && <span className="spinner" />} <span>{t('posMapping.save', 'Save Mappings')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useId, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface NewInventoryInput {
  name: string;
  category: string | null;
  unitCost: number;
  quantityOnHand: number;
  reorderThreshold: number;
  sku: string | null;
}

interface Props {
  /** Existing item names (for the duplicate/upsert warning). */
  existingNames: string[];
  /** Existing categories (for the autocomplete datalist). */
  categories: string[];
  /** Persist the item. Throw to surface an error in-modal; on success the modal closes. */
  onSave: (input: NewInventoryInput) => Promise<void>;
  onClose: () => void;
}

const norm = (s: string) => s.trim().toLowerCase();

// Manual "add inventory item" form. Saving upserts by (company, name) on the
// server, so a name matching an existing item updates it — we warn about that.
export function AddInventoryItemModal({ existingNames, categories, onSave, onClose }: Props) {
  const { t } = useTranslation('inventory');
  const listId = useId();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [quantityOnHand, setQuantityOnHand] = useState('');
  const [reorderThreshold, setReorderThreshold] = useState('');
  const [sku, setSku] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameSet = new Set(existingNames.map(norm));
  const isDuplicate = name.trim() !== '' && nameSet.has(norm(name));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        category: category.trim() || null,
        unitCost: parseFloat(unitCost) || 0,
        quantityOnHand: parseFloat(quantityOnHand) || 0,
        reorderThreshold: parseFloat(reorderThreshold) || 0,
        sku: sku.trim() || null,
      });
      // Success: parent closes.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
  const label: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        {!busy && <button className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></button>}
        <h3 style={{ margin: '0 0 14px', color: 'var(--vv-navy)' }}>{t('addModal.title', 'Add inventory item')}</h3>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={field}>
              <span style={label}>{t('addModal.name', 'Name')} *</span>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('addModal.namePlaceholder', 'e.g. Lemons')} autoFocus required disabled={busy} />
              {isDuplicate && (
                <span style={{ fontSize: '0.78rem', color: '#92400e' }}>
                  <i className="fa-solid fa-triangle-exclamation" /> {t('addModal.duplicateWarning', 'An item with this name already exists — saving will update it.')}
                </span>
              )}
            </div>

            <div style={field}>
              <span style={label}>{t('addModal.category', 'Category')}</span>
              <input type="text" value={category} onChange={e => setCategory(e.target.value)} placeholder={t('addModal.categoryPlaceholder', 'e.g. Produce')} list={listId} disabled={busy} />
              <datalist id={listId}>
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={field}>
                <span style={label}>{t('addModal.unitCost', 'Unit cost')}</span>
                <input type="number" step="0.0001" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0.0000" disabled={busy} />
              </div>
              <div style={field}>
                <span style={label}>{t('addModal.onHand', 'On hand')}</span>
                <input type="number" step="0.01" min="0" value={quantityOnHand} onChange={e => setQuantityOnHand(e.target.value)} placeholder="0" disabled={busy} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={field}>
                <span style={label}>{t('addModal.reorderAt', 'Reorder at')}</span>
                <input type="number" step="0.01" min="0" value={reorderThreshold} onChange={e => setReorderThreshold(e.target.value)} placeholder="0" disabled={busy} />
              </div>
              <div style={field}>
                <span style={label}>{t('addModal.sku', 'SKU')}</span>
                <input type="text" value={sku} onChange={e => setSku(e.target.value)} placeholder={t('addModal.skuPlaceholder', 'Optional')} disabled={busy} />
              </div>
            </div>
          </div>

          {error && <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t('addModal.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={!name.trim() || busy}>
              {busy && <span className="spinner" />} <span>{t('addModal.submit', 'Add item')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

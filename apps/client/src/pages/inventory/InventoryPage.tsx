import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { BackToSetupButton } from '../../components/guidance/BackToSetupButton';
import { showToast } from '@org/data';
import { useCurrency } from '../../i18n/useCurrency';
import { formatNumber } from '../../i18n/format';

const GET_INVENTORY = gql`
  query GetInventory($companyId: ID!) {
    inventory(companyId: $companyId) {
      id name category unitCost quantityOnHand reorderThreshold sku
    }
  }
`;
const UPDATE_ITEM = gql`
  mutation UpdateInventoryItem($id: ID!, $input: UpdateInventoryItemInput!) {
    updateInventoryItem(id: $id, input: $input) { id name unitCost quantityOnHand reorderThreshold }
  }
`;
const DELETE_ITEM = gql`
  mutation DeleteInventoryItem($id: ID!) { deleteInventoryItem(id: $id) }
`;
const CLEAR_ALL = gql`
  mutation ClearInventory($companyId: ID!) { clearInventory(companyId: $companyId) }
`;
const CREATE_ITEM = gql`
  mutation CreateInventoryItem($companyId: ID!, $input: CreateInventoryItemInput!) {
    createInventoryItem(companyId: $companyId, input: $input) { id name }
  }
`;

interface InventoryItem {
  id: string;
  name: string;
  category?: string | null;
  unitCost: number;
  quantityOnHand?: number | null;
  reorderThreshold?: number | null;
  sku?: string | null;
}

interface ImportedItem {
  tempId: string;
  name: string;
  category: string;
  unitCost: number;
  quantityOnHand: number;
  reorderThreshold: number;
  sku: string;
}

const API_URL = (import.meta.env['VITE_API_URL'] as string) || 'http://localhost:3000';

export function InventoryPage() {
  const { t } = useTranslation('inventory');
  const { currency } = useCurrency();
  // Unit cost is shown to 4 decimals (sub-cent precision), which the 2-decimal
  // currency formatter can't express — format as currency with 4 fraction digits.
  const fmtUnitCost = (v: number) =>
    formatNumber(v, { style: 'currency', currency, minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const { companyId } = useCurrentCompany();
  const aiFileInputRef = useRef<HTMLInputElement>(null);
  const streamOutputRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, loading, refetch } = useQuery(GET_INVENTORY, { variables: { companyId }, skip: !companyId });
  const [updateItem] = useMutation(UPDATE_ITEM);
  const [deleteItem] = useMutation(DELETE_ITEM);
  const [clearAll] = useMutation(CLEAR_ALL);
  const [createItem] = useMutation(CREATE_ITEM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // AI import state
  const [aiUploading, setAiUploading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingElapsed, setStreamingElapsed] = useState(0);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedItems, setImportedItems] = useState<ImportedItem[]>([]);
  const [approvingAll, setApprovingAll] = useState(false);

  useEffect(() => {
    if (streamOutputRef.current) streamOutputRef.current.scrollTop = streamOutputRef.current.scrollHeight;
  }, [streamingText]);

  useEffect(() => {
    if (isStreaming) {
      setStreamingElapsed(0);
      timerRef.current = setInterval(() => setStreamingElapsed(s => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming]);

  const items: InventoryItem[] = data?.inventory ?? [];
  const categories = [...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort();

  const filtered = items.filter(item => {
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  function startEdit(item: InventoryItem) {
    setEditingId(item.id);
    setEditVals({
      name: item.name,
      category: item.category ?? '',
      unitCost: String(item.unitCost),
      quantityOnHand: String(item.quantityOnHand ?? 0),
      reorderThreshold: String(item.reorderThreshold ?? 0),
      sku: item.sku ?? '',
    });
  }

  async function saveEdit(id: string) {
    try {
      await updateItem({
        variables: {
          id,
          input: {
            name: editVals['name'],
            category: editVals['category'] || null,
            unitCost: parseFloat(editVals['unitCost']) || 0,
            quantityOnHand: parseFloat(editVals['quantityOnHand']) || 0,
            reorderThreshold: parseFloat(editVals['reorderThreshold']) || 0,
            sku: editVals['sku'] || null,
          },
        },
      });
      setEditingId(null);
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.saveFailed', 'Failed to save'), 'error');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete', 'Delete this item?'))) return;
    await deleteItem({ variables: { id } });
    refetch();
  }

  async function handleClearAll() {
    if (!confirm(t('confirmClearAll', 'Delete ALL inventory items? This cannot be undone.'))) return;
    await clearAll({ variables: { companyId } });
    showToast(t('toast.cleared', 'Inventory cleared'), 'info');
    refetch();
  }

  async function handleAIUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiUploading(true);
    setIsStreaming(true);
    setStreamingText('');
    setStreamingError(null);
    let parseError = false;
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('companyId', companyId!);
      const { supabase } = await import('@org/data');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/uploads/inventory-ai`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      if (!res.ok) {
        const error = await res.json() as { error: string };
        throw new Error(error.error ?? t('toast.uploadFailed', 'Upload failed'));
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setStreamingText(fullText);
      }

      const stripped = fullText.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonEnd = stripped.lastIndexOf('}');
      const jsonText = jsonStart >= 0 && jsonEnd > jsonStart ? stripped.slice(jsonStart, jsonEnd + 1) : stripped;

      let parsed: { items?: Array<Partial<ImportedItem>> };
      try {
        parsed = JSON.parse(jsonText) as typeof parsed;
      } catch (parseErr) {
        parseError = true;
        const reason = parseErr instanceof SyntaxError ? parseErr.message : String(parseErr);
        setStreamingError(t('toast.parseFailed', 'JSON parse failed: {{reason}}\n\nThe output above is what Claude returned. It may be truncated or contain unexpected text.', { reason }));
        return;
      }

      if (!parsed.items?.length) {
        showToast(t('toast.noItemsFound', 'No items found in that file. Try a different file.'), 'warning');
        return;
      }
      setImportedItems(parsed.items.map(it => ({
        tempId: crypto.randomUUID(),
        name: it.name ?? '',
        category: it.category ?? '',
        unitCost: Number(it.unitCost) || 0,
        quantityOnHand: Number(it.quantityOnHand) || 0,
        reorderThreshold: Number(it.reorderThreshold) || 0,
        sku: it.sku ?? '',
      })));
      setShowImportModal(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.importFailed', 'Import failed'), 'error');
    } finally {
      setAiUploading(false);
      if (!parseError) setIsStreaming(false);
      if (aiFileInputRef.current) aiFileInputRef.current.value = '';
    }
  }

  function closeImportModal() {
    setShowImportModal(false);
    setImportedItems([]);
  }

  function updateImportedItem(tempId: string, field: keyof ImportedItem, value: string) {
    const numeric = field === 'unitCost' || field === 'quantityOnHand' || field === 'reorderThreshold';
    setImportedItems(prev => prev.map(it =>
      it.tempId === tempId ? { ...it, [field]: numeric ? (parseFloat(value) || 0) : value } : it
    ));
  }

  function deleteImportedItem(tempId: string) {
    setImportedItems(prev => prev.filter(it => it.tempId !== tempId));
  }

  async function handleApproveAll() {
    setApprovingAll(true);
    const inputs = importedItems
      .filter(it => it.name.trim())
      .map(it => ({
        name: it.name.trim(),
        category: it.category.trim() || null,
        unitCost: it.unitCost,
        quantityOnHand: it.quantityOnHand,
        reorderThreshold: it.reorderThreshold,
        sku: it.sku.trim() || null,
      }));
    let saved = 0, failed = 0;
    try {
      // Save concurrently (capped) instead of one round-trip at a time.
      const CONCURRENCY = 5;
      const queue = [...inputs];
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        let input: typeof inputs[number] | undefined;
        while ((input = queue.shift()) !== undefined) {
          try { await createItem({ variables: { companyId, input } }); saved++; }
          catch { failed++; }
        }
      }));

      refetch();
      if (failed === 0) {
        showToast(t('toast.saved', 'Saved {{count}} items!', { count: saved }), 'success', 5000);
        closeImportModal();
      } else {
        showToast(t('toast.savedWithFailures', 'Saved {{saved}}, but {{failed}} failed. Please retry the rest.', { saved, failed }), 'warning', 6000);
      }
    } finally { setApprovingAll(false); }
  }

  return (
    <>
      <BackToSetupButton />
      <div className="card">
        <div className="mb-4">
          <h2 className="mt-0 mb-1 text-[#0B2A4A]"><i className="fa-solid fa-box" aria-hidden="true" /> {t('heading', 'My Inventory')}{!loading && items.length > 0 && <span className="text-[#64748b] font-normal"> ({items.length})</span>}</h2>
          <p className="text-[#64748b] text-[0.86rem] m-0">{t('subtitle', 'Upload your product catalog once — venOS tracks stock and calculates COGS automatically after every Square sync.')}</p>
        </div>

        <div className="flex flex-wrap gap-2.5 mb-3.5 justify-between items-center">
          <div className="flex gap-2 items-center flex-wrap">
            <button className="btn-primary" onClick={() => aiFileInputRef.current?.click()} disabled={aiUploading}>
              {aiUploading ? <span className="spinner" /> : <i className="fa-solid fa-wand-magic-sparkles" />}
              <span>{aiUploading ? ` ${t('analyzing', 'Analyzing…')}` : ` ${t('aiImport', 'AI Import')}`}</span>
            </button>
            <input
              type="file"
              ref={aiFileInputRef}
              style={{ display: 'none' }}
              accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic"
              onChange={handleAIUpload}
            />
            <button className="btn-danger" onClick={handleClearAll}><i className="fa-solid fa-trash" /> {t('clearAll', 'Clear All')}</button>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input type="text" placeholder={t('searchPlaceholder', 'Search items…')} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ width: 150 }}>
              <option value="">{t('allCategories', 'All Categories')}</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {loading && <p className="text-[#64748b] text-[0.88rem]">{t('loading', 'Loading…')}</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-[#64748b] text-[0.86rem] py-8 text-center">
            {items.length === 0
              ? t('emptyNoItems', 'No inventory items yet — upload a CSV or items will appear here.')
              : t('emptyNoMatch', 'No items match your search.')}
          </p>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid var(--border)' }}>{t('table.item', 'Item')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid var(--border)' }}>{t('table.category', 'Category')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid var(--border)' }}>{t('table.unitCost', 'Unit Cost')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid var(--border)' }}>{t('table.onHand', 'On Hand')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid var(--border)' }}>{t('table.reorderAt', 'Reorder At')}</th>
                  <th style={{ padding: '8px 10px', borderBottom: '2px solid var(--border)' }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isEditing = editingId === item.id;
                  const isLow = (item.reorderThreshold ?? 0) > 0 && (item.quantityOnHand ?? 0) <= (item.reorderThreshold ?? 0);
                  return (
                    <tr key={item.id} style={{ background: isLow ? '#fffbeb' : undefined }}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                        {isEditing
                          ? <input type="text" value={editVals['name']} onChange={e => setEditVals(v => ({ ...v, name: e.target.value }))} style={{ width: '100%' }} />
                          : <><strong>{item.name}</strong>{isLow && <span style={{ marginLeft: 6, fontSize: '0.72rem', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 99 }}>{t('low', 'LOW')}</span>}</>}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                        {isEditing
                          ? <input type="text" value={editVals['category']} onChange={e => setEditVals(v => ({ ...v, category: e.target.value }))} style={{ width: 110 }} />
                          : item.category ?? '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>
                        {isEditing
                          ? <input type="number" step="0.0001" value={editVals['unitCost']} onChange={e => setEditVals(v => ({ ...v, unitCost: e.target.value }))} style={{ width: 80, textAlign: 'right' }} />
                          : fmtUnitCost(Number(item.unitCost))}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>
                        {isEditing
                          ? <input type="number" step="0.01" value={editVals['quantityOnHand']} onChange={e => setEditVals(v => ({ ...v, quantityOnHand: e.target.value }))} style={{ width: 70, textAlign: 'right' }} />
                          : Number(item.quantityOnHand ?? 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>
                        {isEditing
                          ? <input type="number" step="0.01" value={editVals['reorderThreshold']} onChange={e => setEditVals(v => ({ ...v, reorderThreshold: e.target.value }))} style={{ width: 70, textAlign: 'right' }} />
                          : Number(item.reorderThreshold ?? 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '3px 8px' }} onClick={() => saveEdit(item.id)}>{t('save', 'Save')}</button>
                            <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '3px 8px' }} onClick={() => setEditingId(null)}>{t('cancel', 'Cancel')}</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '3px 8px' }} onClick={() => startEdit(item)}><i className="fa-solid fa-pen-to-square" /></button>
                            <button className="btn-danger-subtle" style={{ fontSize: '0.78rem', padding: '3px 8px' }} onClick={() => handleDelete(item.id)}><i className="fa-solid fa-trash" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '8px 0 0', textAlign: 'right' }}>{t('itemCount', '{{count}} items', { count: filtered.length })}</p>
          </div>
        )}
      </div>

      {/* Streaming output window */}
      {isStreaming && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', height: 'min(85vh, 640px)', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '24px 28px 12px', flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 4px', color: streamingError ? 'var(--danger)' : 'var(--vv-navy)' }}>
                {streamingError
                  ? <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
                  : <span className="spinner spinner-dark" style={{ width: 16, height: 16, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />}
                <span>{streamingError ? t('streaming.parseErrorTitle', 'Parse Error — Raw Output') : t('streaming.analyzingTitle', 'Claude is analyzing your file…')}</span>
              </h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{streamingError ?? t('streaming.largeFileNote', 'This may take a few minutes for large files.')}</span>
                {!streamingError && (
                  <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.88rem', color: 'var(--vv-navy)', fontWeight: 600 }}>
                    {`${Math.floor(streamingElapsed / 60)}:${String(streamingElapsed % 60).padStart(2, '0')}`}
                  </span>
                )}
              </p>
            </div>
            <div
              ref={streamOutputRef}
              style={{ flex: 1, overflowY: 'auto', background: '#0f172a', margin: '0 28px', borderRadius: 8, padding: '12px 14px', fontFamily: 'monospace', fontSize: '0.75rem', color: streamingError ? '#fca5a5' : '#86efac', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
            >
              {streamingText}
            </div>
            <div style={{ padding: '12px 28px 24px', flexShrink: 0 }}>
              {streamingError && (
                <button className="btn-secondary" onClick={() => { setIsStreaming(false); setStreamingError(null); }}>
                  <span>{t('streaming.close', 'Close')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Import Review Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeImportModal(); }}>
          <div className="modal-box" style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', height: 'min(90vh, 820px)', padding: 0, overflow: 'hidden' }}>
            <button className="modal-close" onClick={closeImportModal}><i className="fa-solid fa-xmark" /></button>
            <div style={{ padding: '28px 28px 12px', flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 4px' }}>
                <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--vv-navy)', marginRight: 8 }} />
                <span>{t('review.title', 'Review AI-Parsed Inventory')}</span>
              </h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                {t('review.detected', '{{count}} items detected. Edit or delete any before saving. Existing items with the same name will be updated.', { count: importedItems.length })}
              </p>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '0 28px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 90px 80px 80px 1fr 28px', gap: '6px 8px', fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, position: 'sticky', top: 0, background: '#fff', padding: '6px 0' }}>
                <span>{t('review.name', 'Name')}</span>
                <span>{t('review.category', 'Category')}</span>
                <span style={{ textAlign: 'right' }}>{t('review.unitCost', 'Unit Cost')}</span>
                <span style={{ textAlign: 'right' }}>{t('review.onHand', 'On Hand')}</span>
                <span style={{ textAlign: 'right' }}>{t('review.reorder', 'Reorder')}</span>
                <span>{t('review.sku', 'SKU')}</span>
                <span />
              </div>
              {importedItems.map(it => (
                <div key={it.tempId} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 90px 80px 80px 1fr 28px', gap: '4px 8px', marginBottom: 4, alignItems: 'center' }}>
                  <input type="text" value={it.name} onChange={e => updateImportedItem(it.tempId, 'name', e.target.value)} placeholder={t('review.namePlaceholder', 'Item name')} style={{ fontSize: '0.83rem' }} />
                  <input type="text" value={it.category} onChange={e => updateImportedItem(it.tempId, 'category', e.target.value)} placeholder={t('review.categoryPlaceholder', 'Category')} style={{ fontSize: '0.83rem' }} />
                  <input type="number" step="0.0001" value={it.unitCost} onChange={e => updateImportedItem(it.tempId, 'unitCost', e.target.value)} style={{ fontSize: '0.83rem', textAlign: 'right' }} />
                  <input type="number" step="0.01" value={it.quantityOnHand} onChange={e => updateImportedItem(it.tempId, 'quantityOnHand', e.target.value)} style={{ fontSize: '0.83rem', textAlign: 'right' }} />
                  <input type="number" step="0.01" value={it.reorderThreshold} onChange={e => updateImportedItem(it.tempId, 'reorderThreshold', e.target.value)} style={{ fontSize: '0.83rem', textAlign: 'right' }} />
                  <input type="text" value={it.sku} onChange={e => updateImportedItem(it.tempId, 'sku', e.target.value)} placeholder={t('review.skuPlaceholder', 'SKU')} style={{ fontSize: '0.83rem' }} />
                  <button onClick={() => deleteImportedItem(it.tempId)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}><i className="fa-solid fa-xmark" /></button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '14px 28px 28px', borderTop: '1px solid rgba(11,42,74,0.08)', flexShrink: 0 }}>
              <button className="btn-primary" onClick={handleApproveAll} disabled={approvingAll || importedItems.length === 0}>
                {approvingAll && <span className="spinner" />}
                <span><i className="fa-solid fa-check" /> {t('review.approveAll', 'Approve All ({{count}})', { count: importedItems.length })}</span>
              </button>
              <button className="btn-danger-subtle" onClick={closeImportModal} disabled={approvingAll}>
                <span><i className="fa-solid fa-trash" /> {t('review.discardBatch', 'Discard Batch')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

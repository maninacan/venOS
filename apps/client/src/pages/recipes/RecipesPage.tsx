import { useState, useRef, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { BackToSetupButton } from '../../components/guidance/BackToSetupButton';
import { showToast } from '@org/data';
import { useCurrency } from '../../i18n/useCurrency';
import { formatNumber } from '../../i18n/format';
import { Combobox } from '../../components/Combobox';

const API_URL = (import.meta.env['VITE_API_URL'] as string) || 'http://localhost:3000';

const COMPONENT_FIELDS = 'id componentType refRecipeId refModifierId refInventoryId quantity name cost';
const GET_RECIPES = gql`
  query GetRecipes($companyId: ID!) {
    recipes(companyId: $companyId) {
      id name totalCost
      ingredients { id name quantity unitCost unit }
      components { ${COMPONENT_FIELDS} }
    }
  }
`;
// Options for the sub-recipe component pickers (inventory items + mapped modifiers).
// Referenceable recipes come from the recipes query above.
const GET_COMPONENT_OPTIONS = gql`
  query GetRecipeComponentOptions($companyId: ID!) {
    inventory(companyId: $companyId) { id name unitCost }
    posModifierMappings(companyId: $companyId) { id posModifierName inventoryItemId quantity }
    posMappings(companyId: $companyId) { recipeId }
  }
`;
const OPT_LINE = 'name quantity unitCost unit';
const GET_OPTIMIZE = gql`
  query RecipeOptimization($companyId: ID!, $recipeIds: [ID!]) {
    recipeOptimizationRecommendations(companyId: $companyId, recipeIds: $recipeIds) {
      recipeId recipeName kind baseFamilyKey baseExistingRecipeId baseNewName
      baseNewIngredients { ${OPT_LINE} } addonKeepIngredients { ${OPT_LINE} }
      addonModifierId addonInventoryId addonQuantity
      baseName addonLabel beforeCost afterCost confidence reason
    }
  }
`;
const APPLY_OPTIMIZE = gql`
  mutation ApplyRecipeOptimizations($companyId: ID!, $accepted: [RecipeOptimizationInput!]!) {
    applyRecipeOptimizations(companyId: $companyId, accepted: $accepted)
  }
`;
const CREATE_RECIPE = gql`
  mutation CreateRecipe($companyId: ID!, $input: CreateRecipeInput!) {
    createRecipe(companyId: $companyId, input: $input) { id name totalCost ingredients { id name quantity unitCost unit } components { ${COMPONENT_FIELDS} } }
  }
`;
const CREATE_RECIPES = gql`
  mutation CreateRecipes($companyId: ID!, $inputs: [CreateRecipeInput!]!) {
    createRecipes(companyId: $companyId, inputs: $inputs) { id name totalCost ingredients { id name quantity unitCost unit } components { ${COMPONENT_FIELDS} } }
  }
`;
const UPDATE_RECIPE = gql`
  mutation UpdateRecipe($id: ID!, $input: CreateRecipeInput!) {
    updateRecipe(id: $id, input: $input) { id name totalCost ingredients { id name quantity unitCost unit } components { ${COMPONENT_FIELDS} } }
  }
`;
const DELETE_RECIPE = gql`
  mutation DeleteRecipe($id: ID!) { deleteRecipe(id: $id) }
`;

type ComponentType = 'recipe' | 'modifier' | 'inventory';
interface Ingredient { id?: string; name: string; quantity: number; unitCost: number; unit: string; }
interface Component { componentType: ComponentType; refRecipeId: string | null; refModifierId: string | null; refInventoryId: string | null; quantity: number; }
interface Recipe { id: string; name: string; totalCost: number; ingredients: Ingredient[]; components?: Array<Component & { id?: string; name?: string; cost?: number }>; }
interface ImportedRecipe { tempId: string; name: string; ingredients: Ingredient[]; }
interface OptLine { name: string; quantity: number; unitCost: number; unit: string | null; }
interface RecipeOptimization {
  recipeId: string; recipeName: string; kind: 'variant' | 'distinct';
  baseFamilyKey: string | null; baseExistingRecipeId: string | null; baseNewName: string | null;
  baseNewIngredients: OptLine[]; addonKeepIngredients: OptLine[];
  addonModifierId: string | null; addonInventoryId: string | null; addonQuantity: number;
  baseName: string | null; addonLabel: string | null; beforeCost: number | null; afterCost: number | null;
  confidence: number | null; reason: string | null;
}

const emptyIngredient = (): Ingredient => ({ name: '', quantity: 1, unitCost: 0, unit: '' });
const emptyComponent = (): Component => ({ componentType: 'recipe', refRecipeId: null, refModifierId: null, refInventoryId: null, quantity: 1 });

export function RecipesPage() {
  const { t } = useTranslation('recipes');
  const { currency } = useCurrency();
  // Recipe/ingredient costs are shown to 4 decimals (sub-cent precision), which
  // the 2-decimal currency formatter can't express — format with 4 fraction digits.
  const fmtCost = (v: number) =>
    formatNumber(v, { style: 'currency', currency, minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const { companyId } = useCurrentCompany();
  const { data, loading, refetch } = useQuery(GET_RECIPES, { variables: { companyId }, skip: !companyId });
  const { data: optData } = useQuery(GET_COMPONENT_OPTIONS, { variables: { companyId }, skip: !companyId });
  const [fetchOptimizations] = useLazyQuery(GET_OPTIMIZE);
  const [applyOptimizations] = useMutation(APPLY_OPTIMIZE);
  const [createRecipe] = useMutation(CREATE_RECIPE);
  const [createRecipes] = useMutation(CREATE_RECIPES);
  const [updateRecipe] = useMutation(UPDATE_RECIPE);
  const [deleteRecipe] = useMutation(DELETE_RECIPE);

  // Recipe edit form modal state
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState('');
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const [components, setComponents] = useState<Component[]>([]);
  const [saving, setSaving] = useState(false);

  // AI "Optimize recipes" state
  const [showOptimize, setShowOptimize] = useState(false);
  const [optScope, setOptScope] = useState<'all' | 'mapped'>('all');
  const [optLoading, setOptLoading] = useState(false);
  const [optRecs, setOptRecs] = useState<RecipeOptimization[] | null>(null);
  const [optAccepted, setOptAccepted] = useState<Set<string>>(new Set());
  const [optApplying, setOptApplying] = useState(false);
  const [optElapsed, setOptElapsed] = useState(0);
  const optTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (optLoading) {
      setOptElapsed(0);
      optTimerRef.current = setInterval(() => setOptElapsed(s => s + 1), 1000);
    } else if (optTimerRef.current) {
      clearInterval(optTimerRef.current); optTimerRef.current = null;
    }
    return () => { if (optTimerRef.current) clearInterval(optTimerRef.current); };
  }, [optLoading]);

  // Card vs. tabular view — persisted so the choice sticks across visits.
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(
    () => (localStorage.getItem('recipesViewMode') === 'table' ? 'table' : 'cards')
  );
  useEffect(() => { localStorage.setItem('recipesViewMode', viewMode); }, [viewMode]);

  // Which table rows are expanded to show their ingredient sub-rows.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // AI import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamOutputRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [streamingElapsed, setStreamingElapsed] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedRecipes, setImportedRecipes] = useState<ImportedRecipe[]>([]);
  const [approvingAll, setApprovingAll] = useState(false);
  const [importEditing, setImportEditing] = useState<string | null>(null);
  const [importEditName, setImportEditName] = useState('');
  const [importEditIngredients, setImportEditIngredients] = useState<Ingredient[]>([emptyIngredient()]);

  useEffect(() => {
    if (streamOutputRef.current) {
      streamOutputRef.current.scrollTop = streamOutputRef.current.scrollHeight;
    }
  }, [streamingText]);

  useEffect(() => {
    if (isStreaming) {
      setStreamingElapsed(0);
      timerRef.current = setInterval(() => setStreamingElapsed(s => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming]);

  const recipes: Recipe[] = data?.recipes ?? [];

  function openNew() {
    setIsNew(true);
    setEditing(null);
    setName('');
    setIngredients([emptyIngredient()]);
    setComponents([]);
  }

  function openEdit(recipe: Recipe) {
    setIsNew(false);
    setEditing(recipe);
    setName(recipe.name);
    setIngredients(recipe.ingredients.length > 0 ? recipe.ingredients : [emptyIngredient()]);
    setComponents((recipe.components ?? []).map(c => ({
      componentType: c.componentType,
      refRecipeId: c.refRecipeId ?? null,
      refModifierId: c.refModifierId ?? null,
      refInventoryId: c.refInventoryId ?? null,
      quantity: c.quantity,
    })));
  }

  function closeForm() { setEditing(null); setIsNew(false); }

  function updateIngredient(i: number, field: keyof Ingredient, value: string | number) {
    setIngredients(prev => prev.map((ing, j) => j === i ? { ...ing, [field]: value } : ing));
  }
  function addIngredient() { setIngredients(prev => [...prev, emptyIngredient()]); }
  function removeIngredient(i: number) { setIngredients(prev => prev.filter((_, j) => j !== i)); }

  function setComponent(i: number, patch: Partial<Component>) {
    setComponents(prev => prev.map((c, j) => {
      if (j !== i) return c;
      const next = { ...c, ...patch };
      // Changing type clears the other refs so only the active one is set.
      if (patch.componentType && patch.componentType !== c.componentType) {
        next.refRecipeId = null; next.refModifierId = null; next.refInventoryId = null;
      }
      return next;
    }));
  }
  function addComponent() { setComponents(prev => [...prev, emptyComponent()]); }
  function removeComponent(i: number) { setComponents(prev => prev.filter((_, j) => j !== i)); }

  // Component option lookups (cost + label) built from the recipes + options queries.
  const invById = new Map<string, { name: string; unitCost: number }>(
    ((optData?.inventory ?? []) as Array<{ id: string; name: string; unitCost: number }>).map(i => [i.id, { name: i.name, unitCost: Number(i.unitCost) }]));
  const modById = new Map<string, { name: string; cost: number }>(
    ((optData?.posModifierMappings ?? []) as Array<{ id: string; posModifierName: string; inventoryItemId: string | null; quantity: number | null }>).map(m => {
      const unit = m.inventoryItemId ? invById.get(m.inventoryItemId)?.unitCost ?? 0 : 0;
      return [m.id, { name: m.posModifierName, cost: unit * (m.quantity == null ? 1 : Number(m.quantity)) }];
    }));
  const recipeCostById = new Map<string, { name: string; cost: number }>(
    ((data?.recipes ?? []) as Recipe[]).map(r => [r.id, { name: r.name, cost: Number(r.totalCost) }]));

  const recipeOptions = ((data?.recipes ?? []) as Recipe[])
    .filter(r => r.id !== editing?.id) // can't reference the recipe being edited (cycle)
    .map(r => ({ id: r.id, label: `${r.name} (${fmtCost(Number(r.totalCost))})` }));
  const modifierOptions = Array.from(modById.entries()).map(([id, m]) => ({ id, label: `${m.name} (${fmtCost(m.cost)}/use)` }));
  const inventoryOptions = Array.from(invById.entries()).map(([id, i]) => ({ id, label: `${i.name} (${fmtCost(i.unitCost)}/unit)` }));

  // Resolved cost of one component row (null when nothing is picked yet).
  function componentCost(c: Component): number | null {
    const q = Number(c.quantity) || 0;
    if (c.componentType === 'recipe' && c.refRecipeId) return (recipeCostById.get(c.refRecipeId)?.cost ?? 0) * q;
    if (c.componentType === 'modifier' && c.refModifierId) return (modById.get(c.refModifierId)?.cost ?? 0) * q;
    if (c.componentType === 'inventory' && c.refInventoryId) return (invById.get(c.refInventoryId)?.unitCost ?? 0) * q;
    return null;
  }

  const ingredientsCost = ingredients.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitCost) || 0), 0);
  const componentsCost = components.reduce((s, c) => s + (componentCost(c) ?? 0), 0);
  const totalCost = ingredientsCost + componentsCost;

  async function handleSave() {
    if (!name.trim()) { showToast(t('toast.nameRequired', 'Recipe name required'), 'error'); return; }
    setSaving(true);
    // Keep only components with a reference actually selected for their type.
    const cleanComponents = components
      .filter(c => (c.componentType === 'recipe' && c.refRecipeId) || (c.componentType === 'modifier' && c.refModifierId) || (c.componentType === 'inventory' && c.refInventoryId))
      .map(c => ({
        componentType: c.componentType,
        refRecipeId: c.componentType === 'recipe' ? c.refRecipeId : null,
        refModifierId: c.componentType === 'modifier' ? c.refModifierId : null,
        refInventoryId: c.componentType === 'inventory' ? c.refInventoryId : null,
        quantity: Number(c.quantity),
      }));
    const input = {
      name: name.trim(),
      ingredients: ingredients.filter(i => i.name.trim()).map(({ id: _id, ...i }) => ({ ...i, quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
      components: cleanComponents,
    };
    try {
      if (isNew) {
        await createRecipe({ variables: { companyId, input } });
        showToast(t('toast.created', 'Recipe created!'), 'success');
      } else if (editing) {
        await updateRecipe({ variables: { id: editing.id, input } });
        showToast(t('toast.updated', 'Recipe updated!'), 'success');
      }
      refetch();
      closeForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string, recipeName: string) {
    if (!confirm(t('confirmDelete', 'Delete "{{name}}"?', { name: recipeName }))) return;
    try {
      await deleteRecipe({ variables: { id } });
      showToast(t('toast.deleted', 'Recipe deleted'), 'info');
      refetch();
    } catch { showToast(t('toast.deleteFailed', 'Failed to delete'), 'error'); }
  }

  function openOptimize() { setShowOptimize(true); setOptRecs(null); setOptAccepted(new Set()); setOptScope('all'); }
  function closeOptimize() { setShowOptimize(false); setOptLoading(false); }

  async function runOptimize() {
    setOptLoading(true);
    setOptRecs(null);
    try {
      // Scope: all recipes (null) or only those mapped to a POS item.
      let recipeIds: string[] | null = null;
      if (optScope === 'mapped') {
        recipeIds = Array.from(new Set(((optData?.posMappings ?? []) as Array<{ recipeId: string | null }>)
          .map(m => m.recipeId).filter((id): id is string => !!id)));
        if (recipeIds.length === 0) {
          showToast(t('optimize.noMapped', 'No POS-mapped recipes to analyze.'), 'info', 5000);
          setOptLoading(false); return;
        }
      }
      const { data, error } = await fetchOptimizations({ variables: { companyId, recipeIds } });
      if (error) throw error;
      const recs = (data?.recipeOptimizationRecommendations ?? []) as RecipeOptimization[];
      setOptRecs(recs);
      // Default-accept every recommended variant; distinct recipes aren't actionable.
      setOptAccepted(new Set(recs.filter(r => r.kind === 'variant').map(r => r.recipeId)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('optimize.failed', 'Optimization failed. Please try again.'), 'error');
    } finally { setOptLoading(false); }
  }

  const optVariants = (optRecs ?? []).filter(r => r.kind === 'variant');
  const optDistinctCount = (optRecs ?? []).filter(r => r.kind === 'distinct').length;
  function toggleAccept(id: string) {
    setOptAccepted(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function acceptAll() { setOptAccepted(new Set(optVariants.map(r => r.recipeId))); }
  function acceptNone() { setOptAccepted(new Set()); }

  async function handleApplyOptimize() {
    const chosen = optVariants.filter(r => optAccepted.has(r.recipeId));
    if (chosen.length === 0) { showToast(t('optimize.selectSome', 'Select at least one change to apply.'), 'info'); return; }
    setOptApplying(true);
    try {
      const line = (l: OptLine) => ({ name: l.name, quantity: Number(l.quantity), unitCost: Number(l.unitCost), unit: l.unit ?? null });
      const accepted = chosen.map(r => ({
        recipeId: r.recipeId,
        baseFamilyKey: r.baseFamilyKey,
        baseExistingRecipeId: r.baseExistingRecipeId,
        baseNewName: r.baseNewName,
        baseNewIngredients: r.baseNewIngredients.map(line),
        addonKeepIngredients: r.addonKeepIngredients.map(line),
        addonModifierId: r.addonModifierId,
        addonInventoryId: r.addonInventoryId,
        addonQuantity: Number(r.addonQuantity),
      }));
      await applyOptimizations({ variables: { companyId, accepted } });
      showToast(t('optimize.applied', 'Applied {{count}} change(s).', { count: chosen.length }), 'success', 5000);
      refetch();
      closeOptimize();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('optimize.applyFailed', 'Failed to apply changes'), 'error');
    } finally { setOptApplying(false); }
  }

  async function handleAIUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
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
      const res = await fetch(`${API_URL}/api/uploads/recipes-ai`, {
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
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamingText(fullText);
      }

      // Strip code fences, then find the outermost JSON object in case Claude
      // added explanation text before or after the JSON.
      const stripped = fullText.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonEnd = stripped.lastIndexOf('}');
      const jsonText = jsonStart >= 0 && jsonEnd > jsonStart
        ? stripped.slice(jsonStart, jsonEnd + 1)
        : stripped;

      let parsed: { recipes?: Array<{ name: string; ingredients: Ingredient[] }> };
      try {
        parsed = JSON.parse(jsonText) as typeof parsed;
      } catch (parseErr) {
        parseError = true;
        const reason = parseErr instanceof SyntaxError ? parseErr.message : String(parseErr);
        setStreamingError(t('toast.parseFailed', 'JSON parse failed: {{reason}}\n\nThe output above is what Claude returned. It may be truncated or contain unexpected text.', { reason }));
        return;
      }

      if (!parsed.recipes?.length) {
        parseError = true;
        setStreamingError(t('toast.noRecipesFound', 'Claude could not find any recipes in this file.\n\nThe output above is what Claude returned. Check if your CSV has recognizable recipe names and ingredient rows.'));
        return;
      }
      setImportedRecipes(parsed.recipes.map(r => ({ ...r, tempId: crypto.randomUUID() })));
      setShowImportModal(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.importFailed', 'Import failed'), 'error');
    } finally {
      setUploading(false);
      if (!parseError) setIsStreaming(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function closeImportModal() {
    setShowImportModal(false);
    setImportedRecipes([]);
    setImportEditing(null);
  }

  function startImportEdit(recipe: ImportedRecipe) {
    setImportEditing(recipe.tempId);
    setImportEditName(recipe.name);
    setImportEditIngredients(recipe.ingredients.length > 0 ? recipe.ingredients : [emptyIngredient()]);
  }

  function saveImportEdit() {
    setImportedRecipes(prev => prev.map(r =>
      r.tempId === importEditing
        ? { ...r, name: importEditName.trim() || r.name, ingredients: importEditIngredients }
        : r
    ));
    setImportEditing(null);
  }

  function deleteImportedRecipe(tempId: string) {
    setImportedRecipes(prev => prev.filter(r => r.tempId !== tempId));
  }

  function updateImportIngredient(i: number, field: keyof Ingredient, value: string | number) {
    setImportEditIngredients(prev => prev.map((ing, j) => j === i ? { ...ing, [field]: value } : ing));
  }

  async function handleApproveAll() {
    setApprovingAll(true);
    // Coerce numbers to finite values — a NaN (e.g. an unparseable "$0.50") can't be
    // serialized as a GraphQL Float! and would otherwise reject the whole request.
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const inputs = importedRecipes.map(recipe => ({
      name: recipe.name.trim(),
      ingredients: recipe.ingredients
        .filter(i => i.name.trim())
        .map(({ id: _id, ...i }) => ({ ...i, quantity: num(i.quantity), unitCost: num(i.unitCost) })),
    }));
    let saved = 0, failed = 0;
    try {
      // Save in bulk — one mutation per chunk instead of one round-trip per recipe.
      // Chunking keeps any single request bounded for very large imports.
      const CHUNK_SIZE = 50;
      for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
        const chunk = inputs.slice(i, i + CHUNK_SIZE);
        try {
          const { data } = await createRecipes({ variables: { companyId, inputs: chunk } });
          saved += data?.createRecipes?.length ?? chunk.length;
        } catch (bulkErr) {
          // Bulk failed for the whole chunk — fall back to saving each recipe on its
          // own so one bad recipe (or an unavailable bulk endpoint) can't sink the rest.
          console.error('Bulk createRecipes failed, falling back to per-recipe save:', bulkErr);
          for (const input of chunk) {
            try { await createRecipe({ variables: { companyId, input } }); saved++; }
            catch (oneErr) { failed++; console.error('createRecipe failed:', input.name, oneErr); }
          }
        }
      }

      refetch();
      if (failed === 0) {
        showToast(t('toast.saved', 'Saved {{count}} recipes!', { count: saved }), 'success', 5000);
        closeImportModal();
      } else {
        showToast(t('toast.savedWithFailures', 'Saved {{saved}}, but {{failed}} failed. Please retry the rest.', { saved, failed }), 'warning', 6000);
      }
    } finally { setApprovingAll(false); }
  }

  const importEditCost = importEditIngredients.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitCost) || 0), 0);

  return (
    <>
      <BackToSetupButton />
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--vv-navy)' }}><i className="fa-solid fa-lemon" aria-hidden="true" /> {t('heading', 'Recipes')}{!loading && recipes.length > 0 && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({recipes.length})</span>}</h2>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem' }}>
              {t('subtitle', 'Define ingredient costs for each dish. venOS uses these to calculate COGS automatically when you sync Square sales.')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {recipes.length > 0 && (
              <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden' }} role="group" aria-label={t('viewToggle', 'View')}>
                {(['cards', 'table'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    title={mode === 'cards' ? t('viewCards', 'Card view') : t('viewTable', 'Table view')}
                    aria-pressed={viewMode === mode}
                    style={{
                      border: 'none', cursor: 'pointer', padding: '6px 12px', fontSize: '0.85rem',
                      background: viewMode === mode ? 'var(--vv-navy)' : '#fff',
                      color: viewMode === mode ? '#fff' : 'var(--muted)',
                    }}
                  >
                    <i className={mode === 'cards' ? 'fa-solid fa-table-cells-large' : 'fa-solid fa-table-list'} />
                  </button>
                ))}
              </div>
            )}
            <button className="btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <i className={uploading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles'} />
              {uploading ? ` ${t('analyzing', 'Analyzing…')}` : ` ${t('aiImport', 'AI Import')}`}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic"
              onChange={handleAIUpload}
            />
            <button className="btn-primary" onClick={openNew}>{t('newRecipe', '+ New Recipe')}</button>
            {recipes.length > 0 && (
              <button className="btn-secondary" onClick={openOptimize} title={t('optimize.tooltip', 'Find 1-off recipes that are really a base + add-on and simplify them')}>
                <i className="fa-solid fa-wand-magic-sparkles" /> {t('optimize.button', 'Optimize with AI')}
              </button>
            )}
            {recipes.length > 0 && (
              <button
                className="btn-danger-subtle"
                style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                onClick={async () => {
                  if (!confirm(t('confirmDeleteAll', '[DEV] Delete all {{count}} recipes?', { count: recipes.length }))) return;
                  for (const r of recipes) await deleteRecipe({ variables: { id: r.id } }).catch(() => null);
                  refetch();
                }}
              >
                <i className="fa-solid fa-trash" /> {t('deleteAll', 'Delete All')}
              </button>
            )}
          </div>
        </div>

        {loading && <p style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>{t('loading', 'Loading…')}</p>}
        {!loading && recipes.length === 0 && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '32px 0', fontSize: '0.9rem' }}>
            {t('emptyPrefix', 'No recipes yet. ')}<a href="#" onClick={e => { e.preventDefault(); openNew(); }} style={{ color: 'var(--vv-navy)', fontWeight: 600 }}>{t('createFirst', 'Create your first recipe')} <i className="fa-solid fa-arrow-right" aria-hidden="true" /></a>
          </p>
        )}

        {recipes.length > 0 && viewMode === 'cards' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5 mt-3.5">
            {recipes.map(recipe => (
              <div key={recipe.id} className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-4 transition-shadow hover:shadow-[0_4px_12px_rgba(11,42,74,0.08)]">
                <div className="text-[0.97rem] font-bold text-[#0B2A4A] mb-1">{recipe.name}</div>
                <div className="text-[0.82rem] text-[#64748b]">{t('batchCost', '{{cost}}/batch', { cost: fmtCost(Number(recipe.totalCost)) })} · {t('ingredientCount', '{{count}} ingredients', { count: recipe.ingredients.length })}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={() => openEdit(recipe)}><i className="fa-solid fa-pen-to-square" /> {t('edit', 'Edit')}</button>
                  <button className="btn-danger-subtle" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={() => handleDelete(recipe.id, recipe.name)}><i className="fa-solid fa-trash" /></button>
                </div>
                {recipe.ingredients.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: '0.78rem', color: 'var(--muted)', cursor: 'pointer' }}>{t('ingredientsSummary', 'Ingredients ({{count}})', { count: recipe.ingredients.length })}</summary>
                    <table style={{ width: '100%', fontSize: '0.8rem', marginTop: 6, borderCollapse: 'collapse' }}>
                      <thead><tr style={{ background: '#f8fafc' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>{t('table.name', 'Name')}</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>{t('table.qty', 'Qty')}</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>{t('table.unitCost', 'Unit Cost')}</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>{t('table.total', 'Total')}</th>
                      </tr></thead>
                      <tbody>
                        {recipe.ingredients.map((ing, i) => (
                          <tr key={i}>
                            <td style={{ padding: '3px 6px' }}>{ing.name}{ing.unit ? ` (${ing.unit})` : ''}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right' }}>{ing.quantity}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right' }}>{fmtCost(Number(ing.unitCost))}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtCost(Number(ing.quantity) * Number(ing.unitCost))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        {recipes.length > 0 && viewMode === 'table' && (
          <div className="table-container" style={{ marginTop: 14, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>{t('recipeTable.name', 'Recipe')}</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>{t('recipeTable.ingredients', 'Ingredients')}</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>{t('recipeTable.cost', 'Cost / Batch')}</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>{t('recipeTable.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {recipes.map(recipe => {
                  const hasIngredients = recipe.ingredients.length > 0;
                  const isOpen = expandedRows.has(recipe.id);
                  return (
                    <Fragment key={recipe.id}>
                      <tr
                        onClick={() => hasIngredients && toggleRow(recipe.id)}
                        style={{ borderBottom: isOpen ? 'none' : '1px solid #f0f0f0', cursor: hasIngredients ? 'pointer' : 'default' }}
                      >
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--vv-navy)' }}>
                          {hasIngredients && (
                            <i
                              className={`fa-solid fa-chevron-right inline-block mr-2 text-[0.72rem] text-[color:var(--muted)] transition-transform duration-200 ease-in-out ${isOpen ? 'rotate-90' : 'rotate-0'}`}
                            />
                          )}
                          {recipe.name}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{recipe.ingredients.length}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--vv-navy)' }}>{fmtCost(Number(recipe.totalCost))}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px', marginRight: 6 }} onClick={e => { e.stopPropagation(); openEdit(recipe); }}><i className="fa-solid fa-pen-to-square" /> {t('edit', 'Edit')}</button>
                          <button className="btn-danger-subtle" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={e => { e.stopPropagation(); handleDelete(recipe.id, recipe.name); }}><i className="fa-solid fa-trash" /></button>
                        </td>
                      </tr>
                      {isOpen && (
                        <>
                          <tr style={{ background: '#f8fafc' }}>
                            <td style={{ padding: '4px 12px 4px 32px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('table.name', 'Name')}</td>
                            <td style={{ padding: '4px 12px', textAlign: 'right', fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('table.qty', 'Qty')}</td>
                            <td style={{ padding: '4px 12px', textAlign: 'right', fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('table.unitCost', 'Unit Cost')}</td>
                            <td style={{ padding: '4px 12px', textAlign: 'right', fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('table.total', 'Total')}</td>
                          </tr>
                          {recipe.ingredients.map((ing, i) => {
                            const last = i === recipe.ingredients.length - 1;
                            return (
                              <tr key={i} style={{ background: '#f8fafc', borderBottom: last ? '1px solid #f0f0f0' : undefined }}>
                                <td style={{ padding: '4px 12px 4px 32px', color: '#334155' }}>{ing.name}{ing.unit ? ` (${ing.unit})` : ''}</td>
                                <td style={{ padding: '4px 12px', textAlign: 'right', color: '#475569' }}>{ing.quantity}</td>
                                <td style={{ padding: '4px 12px', textAlign: 'right', color: '#475569' }}>{fmtCost(Number(ing.unitCost))}</td>
                                <td style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtCost(Number(ing.quantity) * Number(ing.unitCost))}</td>
                              </tr>
                            );
                          })}
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recipe form modal */}
      {(isNew || editing) && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeForm(); }}>
          <div className="modal-box" style={{ maxWidth: 680 }}>
            <button className="modal-close" onClick={closeForm}><i className="fa-solid fa-xmark" /></button>
            <h3 style={{ margin: '0 0 16px' }}>{isNew ? t('form.newTitle', 'New Recipe') : t('form.editTitle', 'Edit: {{name}}', { name: editing?.name })}</h3>

            <div className="form-group">
              <label>{t('form.recipeName', 'Recipe Name *')}</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('form.recipeNamePlaceholder', 'e.g. Lemon Drop Cocktail')} autoFocus />
            </div>

            <div style={{ margin: '16px 0 10px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--vv-navy)' }}>
              {t('form.ingredients', 'Ingredients')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 70px 28px', gap: '6px 8px', fontSize: '0.84rem', marginBottom: 4 }}>
              <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('form.name', 'Name')}</span>
              <span style={{ color: 'var(--muted)', fontWeight: 600, textAlign: 'right' }}>{t('form.qty', 'Qty')}</span>
              <span style={{ color: 'var(--muted)', fontWeight: 600, textAlign: 'right' }}>{t('form.unitCost', 'Unit Cost')}</span>
              <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('form.unit', 'Unit')}</span>
              <span />
            </div>

            {ingredients.map((ing, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 70px 28px', gap: '4px 8px', marginBottom: 4 }}>
                <input type="text" value={ing.name} onChange={e => updateIngredient(i, 'name', e.target.value)} placeholder={t('form.ingredientPlaceholder', 'Ingredient')} />
                <input type="number" step="0.001" value={ing.quantity} onChange={e => updateIngredient(i, 'quantity', e.target.value)} style={{ textAlign: 'right' }} />
                <input type="number" step="0.0001" value={ing.unitCost} onChange={e => updateIngredient(i, 'unitCost', e.target.value)} style={{ textAlign: 'right' }} />
                <input type="text" value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} placeholder={t('form.unitPlaceholder', 'oz, g…')} />
                <button onClick={() => removeIngredient(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: 0 }}><i className="fa-solid fa-xmark" /></button>
              </div>
            ))}

            <button className="btn-secondary" style={{ fontSize: '0.82rem', padding: '5px 12px', marginTop: 6 }} onClick={addIngredient}>{t('form.addIngredient', '+ Add Ingredient')}</button>

            {/* Sub-recipe components: a base recipe, a modifier, or an inventory item, each with an amount. */}
            <div style={{ margin: '18px 0 4px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--vv-navy)' }}>
              {t('components.title', 'Sub-recipe components')}
            </div>
            <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.45 }}>
              {t('components.help', 'Build this recipe from another recipe, mapped modifiers, or inventory items. Their cost is added on top of the ingredients above. Use a negative amount to remove an ingredient.')}
            </p>

            {components.map((c, i) => {
              const opts = c.componentType === 'recipe' ? recipeOptions : c.componentType === 'modifier' ? modifierOptions : inventoryOptions;
              const val = c.componentType === 'recipe' ? c.refRecipeId : c.componentType === 'modifier' ? c.refModifierId : c.refInventoryId;
              const onPick = (id: string | null) => setComponent(i, c.componentType === 'recipe' ? { refRecipeId: id } : c.componentType === 'modifier' ? { refModifierId: id } : { refInventoryId: id });
              const cost = componentCost(c);
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 68px 74px 28px', gap: '4px 8px', marginBottom: 6, alignItems: 'center' }}>
                  <select value={c.componentType} onChange={e => setComponent(i, { componentType: e.target.value as ComponentType })} style={{ fontSize: '0.82rem', padding: '5px 6px' }}>
                    <option value="recipe">{t('components.typeRecipe', 'Recipe')}</option>
                    <option value="modifier">{t('components.typeModifier', 'Modifier')}</option>
                    <option value="inventory">{t('components.typeInventory', 'Inventory')}</option>
                  </select>
                  <Combobox
                    options={opts}
                    value={val}
                    onChange={onPick}
                    noneLabel={t('components.none', '— None —')}
                    placeholder={t('components.search', 'Search…')}
                    noMatchesLabel={t('components.noMatches', 'No matches')}
                  />
                  <input type="number" step="any" value={c.quantity} onChange={e => setComponent(i, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })} style={{ textAlign: 'right', fontSize: '0.82rem' }} aria-label={t('components.amount', 'Amount')} />
                  <span style={{ fontSize: '0.8rem', textAlign: 'right', color: cost != null && cost < 0 ? '#16a34a' : 'var(--muted)' }}>
                    {cost == null ? '—' : `${cost < 0 ? '-' : ''}${fmtCost(Math.abs(cost))}`}
                  </span>
                  <button onClick={() => removeComponent(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: 0 }}><i className="fa-solid fa-xmark" /></button>
                </div>
              );
            })}

            <button className="btn-secondary" style={{ fontSize: '0.82rem', padding: '5px 12px', marginTop: 2 }} onClick={addComponent}>{t('components.add', '+ Add component')}</button>

            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', margin: '14px 0', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--muted)' }}>{t('form.estimatedBatchCost', 'Estimated batch cost')}</span>
              <span style={{ fontWeight: 700, color: 'var(--vv-navy)' }}>{fmtCost(totalCost)}</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving && <span className="spinner" />} <span>{t('form.saveRecipe', 'Save Recipe')}</span>
              </button>
              <button className="btn-secondary" onClick={closeForm}>{t('form.cancel', 'Cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* AI "Optimize recipes" modal */}
      {showOptimize && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !optApplying) closeOptimize(); }}>
          <div className="modal-box" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', maxHeight: 'min(88vh, 720px)', padding: 0, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '22px 26px 14px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 6px', color: 'var(--vv-navy)' }}>{t('optimize.title', 'Optimize Recipes with AI')}</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                {t('optimize.description', 'Claude finds 1-off recipes that are really a base recipe plus one add-on (e.g. “Limeade – Strawberry”) and proposes turning them into a base + add-on. Review the before/after and accept all or line by line. Nothing changes until you apply.')}
              </p>
            </div>

            {/* Body */}
            <div style={{ padding: '14px 26px', overflowY: 'auto', flex: 1 }}>
              {optRecs == null && !optLoading && (
                <div style={{ padding: '10px 0' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>{t('optimize.scopeLabel', 'Which recipes should Claude analyze?')}</div>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.86rem', marginBottom: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={optScope === 'all'} onChange={() => setOptScope('all')} />
                    {t('optimize.scopeAll', 'All recipes')}
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.86rem', cursor: 'pointer' }}>
                    <input type="radio" checked={optScope === 'mapped'} onChange={() => setOptScope('mapped')} />
                    {t('optimize.scopeMapped', 'Only recipes mapped to a POS item')}
                  </label>
                </div>
              )}

              {optLoading && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)' }}>
                  <div><i className="fa-solid fa-wand-magic-sparkles fa-fade" style={{ marginRight: 8 }} />{t('optimize.working', 'Claude is analyzing your recipes…')}</div>
                  <div style={{ fontFamily: 'monospace', marginTop: 8, color: 'var(--vv-navy)', fontWeight: 600 }}>{`${Math.floor(optElapsed / 60)}:${String(optElapsed % 60).padStart(2, '0')}`}</div>
                </div>
              )}

              {optRecs != null && !optLoading && (
                <>
                  <div style={{ fontSize: '0.83rem', color: 'var(--muted)', marginBottom: 10 }}>
                    {t('optimize.summary', '{{variants}} recipe(s) can be simplified. {{distinct}} look distinct — no change.', { variants: optVariants.length, distinct: optDistinctCount })}
                    {optVariants.length > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        <a href="#" onClick={e => { e.preventDefault(); acceptAll(); }} style={{ color: 'var(--vv-navy)', fontWeight: 600 }}>{t('optimize.selectAll', 'Select all')}</a>
                        {' · '}
                        <a href="#" onClick={e => { e.preventDefault(); acceptNone(); }} style={{ color: 'var(--vv-navy)', fontWeight: 600 }}>{t('optimize.selectNone', 'None')}</a>
                      </span>
                    )}
                  </div>

                  {optVariants.length === 0 ? (
                    <div style={{ padding: '18px 0', color: 'var(--muted)', fontSize: '0.88rem' }}>{t('optimize.nothing', 'No 1-off recipes found — your recipes already look distinct.')}</div>
                  ) : optVariants.map(rec => {
                    const accepted = optAccepted.has(rec.recipeId);
                    return (
                      <div key={rec.recipeId} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: accepted ? '#f0fdf4' : '#fff' }}>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                          <input type="checkbox" checked={accepted} onChange={() => toggleAccept(rec.recipeId)} style={{ marginTop: 3 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--vv-navy)' }}>{rec.recipeName}</div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.82rem', marginTop: 4, alignItems: 'center' }}>
                              <span style={{ color: 'var(--muted)' }}>
                                {t('optimize.before', 'Before')}: {t('optimize.flatCount', '{{n}} ingredients', { n: recipes.find(r => r.id === rec.recipeId)?.ingredients.length ?? 0 })}
                                {rec.beforeCost != null && ` · ${fmtCost(rec.beforeCost)}`}
                              </span>
                              <i className="fa-solid fa-arrow-right" style={{ color: 'var(--muted)' }} />
                              <span>
                                <strong>{t('optimize.after', 'After')}:</strong> {rec.baseName}
                                {rec.addonLabel ? ` + ${rec.addonLabel}` : ''}
                                {rec.afterCost != null && ` · ${fmtCost(rec.afterCost)}`}
                              </span>
                              {rec.baseExistingRecipeId == null && rec.baseNewName && (
                                <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 99, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 600 }}>{t('optimize.newBase', 'new base')}</span>
                              )}
                            </div>
                            {rec.reason && <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{rec.reason}</div>}
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 26px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fff', flexShrink: 0 }}>
              <button className="btn-secondary" onClick={closeOptimize} disabled={optApplying}>{t('optimize.cancel', 'Cancel')}</button>
              {optRecs == null ? (
                <button className="btn-primary" onClick={runOptimize} disabled={optLoading}>
                  {optLoading && <span className="spinner" />} <span>{t('optimize.analyze', 'Analyze')}</span>
                </button>
              ) : (
                <button className="btn-primary" onClick={handleApplyOptimize} disabled={optApplying || optAccepted.size === 0}>
                  {optApplying && <span className="spinner" />} <span>{t('optimize.apply', 'Apply {{count}} change(s)', { count: optAccepted.size })}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Streaming output window */}
      {isStreaming && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', height: 'min(85vh, 640px)', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '24px 28px 12px', flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 4px', color: streamingError ? 'var(--danger)' : 'var(--vv-navy)' }}>
                <i className={`fa-solid ${streamingError ? 'fa-triangle-exclamation' : 'fa-spinner fa-spin'}`} style={{ marginRight: 8 }} />
                {streamingError ? t('streaming.noRecipesTitle', 'No Recipes Found — Raw Output') : t('streaming.analyzingTitle', 'Claude is analyzing your file…')}
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
              style={{
                flex: 1,
                overflowY: 'auto',
                background: '#0f172a',
                margin: '0 28px',
                borderRadius: 8,
                padding: '12px 14px',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: streamingError ? '#fca5a5' : '#86efac',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {streamingText}
            </div>
            <div style={{ padding: '12px 28px 24px', flexShrink: 0 }}>
              {streamingError && (
                <button className="btn-secondary" onClick={() => { setIsStreaming(false); setStreamingError(null); }}>
                  {t('streaming.close', 'Close')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Import Review Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeImportModal(); }}>
          <div className="modal-box" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', height: 'min(90vh, 820px)', padding: 0, overflow: 'hidden' }}>
            <button className="modal-close" onClick={closeImportModal}><i className="fa-solid fa-xmark" /></button>
            <div style={{ padding: '28px 28px 12px', flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 4px' }}>
                <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--vv-navy)', marginRight: 8 }} />
                {t('review.title', 'Review AI-Parsed Recipes')}
              </h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                {t('review.detected', '{{count}} recipes detected. Edit or delete any before saving.', { count: importedRecipes.length })}
              </p>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '0 28px' }}>
              {importedRecipes.map(recipe => (
                <div key={recipe.tempId} style={{ border: '1px solid rgba(11,42,74,0.12)', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#fff' }}>
                  {importEditing === recipe.tempId ? (
                    /* Edit mode */
                    <>
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: '0.82rem' }}>{t('review.recipeName', 'Recipe Name')}</label>
                        <input type="text" value={importEditName} onChange={e => setImportEditName(e.target.value)} autoFocus />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 70px 28px', gap: '4px 8px', fontSize: '0.82rem', marginBottom: 4 }}>
                        <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('review.name', 'Name')}</span>
                        <span style={{ color: 'var(--muted)', fontWeight: 600, textAlign: 'right' }}>{t('review.qty', 'Qty')}</span>
                        <span style={{ color: 'var(--muted)', fontWeight: 600, textAlign: 'right' }}>{t('review.unitCost', 'Unit Cost')}</span>
                        <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{t('review.unit', 'Unit')}</span>
                        <span />
                      </div>
                      {importEditIngredients.map((ing, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 70px 28px', gap: '3px 8px', marginBottom: 3 }}>
                          <input type="text" value={ing.name} onChange={e => updateImportIngredient(i, 'name', e.target.value)} placeholder={t('review.ingredientPlaceholder', 'Ingredient')} style={{ fontSize: '0.83rem' }} />
                          <input type="number" step="0.001" value={ing.quantity} onChange={e => updateImportIngredient(i, 'quantity', e.target.value)} style={{ textAlign: 'right', fontSize: '0.83rem' }} />
                          <input type="number" step="0.0001" value={ing.unitCost} onChange={e => updateImportIngredient(i, 'unitCost', e.target.value)} style={{ textAlign: 'right', fontSize: '0.83rem' }} />
                          <input type="text" value={ing.unit} onChange={e => updateImportIngredient(i, 'unit', e.target.value)} placeholder={t('review.unitPlaceholder', 'oz…')} style={{ fontSize: '0.83rem' }} />
                          <button onClick={() => setImportEditIngredients(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}><i className="fa-solid fa-xmark" /></button>
                        </div>
                      ))}
                      <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '3px 10px', marginTop: 4 }} onClick={() => setImportEditIngredients(prev => [...prev, emptyIngredient()])}>{t('review.addIngredient', '+ Add Ingredient')}</button>

                      <div style={{ background: '#f8fafc', borderRadius: 6, padding: '7px 10px', margin: '10px 0 8px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--muted)' }}>{t('review.batchCost', 'Batch cost')}</span>
                        <span style={{ fontWeight: 700, color: 'var(--vv-navy)' }}>{fmtCost(importEditCost)}</span>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-primary" style={{ fontSize: '0.82rem', padding: '5px 12px' }} onClick={saveImportEdit}>{t('review.saveChanges', 'Save Changes')}</button>
                        <button className="btn-secondary" style={{ fontSize: '0.82rem', padding: '5px 12px' }} onClick={() => setImportEditing(null)}>{t('review.cancel', 'Cancel')}</button>
                      </div>
                    </>
                  ) : (
                    /* View mode */
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--vv-navy)', marginBottom: 2 }}>{recipe.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                          {t('ingredientCount', '{{count}} ingredients', { count: recipe.ingredients.length })}
                          {recipe.ingredients.length > 0 && (
                            <> · {t('batchCost', '{{cost}}/batch', { cost: fmtCost(recipe.ingredients.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitCost) || 0), 0)) })}</>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '3px 10px' }} onClick={() => startImportEdit(recipe)}>
                          <i className="fa-solid fa-pen-to-square" /> {t('review.edit', 'Edit')}
                        </button>
                        <button className="btn-danger-subtle" style={{ fontSize: '0.78rem', padding: '3px 10px' }} onClick={() => deleteImportedRecipe(recipe.tempId)}>
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '14px 28px 28px', borderTop: '1px solid rgba(11,42,74,0.08)', flexShrink: 0 }}>
              <button className="btn-primary" onClick={handleApproveAll} disabled={approvingAll || importedRecipes.length === 0}>
                {approvingAll && <span className="spinner" />}
                <span><i className="fa-solid fa-check" /> {t('review.approveAll', 'Approve All ({{count}})', { count: importedRecipes.length })}</span>
              </button>
              <button className="btn-danger-subtle" onClick={closeImportModal} disabled={approvingAll}>
                <i className="fa-solid fa-trash" /> {t('review.discardBatch', 'Discard Batch')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

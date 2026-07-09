import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation } from 'react-i18next';
import { showToast } from '@org/data';
import { useCurrency } from '../../i18n/useCurrency';
import { formatNumber } from '../../i18n/format';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { Combobox } from '../Combobox';

export type ComponentType = 'recipe' | 'modifier' | 'inventory';
export interface Ingredient { id?: string; name: string; quantity: number; unitCost: number; unit: string; }
export interface Component { componentType: ComponentType; refRecipeId: string | null; refModifierId: string | null; refInventoryId: string | null; quantity: number; }
export interface Recipe { id: string; name: string; totalCost: number; ingredients: Ingredient[]; components?: Array<Component & { id?: string; name?: string; cost?: number }>; }

export const emptyIngredient = (): Ingredient => ({ name: '', quantity: 1, unitCost: 0, unit: '' });
const emptyComponent = (): Component => ({ componentType: 'recipe', refRecipeId: null, refModifierId: null, refInventoryId: null, quantity: 1 });

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
const GET_COMPONENT_OPTIONS = gql`
  query GetRecipeComponentOptions($companyId: ID!) {
    inventory(companyId: $companyId) { id name unitCost }
    posModifierMappings(companyId: $companyId) { id posModifierName inventoryItemId quantity }
  }
`;
const CREATE_RECIPE = gql`
  mutation CreateRecipe($companyId: ID!, $input: CreateRecipeInput!) {
    createRecipe(companyId: $companyId, input: $input) { id name totalCost ingredients { id name quantity unitCost unit } components { ${COMPONENT_FIELDS} } }
  }
`;
const UPDATE_RECIPE = gql`
  mutation UpdateRecipe($id: ID!, $input: CreateRecipeInput!) {
    updateRecipe(id: $id, input: $input) { id name totalCost ingredients { id name quantity unitCost unit } components { ${COMPONENT_FIELDS} } }
  }
`;

interface Props {
  /** Present = edit mode; absent = create. */
  recipe?: Recipe;
  /** Seed a new recipe (name and/or components) — used when launched from a mapping modal. */
  prefill?: { name?: string; components?: Component[] };
  /** Called with the saved recipe (create or update returns the full shaped recipe). */
  onSaved: (r: Recipe) => void;
  onClose: () => void;
}

// Reusable recipe create/edit modal. Renders as a nested overlay (zIndex 1100) so
// it can stack above another modal (e.g. Manage POS Mappings). Extracted from
// RecipesPage so the recipe form is shared between the page and the mapping modals.
export function RecipeEditorModal({ recipe, prefill, onSaved, onClose }: Props) {
  const { t } = useTranslation('recipes');
  const { currency } = useCurrency();
  const fmtCost = (v: number) =>
    formatNumber(v, { style: 'currency', currency, minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const { companyId } = useCurrentCompany();
  const isNew = !recipe;

  const { data } = useQuery(GET_RECIPES, { variables: { companyId }, skip: !companyId });
  const { data: optData } = useQuery(GET_COMPONENT_OPTIONS, { variables: { companyId }, skip: !companyId });
  const [createRecipe] = useMutation(CREATE_RECIPE);
  const [updateRecipe] = useMutation(UPDATE_RECIPE);

  const [name, setName] = useState(recipe?.name ?? prefill?.name ?? '');
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe && recipe.ingredients.length > 0 ? recipe.ingredients : [emptyIngredient()]);
  const [components, setComponents] = useState<Component[]>(
    recipe
      ? (recipe.components ?? []).map(c => ({ componentType: c.componentType, refRecipeId: c.refRecipeId ?? null, refModifierId: c.refModifierId ?? null, refInventoryId: c.refInventoryId ?? null, quantity: c.quantity }))
      : (prefill?.components ?? []));
  const [saving, setSaving] = useState(false);

  function updateIngredient(i: number, field: keyof Ingredient, value: string | number) {
    setIngredients(prev => prev.map((ing, j) => j === i ? { ...ing, [field]: value } : ing));
  }
  function addIngredient() { setIngredients(prev => [...prev, emptyIngredient()]); }
  function removeIngredient(i: number) { setIngredients(prev => prev.filter((_, j) => j !== i)); }

  function setComponent(i: number, patch: Partial<Component>) {
    setComponents(prev => prev.map((c, j) => {
      if (j !== i) return c;
      const next = { ...c, ...patch };
      if (patch.componentType && patch.componentType !== c.componentType) {
        next.refRecipeId = null; next.refModifierId = null; next.refInventoryId = null;
      }
      return next;
    }));
  }
  function addComponent() { setComponents(prev => [...prev, emptyComponent()]); }
  function removeComponent(i: number) { setComponents(prev => prev.filter((_, j) => j !== i)); }

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
    .filter(r => r.id !== recipe?.id) // can't reference the recipe being edited (cycle)
    .map(r => ({ id: r.id, label: `${r.name} (${fmtCost(Number(r.totalCost))})` }));
  const modifierOptions = Array.from(modById.entries()).map(([id, m]) => ({ id, label: `${m.name} (${fmtCost(m.cost)}/use)` }));
  const inventoryOptions = Array.from(invById.entries()).map(([id, i]) => ({ id, label: `${i.name} (${fmtCost(i.unitCost)}/unit)` }));

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
      let saved: Recipe | undefined;
      if (isNew) {
        const res = await createRecipe({ variables: { companyId, input } });
        saved = (res.data as { createRecipe?: Recipe } | null)?.createRecipe;
        showToast(t('toast.created', 'Recipe created!'), 'success');
      } else {
        const res = await updateRecipe({ variables: { id: recipe!.id, input } });
        saved = (res.data as { updateRecipe?: Recipe } | null)?.updateRecipe;
        showToast(t('toast.updated', 'Recipe updated!'), 'success');
      }
      if (saved) onSaved(saved);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <button className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></button>
        <h3 style={{ margin: '0 0 16px' }}>{isNew ? t('form.newTitle', 'New Recipe') : t('form.editTitle', 'Edit: {{name}}', { name: recipe?.name })}</h3>

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
          <button className="btn-secondary" onClick={onClose}>{t('form.cancel', 'Cancel')}</button>
        </div>
      </div>
    </div>
  );
}

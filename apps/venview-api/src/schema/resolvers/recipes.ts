import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';
import { loadRecipeCostContext, resolveComponent, wouldCreateCycle, type RecipeCostContext } from '../../lib/recipeCost.js';
import { optimizeRecipes, type OptimizeLine } from '../../lib/aiRecipeOptimize.js';

type Row = Record<string, unknown>;

// Only these fields persist on RecipeComponents (drop any extra input keys).
function componentRows(components: unknown, recipeId: string): Row[] {
  if (!Array.isArray(components)) return [];
  return (components as Row[]).map((c, idx) => ({
    recipeId,
    componentType: c['componentType'],
    refRecipeId: c['refRecipeId'] ?? null,
    refModifierId: c['refModifierId'] ?? null,
    refInventoryId: c['refInventoryId'] ?? null,
    quantity: c['quantity'] == null ? 1 : Number(c['quantity']),
    position: idx,
  }));
}

// Reject a save whose recipe-type components would introduce a cost cycle.
async function assertNoCycles(recipeId: string, components: unknown): Promise<void> {
  if (!Array.isArray(components)) return;
  for (const c of components as Row[]) {
    if (c['componentType'] === 'recipe' && c['refRecipeId']) {
      if (await wouldCreateCycle(recipeId, c['refRecipeId'] as string)) {
        throw new Error('That would create a recipe loop (a recipe cannot contain itself, directly or indirectly).');
      }
    }
  }
}

// Shape a raw RecipeCards row (with nested RecipeIngredients/RecipeComponents)
// into the GraphQL Recipe, attaching composed totalCost and resolved component
// name/cost from the shared cost context.
function shapeRecipe(row: Row, ctx: RecipeCostContext): Row {
  const id = row['id'] as string;
  const ingredients = (row['RecipeIngredients'] as Row[] | null) ?? [];
  const components = ((row['RecipeComponents'] as Row[] | null) ?? []).map(c => ({ ...c, ...resolveComponent(c, ctx) }));
  return { ...row, id, totalCost: ctx.costById.get(id) ?? 0, ingredients, components };
}

// RecipeComponents has two FKs to RecipeCards (recipeId = parent, refRecipeId =
// referenced sub-recipe), so the embed must name the parent FK explicitly.
const RECIPE_SELECT = '*, RecipeIngredients(*), RecipeComponents!RecipeComponents_recipeId_fkey(*)';

export const recipeResolvers = {
  Query: {
    recipes: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { data, error } = await supabase
        .from('RecipeCards')
        .select(RECIPE_SELECT)
        .eq('companyId', companyId)
        .order('name');
      if (error) throw new Error(error.message);

      const costCtx = await loadRecipeCostContext(companyId);
      return (data ?? []).map((r: Row) => shapeRecipe(r, costCtx));
    },

    // AI recommendations to simplify 1-off variant recipes into base + add-on.
    // Read-only — returns before/after for the user to review; persists nothing.
    recipeOptimizationRecommendations: async (
      _: unknown,
      { companyId, recipeIds }: { companyId: string; recipeIds?: string[] | null },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      let q = supabase
        .from('RecipeCards')
        .select('id, name, RecipeIngredients(name, quantity, unitCost, unit)')
        .eq('companyId', companyId);
      if (recipeIds && recipeIds.length > 0) q = q.in('id', recipeIds);
      const { data: cards } = await q;

      const recipes = (cards ?? []).map((r: Row) => ({
        id: r['id'] as string,
        name: (r['name'] as string) ?? '',
        ingredients: ((r['RecipeIngredients'] as Row[] | null) ?? []).map(i => ({
          name: (i['name'] as string) ?? '', quantity: Number(i['quantity'] ?? 0),
          unitCost: Number(i['unitCost'] ?? 0), unit: (i['unit'] as string) ?? null,
        })),
      }));
      if (recipes.length === 0) return [];

      // Cost context supplies inventory/modifier catalogs (for confident linking)
      // and composition-aware costs for the before/after preview.
      const costCtx = await loadRecipeCostContext(companyId);
      const inventory = Array.from(costCtx.invById.entries()).map(([id, i]) => ({ id, name: i.name, unitCost: i.unitCost }));
      const modifiers = Array.from(costCtx.modById.entries()).map(([id, m]) => ({ id, name: m.name, cost: m.cost }));

      const recs = await optimizeRecipes(recipes, inventory, modifiers);

      const nameById = new Map(recipes.map(r => [r.id, r.name]));
      const lineSum = (lines: OptimizeLine[]) => lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);

      return recs.map(rec => {
        const beforeCost = costCtx.costById.get(rec.recipeId) ?? 0;
        if (rec.kind !== 'variant') {
          return { ...rec, recipeName: nameById.get(rec.recipeId) ?? '', baseName: null, addonLabel: null, beforeCost, afterCost: null };
        }
        const baseCost = rec.baseExistingRecipeId
          ? costCtx.costById.get(rec.baseExistingRecipeId) ?? 0
          : lineSum(rec.baseNewIngredients);
        const baseName = rec.baseExistingRecipeId ? costCtx.recipeNameById.get(rec.baseExistingRecipeId) ?? '' : rec.baseNewName;
        let addonCost = 0; let addonLabel = '';
        if (rec.addonModifierId) { const m = costCtx.modById.get(rec.addonModifierId); addonCost = (m?.cost ?? 0) * rec.addonQuantity; addonLabel = m?.name ?? ''; }
        else if (rec.addonInventoryId) { const inv = costCtx.invById.get(rec.addonInventoryId); addonCost = (inv?.unitCost ?? 0) * rec.addonQuantity; addonLabel = inv?.name ?? ''; }
        else { addonCost = lineSum(rec.addonKeepIngredients); addonLabel = rec.addonKeepIngredients.map(l => l.name).join(', '); }
        return { ...rec, recipeName: nameById.get(rec.recipeId) ?? '', baseName, addonLabel, beforeCost, afterCost: baseCost + addonCost };
      });
    },
  },

  Mutation: {
    createRecipe: async (
      _: unknown,
      { companyId, input }: { companyId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { ingredients, components, ...recipeFields } = input;

      const { data: recipe, error } = await supabase
        .from('RecipeCards')
        .insert({ ...recipeFields, companyId })
        .select()
        .single();
      if (error || !recipe) throw new Error(error?.message ?? 'Failed to create recipe');

      const recipeId = (recipe as Row)['id'] as string;

      if (Array.isArray(ingredients) && ingredients.length > 0) {
        await supabase.from('RecipeIngredients').insert(
          (ingredients as Row[]).map(ing => ({ ...ing, recipeId }))
        );
      }
      const compRows = componentRows(components, recipeId);
      if (compRows.length > 0) await supabase.from('RecipeComponents').insert(compRows);

      const { data: full } = await supabase.from('RecipeCards').select(RECIPE_SELECT).eq('id', recipeId).single();
      const costCtx = await loadRecipeCostContext(companyId);
      return shapeRecipe(full as Row, costCtx);
    },

    // Bulk variant used by the AI-import "Approve All" flow: creates many recipes
    // in a fixed number of DB round-trips regardless of how many were parsed.
    // (AI import produces free-text ingredients only — no components.)
    createRecipes: async (
      _: unknown,
      { companyId, inputs }: { companyId: string; inputs: Array<Record<string, unknown>> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      if (!Array.isArray(inputs) || inputs.length === 0) return [];

      const { data: cards, error: cardErr } = await supabase
        .from('RecipeCards')
        .insert(inputs.map(i => ({ name: i['name'], companyId })))
        .select();
      if (cardErr || !cards) throw new Error(cardErr?.message ?? 'Failed to create recipes');

      const ingredientRows = cards.flatMap((card, idx) => {
        const ings = (inputs[idx]?.['ingredients'] as Row[] ?? []);
        return ings.map(ing => ({ ...ing, recipeId: (card as Row)['id'] }));
      });
      if (ingredientRows.length > 0) {
        const { error: ingErr } = await supabase.from('RecipeIngredients').insert(ingredientRows);
        if (ingErr) throw new Error(ingErr.message);
      }

      const componentInserts = cards.flatMap((card, idx) =>
        componentRows(inputs[idx]?.['components'], (card as Row)['id'] as string));
      if (componentInserts.length > 0) {
        const { error: compErr } = await supabase.from('RecipeComponents').insert(componentInserts);
        if (compErr) throw new Error(compErr.message);
      }

      const ids = cards.map(c => (c as Row)['id'] as string);
      const { data: full } = await supabase.from('RecipeCards').select(RECIPE_SELECT).in('id', ids);
      const costCtx = await loadRecipeCostContext(companyId);
      return (full ?? []).map((row: Row) => shapeRecipe(row, costCtx));
    },

    updateRecipe: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);

      const { ingredients, components, ...recipeFields } = input;

      await assertNoCycles(id, components);

      const { error } = await supabase.from('RecipeCards').update(recipeFields).eq('id', id);
      if (error) throw new Error(error.message);

      if (Array.isArray(ingredients)) {
        await supabase.from('RecipeIngredients').delete().eq('recipeId', id);
        if (ingredients.length > 0) {
          await supabase.from('RecipeIngredients').insert(
            (ingredients as Row[]).map(ing => ({ ...ing, recipeId: id }))
          );
        }
      }
      // Components are full-replaced whenever the field is provided.
      if (components !== undefined) {
        await supabase.from('RecipeComponents').delete().eq('recipeId', id);
        const compRows = componentRows(components, id);
        if (compRows.length > 0) await supabase.from('RecipeComponents').insert(compRows);
      }

      const { data: full } = await supabase.from('RecipeCards').select(RECIPE_SELECT).eq('id', id).single();
      const row = full as Row;
      const costCtx = await loadRecipeCostContext(row['companyId'] as string);
      return shapeRecipe(row, costCtx);
    },

    deleteRecipe: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('RecipeCards').delete().eq('id', id);
      return true;
    },

    // Apply accepted recipe-optimization recommendations: create needed base
    // recipes once per family, then restructure each accepted variant IN PLACE
    // (same recipe id → POS mappings stay valid) into base component + add-on.
    applyRecipeOptimizations: async (
      _: unknown,
      { companyId, accepted }: { companyId: string; accepted: Array<Record<string, unknown>> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      if (!Array.isArray(accepted) || accepted.length === 0) return true;

      const lineRows = (lines: unknown, recipeId: string): Row[] =>
        (Array.isArray(lines) ? lines as Row[] : [])
          .filter(l => typeof l['name'] === 'string' && (l['name'] as string).trim())
          .map(l => ({ recipeId, name: l['name'], quantity: Number(l['quantity'] ?? 0), unitCost: Number(l['unitCost'] ?? 0), unit: l['unit'] ?? null }));

      // 1. Resolve one base recipe id per family (existing, else create once).
      const baseIdByFamily = new Map<string, string>();
      for (const a of accepted) {
        const fk = a['baseFamilyKey'] as string | null;
        if (fk && a['baseExistingRecipeId'] && !baseIdByFamily.has(fk)) baseIdByFamily.set(fk, a['baseExistingRecipeId'] as string);
      }
      for (const a of accepted) {
        const fk = a['baseFamilyKey'] as string | null;
        if (!fk || baseIdByFamily.has(fk)) continue;
        const baseName = a['baseNewName'] as string | null;
        const baseIngs = a['baseNewIngredients'];
        if (!baseName || !Array.isArray(baseIngs) || baseIngs.length === 0) continue;
        const { data: baseCard, error } = await supabase.from('RecipeCards').insert({ companyId, name: baseName }).select().single();
        if (error || !baseCard) throw new Error(error?.message ?? 'Failed to create base recipe');
        const baseId = (baseCard as Row)['id'] as string;
        await supabase.from('RecipeIngredients').insert(lineRows(baseIngs, baseId));
        baseIdByFamily.set(fk, baseId);
      }

      // 2. Restructure each accepted variant in place.
      for (const a of accepted) {
        const recipeId = a['recipeId'] as string;
        const fk = a['baseFamilyKey'] as string | null;
        const baseId = (fk && baseIdByFamily.get(fk)) || (a['baseExistingRecipeId'] as string | null);
        if (!baseId || baseId === recipeId) continue;
        if (await wouldCreateCycle(recipeId, baseId)) continue; // safety net

        await supabase.from('RecipeIngredients').delete().eq('recipeId', recipeId);
        const keep = lineRows(a['addonKeepIngredients'], recipeId);
        if (keep.length > 0) await supabase.from('RecipeIngredients').insert(keep);

        const comps: Row[] = [{ recipeId, componentType: 'recipe', refRecipeId: baseId, refModifierId: null, refInventoryId: null, quantity: 1, position: 0 }];
        const qty = a['addonQuantity'] == null ? 1 : Number(a['addonQuantity']);
        if (a['addonModifierId']) comps.push({ recipeId, componentType: 'modifier', refRecipeId: null, refModifierId: a['addonModifierId'], refInventoryId: null, quantity: qty, position: 1 });
        else if (a['addonInventoryId']) comps.push({ recipeId, componentType: 'inventory', refRecipeId: null, refModifierId: null, refInventoryId: a['addonInventoryId'], quantity: qty, position: 1 });
        await supabase.from('RecipeComponents').delete().eq('recipeId', recipeId);
        await supabase.from('RecipeComponents').insert(comps);
      }

      return true;
    },
  },
};

import { supabase } from './supabase.js';
import logger from './logger.js';

// Centralized, recursive, cycle-safe recipe cost computation.
//
// A recipe's cost = its own free-text ingredients (Σ quantity × unitCost) plus
// each RecipeComponents entry resolved to a cost:
//   - inventory: VendorInventory.unitCost × quantity
//   - modifier:  (modifier's per-application cost) × quantity
//   - recipe:    (that recipe's total cost) × quantity   ← recursive
// A negative component quantity reduces cost (a removal). Cycles (a recipe that
// references itself, directly or transitively) contribute 0 and are logged; they
// are also rejected at save time, so this is only a safety net.

type Row = Record<string, unknown>;

export interface RecipeCostContext {
  /** recipeId → total composed cost. */
  costById: Map<string, number>;
  /** inventoryId → { name, unitCost }. */
  invById: Map<string, { name: string; unitCost: number }>;
  /** modifierMappingId → { name, cost } (cost = per-application). */
  modById: Map<string, { name: string; cost: number }>;
  /** recipeId → name. */
  recipeNameById: Map<string, string>;
}

// Load everything needed to cost a company's recipes and resolve component
// display info in one shot, then compute all recipe totals.
export async function loadRecipeCostContext(companyId: string): Promise<RecipeCostContext> {
  const [{ data: cards }, { data: invRows }, { data: modRows }] = await Promise.all([
    supabase
      .from('RecipeCards')
      // Disambiguate the embed: RecipeComponents has two FKs to RecipeCards
      // (recipeId = parent, refRecipeId = referenced sub-recipe). We want the
      // parent relationship.
      .select('id, name, RecipeIngredients(quantity, unitCost), RecipeComponents!RecipeComponents_recipeId_fkey(componentType, refRecipeId, refModifierId, refInventoryId, quantity)')
      .eq('companyId', companyId),
    supabase.from('VendorInventory').select('id, itemName, unitCost').eq('companyId', companyId),
    supabase.from('PosModifierMapping').select('id, posModifierName, inventoryId, quantity').eq('companyId', companyId),
  ]);

  const invById = new Map<string, { name: string; unitCost: number }>();
  for (const i of (invRows ?? []) as Row[]) {
    invById.set(i['id'] as string, { name: (i['itemName'] as string) ?? '', unitCost: Number(i['unitCost'] ?? 0) });
  }

  const modById = new Map<string, { name: string; cost: number }>();
  for (const m of (modRows ?? []) as Row[]) {
    const invId = m['inventoryId'] as string | null;
    const invCost = invId ? invById.get(invId)?.unitCost ?? 0 : 0;
    modById.set(m['id'] as string, {
      name: (m['posModifierName'] as string) ?? '',
      cost: invCost * Number(m['quantity'] ?? 1),
    });
  }

  const byId = new Map<string, Row>();
  const recipeNameById = new Map<string, string>();
  for (const c of (cards ?? []) as Row[]) {
    byId.set(c['id'] as string, c);
    recipeNameById.set(c['id'] as string, (c['name'] as string) ?? '');
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const costOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached != null) return cached;
    const rec = byId.get(id);
    if (!rec) return 0;
    if (visiting.has(id)) {
      logger.warn('recipeCost: cycle detected, component contributes 0', { recipeId: id });
      return 0;
    }
    visiting.add(id);
    let total = 0;
    for (const ing of (rec['RecipeIngredients'] as Row[] | null) ?? []) {
      total += Number(ing['quantity'] ?? 0) * Number(ing['unitCost'] ?? 0);
    }
    for (const c of (rec['RecipeComponents'] as Row[] | null) ?? []) {
      const q = Number(c['quantity'] ?? 1);
      const type = c['componentType'];
      if (type === 'inventory' && c['refInventoryId']) {
        total += (invById.get(c['refInventoryId'] as string)?.unitCost ?? 0) * q;
      } else if (type === 'modifier' && c['refModifierId']) {
        total += (modById.get(c['refModifierId'] as string)?.cost ?? 0) * q;
      } else if (type === 'recipe' && c['refRecipeId']) {
        total += costOf(c['refRecipeId'] as string) * q;
      }
    }
    visiting.delete(id);
    memo.set(id, total);
    return total;
  };

  const costById = new Map<string, number>();
  for (const c of (cards ?? []) as Row[]) costById.set(c['id'] as string, costOf(c['id'] as string));

  return { costById, invById, modById, recipeNameById };
}

// Convenience: just the recipeId → total-cost map (used by the COGS path).
export async function computeRecipeCosts(companyId: string): Promise<Map<string, number>> {
  return (await loadRecipeCostContext(companyId)).costById;
}

// Resolve a single component's display name + resolved cost for the editor.
export function resolveComponent(c: Row, ctx: RecipeCostContext): { name: string; cost: number } {
  const q = Number(c['quantity'] ?? 1);
  switch (c['componentType']) {
    case 'inventory': {
      const inv = ctx.invById.get(c['refInventoryId'] as string);
      return { name: inv?.name ?? '', cost: (inv?.unitCost ?? 0) * q };
    }
    case 'modifier': {
      const m = ctx.modById.get(c['refModifierId'] as string);
      return { name: m?.name ?? '', cost: (m?.cost ?? 0) * q };
    }
    case 'recipe': {
      const id = c['refRecipeId'] as string;
      return { name: ctx.recipeNameById.get(id) ?? '', cost: (ctx.costById.get(id) ?? 0) * q };
    }
    default:
      return { name: '', cost: 0 };
  }
}

// True if a recipe-component referencing `refRecipeId` on `recipeId` would create
// a cycle — i.e. refRecipeId IS recipeId, or refRecipeId already reaches recipeId
// through existing recipe-edges. The parent's own current edges are excluded
// because updateRecipe replaces them. Used to reject cyclic saves.
export async function wouldCreateCycle(recipeId: string, refRecipeId: string): Promise<boolean> {
  if (recipeId === refRecipeId) return true;
  const { data: comps } = await supabase
    .from('RecipeComponents')
    .select('recipeId, refRecipeId, componentType');
  const edges = new Map<string, string[]>();
  for (const c of (comps ?? []) as Row[]) {
    if (c['componentType'] !== 'recipe' || !c['refRecipeId']) continue;
    const from = c['recipeId'] as string;
    if (from === recipeId) continue; // parent's own edges are being replaced
    const list = edges.get(from) ?? [];
    list.push(c['refRecipeId'] as string);
    edges.set(from, list);
  }
  // Does refRecipeId reach recipeId through the remaining recipe-edges?
  const stack = [refRecipeId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === recipeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) ?? []) stack.push(next);
  }
  return false;
}

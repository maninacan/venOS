// Resolving a sold item's unit cost from the company's POS→inventory mappings.
//
// Historically this matched only on `posItemName` (base item name), but the
// pull's item name often includes the variation (e.g. "Lemonade (Regular)")
// while mappings store name and variation separately — so nothing matched and
// COGS came out $0. We now match on the POS catalog object id first (exact,
// format-independent), falling back to normalized name variants.

export interface CostMapping {
  posItemId?: string | null;
  posItemName?: string | null;
  variationName?: string | null;
  unitCost?: number | null;
  // A mapped recipe wins over the inventory unit cost: its total ingredient cost
  // becomes the item's unit COGS. `recipeCost` is the recipe total (caller-computed).
  recipeId?: string | null;
  recipeCost?: number | null;
}

export interface PulledItem {
  name: string;
  catalogObjectId?: string | null;
}

export interface ResolvedCost {
  /** Unit COGS, or null when unmapped / no cost on record. */
  unitCost: number | null;
  /** Set only when the cost came from a recipe (for per-item attribution). */
  recipeId: string | null;
}

const NO_MATCH: ResolvedCost = { unitCost: null, recipeId: null };
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Recipe wins: use the recipe total when a recipe is mapped and priced; else the
// inventory unit cost.
function resolvedFor(m: CostMapping): ResolvedCost {
  if (m.recipeId && m.recipeCost != null) return { unitCost: Number(m.recipeCost), recipeId: m.recipeId };
  return { unitCost: m.unitCost == null ? null : Number(m.unitCost), recipeId: null };
}

export interface CostLookup {
  /** Resolve unit COGS (and recipe attribution) for a pulled item. */
  resolve(item: PulledItem): ResolvedCost;
}

export function buildCostLookup(mappings: CostMapping[]): CostLookup {
  const byId = new Map<string, ResolvedCost>();
  const byName = new Map<string, ResolvedCost>();

  for (const m of mappings) {
    const resolved = resolvedFor(m);
    if (m.posItemId) byId.set(String(m.posItemId), resolved);
    if (m.posItemName) {
      byName.set(norm(m.posItemName), resolved);
      // Also index the combined "Item (Variation)" form the pull often produces.
      if (m.variationName) byName.set(norm(`${m.posItemName} (${m.variationName})`), resolved);
    }
  }

  return {
    resolve(item) {
      const id = item.catalogObjectId == null ? '' : String(item.catalogObjectId);
      if (id && byId.has(id)) return byId.get(id) ?? NO_MATCH;
      return byName.get(norm(item.name)) ?? NO_MATCH;
    },
  };
}

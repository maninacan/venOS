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
}

export interface PulledItem {
  name: string;
  catalogObjectId?: string | null;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export interface CostLookup {
  /** Unit cost for a pulled item, or null when unmapped / no cost on record. */
  unitCostFor(item: PulledItem): number | null;
}

export function buildCostLookup(mappings: CostMapping[]): CostLookup {
  const byId = new Map<string, number | null>();
  const byName = new Map<string, number | null>();

  for (const m of mappings) {
    const cost = m.unitCost == null ? null : Number(m.unitCost);
    if (m.posItemId) byId.set(String(m.posItemId), cost);
    if (m.posItemName) {
      byName.set(norm(m.posItemName), cost);
      // Also index the combined "Item (Variation)" form the pull often produces.
      if (m.variationName) byName.set(norm(`${m.posItemName} (${m.variationName})`), cost);
    }
  }

  return {
    unitCostFor(item) {
      const id = item.catalogObjectId == null ? '' : String(item.catalogObjectId);
      if (id && byId.has(id)) return byId.get(id) ?? null;
      const byNameHit = byName.get(norm(item.name));
      return byNameHit == null ? null : byNameHit;
    },
  };
}

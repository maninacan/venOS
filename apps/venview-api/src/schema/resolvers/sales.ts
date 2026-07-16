import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';
import { lookupStateFallbackRate } from '../../lib/taxRates.js';
import { providerForCompany, type PosEvent } from '../../lib/pos/index.js';
import { isPosAuthError } from '../../lib/pos/types.js';
import { buildCostLookup, norm } from '../../lib/pos/matchCost.js';
import { computeRecipeCosts, loadRecipeCostContext } from '../../lib/recipeCost.js';
import { suggestMappings } from '../../lib/aiMappingSuggest.js';

// Flag/clear the POS connection so the UI can prompt a reconnect only when a
// real auth failure has occurred (cleared on the next successful sync/reconnect).
async function markPosNeedsReauth(companyId: string, provider: string, value: boolean) {
  await supabase.from('PosConnection')
    .update({ needsReauth: value })
    .eq('companyId', companyId)
    .eq('provider', provider);
}

// Best-effort: add any synced team members not already on the company's employee
// roster (EmployeeTracker), seeding their default wage from the timecard. Never
// blocks the labor sync.
async function upsertRosterFromLabor(companyId: string, rows: Array<{ name: string; wage: number }>) {
  try {
    const byName = new Map<string, number>();
    for (const r of rows) {
      const n = (r.name ?? '').trim();
      if (n && !byName.has(n)) byName.set(n, r.wage ?? 0);
    }
    if (byName.size === 0) return;
    const { data: existing } = await supabase.from('EmployeeTracker').select('name').eq('companyId', companyId);
    const have = new Set((existing ?? []).map((e: Record<string, unknown>) => String(e['name'] ?? '').toLowerCase()));
    const toInsert = [...byName.entries()]
      .filter(([name]) => !have.has(name.toLowerCase()))
      .map(([name, wage]) => ({ companyId, name, defaultWage: wage }));
    if (toInsert.length > 0) await supabase.from('EmployeeTracker').insert(toInsert);
  } catch (err) {
    logger.warn('syncLabor: roster auto-populate failed', {
      companyId, error: err instanceof Error ? err.message : String(err),
    });
  }
}
import logger from '../../lib/logger.js';

// Resolve the POS provider a company has chosen (null for manual / unset).
async function companyProvider(companyId: string) {
  const { data } = await supabase.from('Companies').select('posSystem').eq('id', companyId).single();
  return providerForCompany((data as Record<string, unknown> | null)?.['posSystem'] as string | null);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Upsert a partial SalesSummary patch by eventID (insert the row if missing).
async function upsertSales(eventId: string, patch: Record<string, unknown>): Promise<void> {
  const { data: existing } = await supabase.from('SalesSummary').select('id').eq('eventID', eventId).single();
  const stamped = { ...patch, updatedAt: new Date().toISOString() };
  if (existing) {
    await supabase.from('SalesSummary').update(stamped).eq('eventID', eventId);
  } else {
    await supabase.from('SalesSummary').insert({ eventID: eventId, ...stamped });
  }
}

// Store the event's sales-tax rates — unless the rate was manually overridden.
// Priority: the actual taxes the POS applied (source of truth) → otherwise an
// estimate of the STATE rate from the event's ZIP (local is unknown; the user can
// refine it manually). Best-effort: no-ops when nothing can be resolved.
export async function applyTaxRates(eventId: string): Promise<void> {
  const { data: s } = await supabase.from('SalesSummary').select('taxOverride, taxLines').eq('eventID', eventId).single();
  const sRow = s as Record<string, unknown> | null;
  // A manual rate override wins over any auto-lookup.
  if (sRow?.['taxOverride']) return;

  // The POS reported the actual applied taxes — they're the source of truth. Set
  // the combined rate from them; the named breakdown is stored on taxLines and
  // surfaced directly by the events resolver.
  const taxLines = (sRow?.['taxLines'] as Array<{ rate?: number }> | null) ?? null;
  if (taxLines && taxLines.length) {
    const combined = +taxLines.reduce((sum, l) => sum + Number(l.rate ?? 0), 0).toFixed(6);
    await upsertSales(eventId, { taxRate: combined, stateTaxRate: 0, localTaxRate: 0, taxJurisdiction: null });
    return;
  }

  // No POS tax (e.g. manual/non-POS event) → estimate the state rate from the ZIP.
  const { data: ev } = await supabase.from('EventInfo').select('zipCode').eq('eventID', eventId).single();
  const zip = (ev as Record<string, unknown> | null)?.['zipCode'] as string | null;
  if (!zip) return;

  const rates = lookupStateFallbackRate(zip);
  if (!rates) return;

  await upsertSales(eventId, {
    stateTaxRate: rates.stateRate,
    localTaxRate: rates.localRate,
    taxRate: rates.combinedRate,
    taxJurisdiction: rates.jurisdiction,
  });
}

async function getEventWithCompany(eventId: string) {
  const { data } = await supabase
    .from('EventInfo')
    .select('*, EventDays(*)')
    .eq('eventID', eventId)
    .single();
  return data as Record<string, unknown> | null;
}

async function assertEventAccess(eventId: string, ctx: AppContext) {
  requireAuth(ctx);
  const event = await getEventWithCompany(eventId);
  if (!event) throw new Error('Event not found');
  await requireCompanyMember(event['companyId'] as string, ctx.user!.id);
  return event;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

export const salesResolvers = {
  Mutation: {
    updateManualSales: async (
      _: unknown,
      { eventId, input }: { eventId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);

      const grossSales = Number(input['grossSales'] ?? 0);
      const refunds = Number(input['refunds'] ?? 0);
      const discounts = Number(input['discounts'] ?? 0);
      const totalCollected = Number(input['totalCollected'] ?? 0);
      const netSales = grossSales - refunds - discounts;

      await upsertSales(eventId, { grossSales, netSales, refunds, discounts, totalCollected });
      // Best-effort: ensure state/local rates are populated from the ZIP.
      await applyTaxRates(eventId);

      const { data } = await supabase.from('SalesSummary').select('*').eq('eventID', eventId).single();
      return data;
    },

    // Manually set the state + local rates (flags an override so auto-lookup
    // won't clobber them).
    setEventTaxRates: async (
      _: unknown,
      { eventId, stateTaxRate, localTaxRate }: { eventId: string; stateTaxRate: number; localTaxRate: number },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);
      await upsertSales(eventId, {
        stateTaxRate,
        localTaxRate,
        taxRate: +(stateTaxRate + localTaxRate).toFixed(6),
        taxOverride: true,
      });
      const { data } = await supabase.from('SalesSummary').select('*').eq('eventID', eventId).single();
      return data;
    },

    // Clear the override and re-look-up rates from the event's ZIP.
    refreshEventTaxRates: async (_: unknown, { eventId }: { eventId: string }, ctx: AppContext) => {
      await assertEventAccess(eventId, ctx);
      await upsertSales(eventId, { taxOverride: false });
      await applyTaxRates(eventId);
      const { data } = await supabase.from('SalesSummary').select('*').eq('eventID', eventId).single();
      return data;
    },

    // Pull sales from the company's connected POS provider (dispatch by posSystem).
    syncSales: async (_: unknown, { eventId }: { eventId: string }, ctx: AppContext) => {
      const event = await assertEventAccess(eventId, ctx);
      const companyId = event['companyId'] as string;

      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) throw new Error('No POS is connected for this company.');
      if (!provider.capabilities.sales) throw new Error(`${provider.displayName} doesn't support sales sync.`);

      let pull;
      try {
        pull = await provider.pullSales(companyId, event as unknown as PosEvent);
      } catch (err) {
        if (isPosAuthError(err)) {
          await markPosNeedsReauth(companyId, provider.key, true);
          logger.warn('syncSales: POS auth failure', { companyId, provider: provider.key });
          throw new Error(`Your ${provider.displayName} connection has expired or was disconnected. Please reconnect ${provider.displayName} in Settings.`);
        }
        throw err;
      }
      await markPosNeedsReauth(companyId, provider.key, false);

      // Match items to inventory via POS mappings — by catalog object id first
      // (exact), then by normalized name/variation. A mapped recipe's total
      // ingredient cost wins over the inventory unit cost. See buildCostLookup.
      const { data: mappings } = await supabase
        .from('PosItemMapping')
        .select('posItemId, posItemName, variationName, inventoryId, recipeId, VendorInventory(itemName, unitCost)')
        .eq('companyId', companyId);

      // Each company recipe's total cost — composition-aware (own ingredients +
      // sub-recipe/modifier/inventory components), computed by the shared helper.
      const recipeCostById = await computeRecipeCosts(companyId);

      const costLookup = buildCostLookup((mappings ?? []).map((m: Record<string, unknown>) => ({
        posItemId: m['posItemId'] as string | null,
        posItemName: m['posItemName'] as string | null,
        variationName: m['variationName'] as string | null,
        unitCost: (m['VendorInventory'] as Record<string, unknown> | null)?.['unitCost'] as number | null,
        recipeId: m['recipeId'] as string | null,
        recipeCost: m['recipeId'] ? recipeCostById.get(m['recipeId'] as string) ?? null : null,
      })));

      // Modifier COGS: each modifier (flavor add-ons, whip, …) maps to one
      // inventory item plus an amount used per drink. Cost per application =
      // quantity × inventory.unitCost; a NEGATIVE quantity represents a removal
      // ("No SCM") that reduces COGS. Their upcharge is already in the line's
      // revenue, so we add COST only, folded into the parent line's totalCost.
      // We pre-multiply quantity into the mapping's unitCost so the shared
      // buildCostLookup/resolve returns the per-application cost directly.
      const { data: modifierMappings } = await supabase
        .from('PosModifierMapping')
        .select('posModifierId, posModifierName, inventoryId, quantity, VendorInventory(itemName, unitCost)')
        .eq('companyId', companyId);
      const modifierLookup = buildCostLookup((modifierMappings ?? []).map((m: Record<string, unknown>) => {
        const invUnitCost = (m['VendorInventory'] as Record<string, unknown> | null)?.['unitCost'] as number | null | undefined;
        const amount = m['quantity'] == null ? 1 : Number(m['quantity']);
        return {
          posItemId: m['posModifierId'] as string | null,
          posItemName: m['posModifierName'] as string | null,
          unitCost: invUnitCost == null ? null : Number(invUnitCost) * amount,
        };
      }));

      // Aggregate by display name. Square can return the same product across
      // multiple line items with different or missing catalog_object_ids (an
      // item re-created in the catalog gets a new variation id; open items have
      // none), which the pull buckets separately. Merging by normalized name
      // collapses those twins into one row. A matched variation's unit cost is
      // applied to the full combined quantity: the same product doesn't have a
      // real cost difference — an unmatched twin is just a catalog-id gap.
      type MergedRow = {
        name: string;
        qty: number;
        revenue: number;
        hasRevenue: boolean;
        modifierCost: number;
        anyModifierResolved: boolean;
        unitCost: number | null;
        recipeId: string | null;
      };
      const grouped = new Map<string, MergedRow>();
      let unmatchedModifierCount = 0;
      for (const item of pull.items) {
        const { unitCost, recipeId } = costLookup.resolve({ name: item.name, catalogObjectId: item.catalogObjectId });

        // Sum mapped modifier costs for this line (per-application cost × applied
        // count). Can be negative when a modifier removes an ingredient.
        let modifierCost = 0;
        let anyModifierResolved = false;
        for (const mod of item.modifiers ?? []) {
          const modResolved = modifierLookup.resolve({ name: mod.name, catalogObjectId: mod.catalogObjectId });
          if (modResolved.unitCost == null) { unmatchedModifierCount++; continue; }
          anyModifierResolved = true;
          modifierCost += modResolved.unitCost * mod.qty;
        }

        const key = norm(item.name);
        const g = grouped.get(key) ?? {
          name: item.name, qty: 0, revenue: 0, hasRevenue: false,
          modifierCost: 0, anyModifierResolved: false, unitCost: null, recipeId: null,
        };
        g.qty += item.qty;
        if (item.revenue != null) { g.revenue += item.revenue; g.hasRevenue = true; }
        g.modifierCost += modifierCost;
        g.anyModifierResolved = g.anyModifierResolved || anyModifierResolved;
        // Keep the first matched variation's cost/recipe; apply it to the whole group.
        if (g.unitCost == null && unitCost != null) { g.unitCost = unitCost; g.recipeId = recipeId; }
        grouped.set(key, g);
      }

      const inventoryRows: Array<Record<string, unknown>> = [];
      let unmatchedCount = 0;
      for (const g of grouped.values()) {
        if (g.unitCost == null) unmatchedCount++;
        const baseCost = g.unitCost != null ? g.unitCost * g.qty : 0;
        // totalCost is the full line COGS; null only when neither the base nor
        // any modifier cost is known (so an unmapped line stays unmatched, not $0).
        const hasAnyCost = g.unitCost != null || g.anyModifierResolved;
        inventoryRows.push({
          eventID: eventId,
          name: g.name,
          quantitySold: g.qty,
          unitCost: g.unitCost,
          totalCost: hasAnyCost ? +Number(baseCost + g.modifierCost).toFixed(4) : null,
          modifierCost: g.anyModifierResolved ? +Number(g.modifierCost).toFixed(4) : null,
          revenue: g.hasRevenue ? +Number(g.revenue).toFixed(2) : null,
          recipeId: g.recipeId,
        });
      }

      const netSales = pull.grossSales - pull.refunds - pull.discounts;
      const salesData = {
        eventID: eventId,
        grossSales: +pull.grossSales.toFixed(2),
        netSales: +netSales.toFixed(2),
        discounts: +pull.discounts.toFixed(2),
        refunds: +pull.refunds.toFixed(2),
        tips: +pull.tips.toFixed(2),
        squareFees: +pull.processingFees.toFixed(2), // POS processing fees (column kept for compat)
        totalCollected: +pull.totalCollected.toFixed(2),
        taxCollected: +pull.taxCollected.toFixed(2),
        // Actual taxes the POS applied (name + rate + amount); source of truth for
        // the Sales Tax tab. Null when the POS reported none, so applyTaxRates
        // falls back to the ZIP state estimate.
        taxLines: pull.taxLines && pull.taxLines.length ? pull.taxLines : null,
        updatedAt: new Date().toISOString(),
      };
      const { data: existingSales } = await supabase.from('SalesSummary').select('id').eq('eventID', eventId).single();
      if (existingSales) {
        await supabase.from('SalesSummary').update(salesData).eq('eventID', eventId);
      } else {
        await supabase.from('SalesSummary').insert(salesData);
      }

      await applyTaxRates(eventId);

      await supabase.from('InventorySales').delete().eq('eventID', eventId);
      if (inventoryRows.length > 0) await supabase.from('InventorySales').insert(inventoryRows);

      const modMsg = unmatchedModifierCount > 0 ? ` ${unmatchedModifierCount} modifier(s) missing cost.` : '';
      return { success: true, message: `Synced ${pull.orderCount} orders. ${unmatchedCount} item(s) missing inventory cost.${modMsg}`, unmatchedCount };
    },

    // Pull labor from the company's POS provider (only if it supports labor).
    syncLabor: async (_: unknown, { eventId }: { eventId: string }, ctx: AppContext) => {
      const event = await assertEventAccess(eventId, ctx);
      const companyId = event['companyId'] as string;

      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) throw new Error('No POS is connected for this company.');
      if (!provider.capabilities.labor) throw new Error(`${provider.displayName} doesn't support labor import.`);

      let pull;
      try {
        pull = await provider.pullLabor(companyId, event as unknown as PosEvent);
      } catch (err) {
        if (isPosAuthError(err)) {
          await markPosNeedsReauth(companyId, provider.key, true);
          logger.warn('syncLabor: POS auth failure', { companyId, provider: provider.key });
          throw new Error(`Your ${provider.displayName} connection has expired or was disconnected. Please reconnect ${provider.displayName} in Settings.`);
        }
        throw err;
      }
      await markPosNeedsReauth(companyId, provider.key, false);
      const laborRows = pull.rows.map(r => ({ eventID: eventId, name: r.name, hours: r.hours, wage: r.wage }));

      await supabase.from('EventLabor').delete().eq('eventID', eventId);
      if (laborRows.length > 0) await supabase.from('EventLabor').insert(laborRows);

      // Seed the employee roster with any new team members from this sync.
      await upsertRosterFromLabor(companyId, pull.rows);

      return { success: true, message: `Synced ${laborRows.length} timecard(s).`, unmatchedCount: 0 };
    },

    updateAdjustments: async (
      _: unknown,
      { eventId, tips, posFee }: { eventId: string; tips?: number; posFee?: number },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);
      if (posFee !== undefined) await supabase.from('EventExpenses').update({ posFee }).eq('eventID', eventId);
      if (tips !== undefined) {
        const { data: ex } = await supabase.from('SalesSummary').select('id').eq('eventID', eventId).single();
        if (ex) await supabase.from('SalesSummary').update({ tips }).eq('eventID', eventId);
      }
      return true;
    },
  },

  Query: {
    posLocations: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) return [];
      try {
        const locations = await provider.listLocations(companyId);
        await markPosNeedsReauth(companyId, provider.key, false);
        return locations;
      } catch (err) {
        // A revoked/expired token surfaces here as an auth error — flag reauth so
        // the UI prompts a reconnect instead of silently showing zero locations.
        if (isPosAuthError(err)) await markPosNeedsReauth(companyId, provider.key, true);
        logger.error('posLocations: failed to fetch locations', { companyId, error: err });
        return [];
      }
    },

    posCatalog: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) return [];
      try {
        const catalog = await provider.listCatalog(companyId);
        await markPosNeedsReauth(companyId, provider.key, false);
        return catalog;
      } catch (err) {
        if (isPosAuthError(err)) await markPosNeedsReauth(companyId, provider.key, true);
        logger.error('posCatalog: failed to fetch catalog', { companyId, error: err });
        return [];
      }
    },

    // AI-suggested POS→recipe/inventory mappings. Read-only: returns suggestions
    // for the user to review and accept in the mapping modal; saves nothing.
    // When posItemIds is provided, only those (unmapped) items are sent to the
    // model — the modal passes the still-unmapped ids so the AI never re-processes
    // items the user has already mapped.
    posMappingRecommendations: async (_: unknown, { companyId, posItemIds }: { companyId: string; posItemIds?: string[] | null }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) return [];

      let catalog;
      try { catalog = await provider.listCatalog(companyId); } catch (err) {
        logger.error('posMappingRecommendations: failed to fetch catalog', { companyId, error: err });
        return [];
      }

      // Restrict to the requested (unmapped) items. An explicit empty list means
      // nothing to do — skip the model call entirely.
      if (posItemIds != null) {
        if (posItemIds.length === 0) return [];
        const wanted = new Set(posItemIds);
        catalog = catalog.filter(c => wanted.has(c.posItemId));
        if (catalog.length === 0) return [];
      }

      const [{ data: recipeCards }, { data: invRows }, costCtx] = await Promise.all([
        supabase.from('RecipeCards').select('id, name').eq('companyId', companyId),
        supabase.from('VendorInventory').select('id, itemName, unitCost').eq('companyId', companyId),
        loadRecipeCostContext(companyId),
      ]);

      // Composition-aware recipe totals for the AI suggester.
      const recipes = (recipeCards ?? []).map((r: Record<string, unknown>) => ({
        id: r['id'] as string,
        name: r['name'] as string,
        totalCost: costCtx.costById.get(r['id'] as string) ?? 0,
      }));
      const inventory = (invRows ?? []).map((i: Record<string, unknown>) => ({
        id: i['id'] as string,
        name: i['itemName'] as string,
        unitCost: Number(i['unitCost'] ?? 0),
      }));

      try {
        return await suggestMappings(catalog, recipes, inventory);
      } catch (err) {
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        logger.error('posMappingRecommendations: AI suggestion failed', { companyId, detail, error: err });
        throw new Error('Could not generate AI suggestions. Please try again.');
      }
    },

    posModifierCatalog: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) return [];
      try { return await provider.listModifierCatalog(companyId); } catch (err) {
        logger.error('posModifierCatalog: failed to fetch modifier catalog', { companyId, error: err });
        return [];
      }
    },

    // AI-suggested modifier→recipe/inventory mappings. Read-only: returns
    // suggestions for the user to review and accept; saves nothing. Reuses the
    // item-mapping suggester by shaping each modifier as a catalog item.
    // When posModifierIds is provided, only those (unmapped) modifiers are sent
    // to the model — the modal passes the still-unmapped ids so the AI never
    // re-processes modifiers the user has already mapped.
    posModifierMappingRecommendations: async (_: unknown, { companyId, posModifierIds }: { companyId: string; posModifierIds?: string[] | null }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) return [];

      let modifiers;
      try { modifiers = await provider.listModifierCatalog(companyId); } catch (err) {
        logger.error('posModifierMappingRecommendations: failed to fetch modifier catalog', { companyId, error: err });
        return [];
      }

      // Restrict to the requested (unmapped) modifiers. An explicit empty list
      // means nothing to do — skip the model call entirely.
      if (posModifierIds != null) {
        if (posModifierIds.length === 0) return [];
        const wanted = new Set(posModifierIds);
        modifiers = modifiers.filter(m => wanted.has(m.posModifierId));
        if (modifiers.length === 0) return [];
      }

      // Modifiers are single ingredients (a pump of syrup, a scoop of whip), so
      // they map to INVENTORY items, not whole recipes. Pass no recipes to the
      // suggester so it only proposes inventory matches.
      const { data: invRows } = await supabase
        .from('VendorInventory').select('id, itemName, unitCost').eq('companyId', companyId);
      const inventory = (invRows ?? []).map((i: Record<string, unknown>) => ({
        id: i['id'] as string,
        name: i['itemName'] as string,
        unitCost: Number(i['unitCost'] ?? 0),
      }));

      // Shape modifiers as CatalogItemLite (posItemId = modifier id) so the same
      // suggester applies; map the suggestions back to posModifierId.
      const catalog = modifiers.map(m => ({ posItemId: m.posModifierId, posItemName: m.posModifierName }));
      try {
        const suggestions = await suggestMappings(catalog, [], inventory);
        return suggestions.map(s => ({
          posModifierId: s.posItemId,
          recipeId: s.recipeId,
          inventoryId: s.inventoryId,
          confidence: s.confidence,
          reason: s.reason,
        }));
      } catch (err) {
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        logger.error('posModifierMappingRecommendations: AI suggestion failed', { companyId, detail, error: err });
        throw new Error('Could not generate AI suggestions. Please try again.');
      }
    },
  },
};

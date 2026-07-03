import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';
import { decryptToken } from '../../lib/crypto.js';
import { lookupTaxRates } from '../../lib/taxRates.js';
import { providerForCompany, type PosEvent } from '../../lib/pos/index.js';
import { isPosAuthError } from '../../lib/pos/types.js';
import { buildCostLookup } from '../../lib/pos/matchCost.js';

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

// Look up state + local rates from the event's ZIP and store them — unless the
// rate was manually overridden. Best-effort: no-ops when there's no ZIP, no API
// token, or the lookup fails (rates stay at their current values / 0).
export async function applyTaxRates(eventId: string): Promise<void> {
  const { data: ev } = await supabase.from('EventInfo').select('zipCode, companyId').eq('eventID', eventId).single();
  const evRow = ev as Record<string, unknown> | null;
  const zip = evRow?.['zipCode'] as string | null;
  const companyId = evRow?.['companyId'] as string | null;
  if (!zip || !companyId) return;

  const { data: s } = await supabase.from('SalesSummary').select('taxOverride').eq('eventID', eventId).single();
  if ((s as Record<string, unknown> | null)?.['taxOverride']) return;

  // Use the company's own (encrypted) TaxJar token.
  const { data: company } = await supabase.from('Companies').select('taxjarToken').eq('id', companyId).single();
  const enc = (company as Record<string, unknown> | null)?.['taxjarToken'] as string | null;
  if (!enc) return;
  let token: string;
  try { token = decryptToken(enc); } catch { return; }

  const rates = await lookupTaxRates(zip, token);
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

      // Precompute each company recipe's total ingredient cost (qty × unitCost).
      const { data: recipeCards } = await supabase
        .from('RecipeCards')
        .select('id, RecipeIngredients(quantity, unitCost)')
        .eq('companyId', companyId);
      const recipeCostById = new Map<string, number>();
      for (const rc of (recipeCards ?? []) as Array<Record<string, unknown>>) {
        const ings = (rc['RecipeIngredients'] as Array<Record<string, unknown>> | null) ?? [];
        recipeCostById.set(
          rc['id'] as string,
          ings.reduce((sum, i) => sum + Number(i['quantity'] ?? 0) * Number(i['unitCost'] ?? 0), 0)
        );
      }

      const costLookup = buildCostLookup((mappings ?? []).map((m: Record<string, unknown>) => ({
        posItemId: m['posItemId'] as string | null,
        posItemName: m['posItemName'] as string | null,
        variationName: m['variationName'] as string | null,
        unitCost: (m['VendorInventory'] as Record<string, unknown> | null)?.['unitCost'] as number | null,
        recipeId: m['recipeId'] as string | null,
        recipeCost: m['recipeId'] ? recipeCostById.get(m['recipeId'] as string) ?? null : null,
      })));

      const inventoryRows: Array<Record<string, unknown>> = [];
      let unmatchedCount = 0;
      for (const item of pull.items) {
        const { unitCost, recipeId } = costLookup.resolve({ name: item.name, catalogObjectId: item.catalogObjectId });
        if (unitCost == null) unmatchedCount++;
        inventoryRows.push({ eventID: eventId, name: item.name, quantitySold: item.qty, unitPrice: unitCost, totalCost: unitCost != null ? unitCost * item.qty : null, recipeId });
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

      return { success: true, message: `Synced ${pull.orderCount} orders. ${unmatchedCount} item(s) missing inventory cost.`, unmatchedCount };
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
      try { return await provider.listLocations(companyId); } catch (err) {
        logger.error('posLocations: failed to fetch locations', { companyId, error: err });
        return [];
      }
    },

    posCatalog: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const provider = await companyProvider(companyId);
      if (!provider || !provider.implemented) return [];
      try { return await provider.listCatalog(companyId); } catch (err) {
        logger.error('posCatalog: failed to fetch catalog', { companyId, error: err });
        return [];
      }
    },
  },
};

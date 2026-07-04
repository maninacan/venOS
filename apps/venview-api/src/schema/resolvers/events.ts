import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';
import { computeProfit } from '../../lib/profit.js';
import { applyTaxRates } from './sales.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertEventAccess(eventId: string, ctx: AppContext) {
  requireAuth(ctx);
  const { data: event } = await supabase
    .from('EventInfo')
    .select('companyId')
    .eq('eventID', eventId)
    .single();
  if (!event) throw new Error('Event not found');
  await requireCompanyMember((event as Record<string, unknown>)['companyId'] as string, ctx.user!.id);
  return event;
}

async function buildEventReport(eventId: string) {
  const [
    { data: event },
    { data: sales },
    { data: expenses },
    { data: laborRows },
    { data: supplyRows },
    { data: additionalFees },
    { data: inventorySales },
    { data: permits },
  ] = await Promise.all([
    supabase.from('EventInfo').select('*').eq('eventID', eventId).single(),
    supabase.from('SalesSummary').select('*').eq('eventID', eventId).single(),
    supabase.from('EventExpenses').select('*').eq('eventID', eventId).single(),
    supabase.from('EventLabor').select('*').eq('eventID', eventId),
    supabase.from('EventSupplies').select('*').eq('eventID', eventId),
    supabase.from('AdditionalFees').select('*').eq('eventID', eventId),
    supabase.from('InventorySales').select('*').eq('eventID', eventId),
    supabase.from('Permits').select('*').eq('eventID', eventId),
  ]);

  if (!event) return null;

  const ev = event as Record<string, unknown>;
  const hasSquare = !!ev['posLocationId'];
  const taxRate = Number((sales as Record<string, unknown> | null)?.['taxRate'] ?? 0);

  // Recipe names for per-item COGS attribution on the Ingredient Costs tab.
  const { data: recipeNameRows } = await supabase
    .from('RecipeCards').select('id, name').eq('companyId', ev['companyId'] as string);
  const recipeNameById = new Map(
    (recipeNameRows ?? []).map((r: Record<string, unknown>) => [r['id'] as string, r['name'] as string])
  );

  // COGS = sum of InventorySales totalCost (recipe-matched costs)
  const cogs = (inventorySales ?? []).reduce(
    (sum: number, r: Record<string, unknown>) => sum + Number(r['totalCost'] ?? 0),
    0
  );
  // Total items sold — multiplier for per-unit custom expenses
  const unitsSold = (inventorySales ?? []).reduce(
    (sum: number, r: Record<string, unknown>) => sum + Number(r['quantitySold'] ?? 0),
    0
  );

  const summary = computeProfit(
    sales as Parameters<typeof computeProfit>[0],
    expenses as Parameters<typeof computeProfit>[1],
    (laborRows ?? []) as Parameters<typeof computeProfit>[2],
    (additionalFees ?? []) as Parameters<typeof computeProfit>[3],
    cogs,
    hasSquare,
    taxRate,
    unitsSold
  );

  return {
    event: {
      ...ev,
      id: ev['eventID'],
      isFinalized: Boolean(ev['isFinalized']),
      days: [],
    },
    sales,
    expenses: {
      ...(expenses ?? {}),
      laborFees: summary.laborFees,
      additionalFees: summary.additionalFeesTotal,
      suppliesTotal: (supplyRows ?? []).reduce(
        (s: number, r: Record<string, unknown>) => s + Number(r['total'] ?? 0), 0
      ),
    },
    taxes: (() => {
      const sr = sales as Record<string, unknown> | null;
      const stateRate = Number(sr?.['stateTaxRate'] ?? 0);
      const localRate = Number(sr?.['localTaxRate'] ?? 0);
      const combinedRate = Number(sr?.['taxRate'] ?? 0) || (stateRate + localRate);
      const taxBase = Number(sr?.['totalCollected'] ?? 0) || Number(sr?.['netSales'] ?? 0);
      // Square actuals are the truth when synced; otherwise compute rate × base.
      const taxCollected = ev['posLocationId']
        ? Number(sr?.['taxCollected'] ?? 0)
        : +(taxBase * combinedRate).toFixed(2);
      // State portion = the state's statutory rate applied to the base (capped at
      // what was actually collected); the remainder is local. Works whether we
      // know both rates (TaxJar) or only the state rate (ZIP fallback).
      const stateTax = stateRate > 0 ? Math.min(taxCollected, +(taxBase * stateRate).toFixed(2)) : 0;
      const localTax = +(Math.max(0, taxCollected - stateTax)).toFixed(2);
      // Where the rates came from, so the client can prompt when they're missing
      // ('none') or only estimated from the ZIP ('estimated').
      const rateSource = sr?.['taxOverride'] ? 'manual'
        : localRate > 0 ? 'taxjar'
        : stateRate > 0 ? 'estimated'
        : 'none';
      return {
        stateRate,
        localRate,
        combinedRate,
        stateTax,
        localTax,
        taxCollected,
        rateSource,
        jurisdiction: sr?.['taxJurisdiction'] ?? null,
        // legacy aliases retained for safety
        stateFoodTax: taxCollected,
        taxDetail: sr?.['taxJurisdiction'] ?? null,
      };
    })(),
    summary,
    inventorySales: (inventorySales ?? []).map((r: Record<string, unknown>) => ({
      name: r['name'],
      quantitySold: r['quantitySold'],
      unitCost: r['unitCost'],
      totalCost: r['totalCost'],
      revenue: r['revenue'],
      recipeName: r['recipeId'] ? recipeNameById.get(r['recipeId'] as string) ?? null : null,
    })),
    laborEntries: (laborRows ?? []).map((r: Record<string, unknown>) => ({
      id: r['id'],
      employeeId: r['employeeId'],
      name: r['name'],
      hours: r['hours'],
      wage: r['wage'],
      total: r['total'] ?? (Number(r['hours'] ?? 0) * Number(r['wage'] ?? 0)),
    })),
    supplies: supplyRows ?? [],
    additionalFees: (additionalFees ?? []).map((r: Record<string, unknown>) => ({
      id: r['id'],
      label: r['label'],
      amount: r['amount'],
      isDiscount: Boolean(r['isDiscount']),
      calcType: r['calcType'] ?? 'flat',
      pctBase: r['pctBase'] ?? null,
    })),
    permits: permits ?? [],
  };
}

// Strip DB-only columns not in the GraphQL Event type
const EVENT_SCHEMA_FIELDS = new Set([
  'id', 'companyId', 'eventName', 'eventDate', 'endDate', 'status', 'eventType',
  'eventHost', 'eventLocation', 'coordinator', 'notes', 'zipCode', 'country', 'posLocationId',
  'time', 'applicationDate', 'eventRating', 'permits', 'employees', 'customFields', 'numDays',
  'isFinalized', 'finalizedDate', 'days', 'netProfit',
  // joined sub-objects used for inline computation (stripped below)
  'SalesSummary', 'EventExpenses', 'EventDays',
]);

function rowToEvent(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: row['eventID'], isFinalized: Boolean(row['isFinalized']), days: [] };
  for (const key of EVENT_SCHEMA_FIELDS) {
    if (key in row && key !== 'id' && key !== 'isFinalized' && key !== 'days' &&
        key !== 'SalesSummary' && key !== 'EventExpenses' && key !== 'EventDays') {
      out[key] = row[key];
    }
  }
  return out;
}

// Columns to join so net profit can be computed with the same shared logic the
// dashboard uses (computeProfit). Labor, additional fees and COGS all feed in.
const NET_PROFIT_JOIN =
  '*, SalesSummary(*), EventExpenses(*), EventLabor(*), AdditionalFees(*), InventorySales(totalCost, quantitySold)';

// Net profit for a joined EventInfo row, using the canonical shared calculation
// so the events list, the trend chart and the dashboard all agree.
function netProfitFromRow(row: Record<string, unknown>): number {
  const sales = (row['SalesSummary'] as Record<string, unknown> | null) ?? {};
  const expenses = (row['EventExpenses'] as Record<string, unknown> | null) ?? {};
  const laborRows = (row['EventLabor'] as Record<string, unknown>[] | null) ?? [];
  const additionalFees = (row['AdditionalFees'] as Record<string, unknown>[] | null) ?? [];
  const inventorySales = (row['InventorySales'] as Record<string, unknown>[] | null) ?? [];
  const cogs = inventorySales.reduce((sum, r) => sum + Number(r['totalCost'] ?? 0), 0);
  const unitsSold = inventorySales.reduce((sum, r) => sum + Number(r['quantitySold'] ?? 0), 0);

  const summary = computeProfit(
    sales as Parameters<typeof computeProfit>[0],
    expenses as Parameters<typeof computeProfit>[1],
    laborRows as Parameters<typeof computeProfit>[2],
    additionalFees as unknown as Parameters<typeof computeProfit>[3],
    cogs,
    !!row['posLocationId'],
    Number(sales['taxRate'] ?? 0),
    unitsSold
  );
  return summary.netProfit;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

export const eventResolvers = {
  Query: {
    events: async (
      _: unknown,
      { companyId, filter, search }: { companyId: string; filter?: string; search?: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      let query = supabase
        .from('EventInfo')
        .select(NET_PROFIT_JOIN)
        .eq('companyId', companyId)
        .order('eventDate', { ascending: false });

      if (filter === 'finalized') query = query.eq('isFinalized', true);
      if (filter === 'notfinalized') query = query.eq('isFinalized', false);
      if (search) query = query.ilike('eventName', `%${search}%`);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return (data ?? []).map((row: Record<string, unknown>) => ({
        ...rowToEvent(row),
        netProfit: netProfitFromRow(row),
        sales: row['SalesSummary'] ?? null,
      }));
    },

    event: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const { data } = await supabase.from('EventInfo').select('*, EventDays(*)').eq('eventID', id).single();
      if (!data) throw new Error('Event not found');
      await requireCompanyMember((data as Record<string, unknown>)['companyId'] as string, ctx.user!.id);
      const row = data as Record<string, unknown>;
      return {
        ...rowToEvent(row),
        days: (row['EventDays'] as unknown[] ?? []).map((d) => {
          const day = d as Record<string, unknown>;
          return { id: day['id'], dayNumber: day['dayNumber'], date: day['eventDate'], startTime: day['startTime'], endTime: day['endTime'] };
        }),
      };
    },

    eventReport: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await assertEventAccess(id, ctx);
      const report = await buildEventReport(id);
      if (!report) throw new Error('Event not found');
      return report;
    },

    eventKpi: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { data } = await supabase
        .from('EventInfo')
        .select('isFinalized, SalesSummary(grossSales, netSales, squareFees), EventExpenses(*), posLocationId')
        .eq('companyId', companyId);

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      let grossSales = 0;
      let netSales = 0;
      let finalizedCount = 0;

      for (const r of rows) {
        if (r['isFinalized']) finalizedCount++;
        const s = (r['SalesSummary'] as Record<string, unknown> | null) ?? {};
        grossSales += Number(s['grossSales'] ?? 0);
        netSales   += Number(s['netSales']   ?? 0);
      }

      return {
        totalEvents: rows.length,
        finalizedCount,
        grossSales,
        netSales,
      };
    },

    eventTrend: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { data } = await supabase
        .from('EventInfo')
        .select(NET_PROFIT_JOIN)
        .eq('companyId', companyId)
        .order('eventDate', { ascending: true });

      return (data ?? []).map((r: Record<string, unknown>) => ({
        eventId: r['eventID'],
        name: r['eventName'],
        date: r['eventDate'],
        netProfit: netProfitFromRow(r),
      }));
    },
  },

  Mutation: {
    createEvent: async (
      _: unknown,
      { companyId, input }: { companyId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { days, ...eventFields } = input;

      // Default the event's country to the company's default when the client
      // didn't supply one (per-event override still wins).
      if (eventFields['country'] == null) {
        const { data: co } = await supabase
          .from('Companies').select('defaultCountry').eq('id', companyId).single();
        const def = (co as Record<string, unknown> | null)?.['defaultCountry'];
        if (def) eventFields['country'] = def;
      }

      const { data: event, error } = await supabase
        .from('EventInfo')
        .insert({ ...eventFields, companyId, userId: ctx.user!.id })
        .select()
        .single();

      if (error || !event) throw new Error(error?.message ?? 'Failed to create event');

      const eventID = (event as Record<string, unknown>)['eventID'] as string;

      // Insert EventExpenses placeholder
      await supabase.from('EventExpenses').insert({ eventID });

      // Insert days if provided
      if (Array.isArray(days) && days.length > 0) {
        await supabase.from('EventDays').insert(
          (days as Array<Record<string, unknown>>).map(d => ({ ...d, eventID }))
        );
      }

      // Best-effort: auto-look-up sales tax rates from the event ZIP.
      await applyTaxRates(eventID).catch(() => undefined);

      return rowToEvent(event as Record<string, unknown>);
    },

    // Clone an event's setup (fields + days) into a fresh, non-finalized event.
    // Does not copy sales/labor/expenses — a duplicate is a clean starting point.
    duplicateEvent: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await assertEventAccess(id, ctx);

      const { data: source } = await supabase
        .from('EventInfo')
        .select('*, EventDays(*)')
        .eq('eventID', id)
        .single();
      if (!source) throw new Error('Event not found');

      const s = source as Record<string, unknown>;
      const srcDays = (s['EventDays'] as Array<Record<string, unknown>> | null) ?? [];
      // Strip identity/finalization/derived columns; keep the rest of the setup.
      const {
        eventID: _e, createdAt: _c, isFinalized: _f, finalizedDate: _fd, EventDays: _d,
        ...fields
      } = s;

      const { data: event, error } = await supabase
        .from('EventInfo')
        .insert({
          ...fields,
          eventName: `${(s['eventName'] as string) ?? 'Event'} (Copy)`,
          isFinalized: false,
          finalizedDate: null,
          userId: ctx.user!.id,
        })
        .select()
        .single();
      if (error || !event) throw new Error(error?.message ?? 'Failed to duplicate event');

      const newId = (event as Record<string, unknown>)['eventID'] as string;
      await supabase.from('EventExpenses').insert({ eventID: newId });

      if (srcDays.length > 0) {
        await supabase.from('EventDays').insert(
          srcDays.map(d => {
            const { id: _di, eventID: _de, ...dd } = d;
            return { ...dd, eventID: newId };
          })
        );
      }

      await applyTaxRates(newId).catch(() => undefined);
      return rowToEvent(event as Record<string, unknown>);
    },

    updateEvent: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await assertEventAccess(id, ctx);

      const { days, ...eventFields } = input;

      const { data, error } = await supabase
        .from('EventInfo')
        .update(eventFields)
        .eq('eventID', id)
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to update event');

      if (Array.isArray(days)) {
        await supabase.from('EventDays').delete().eq('eventID', id);
        if (days.length > 0) {
          await supabase.from('EventDays').insert(
            (days as Array<Record<string, unknown>>).map(d => ({ ...d, eventID: id }))
          );
        }
      }

      // Re-look-up tax rates when the event ZIP changes (best-effort).
      if ('zipCode' in eventFields) await applyTaxRates(id).catch(() => undefined);

      return rowToEvent(data as Record<string, unknown>);
    },

    deleteEvent: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await assertEventAccess(id, ctx);
      await supabase.from('EventInfo').delete().eq('eventID', id);
      return true;
    },

    finalizeEvent: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const eventAccess = await assertEventAccess(id, ctx);
      const companyId = (eventAccess as Record<string, unknown>)['companyId'] as string;

      // Check company plan for Starter limit (1 finalized event)
      const { data: company } = await supabase
        .from('Companies')
        .select('plan')
        .eq('id', companyId)
        .single();

      if ((company as Record<string, unknown> | null)?.['plan'] === 'starter') {
        const { count } = await supabase
          .from('EventInfo')
          .select('eventID', { count: 'exact', head: true })
          .eq('companyId', companyId)
          .eq('isFinalized', true);

        if ((count ?? 0) >= 1) {
          throw new Error('FINALIZE_LIMIT_REACHED: Starter plan allows 1 finalized event. Upgrade to Pro.');
        }
      }

      const { data, error } = await supabase
        .from('EventInfo')
        .update({ isFinalized: true, finalizedDate: new Date().toISOString().split('T')[0] })
        .eq('eventID', id)
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to finalize event');
      return rowToEvent(data as Record<string, unknown>);
    },

    claimUnownedEvents: async (
      _: unknown,
      { companyId }: { companyId: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { data, error } = await supabase
        .from('EventInfo')
        .update({ companyId })
        .eq('userId', ctx.user!.id)
        .is('companyId', null)
        .select('eventID');

      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
  },

  Permit: {
    // Mint a short-lived signed URL on read — permit files live in a private bucket.
    fileUrl: async (permit: Record<string, unknown>) => {
      const path = permit['filePath'] as string | null;
      if (!path) return (permit['fileUrl'] as string | null) ?? null;
      const { data } = await supabase.storage
        .from('venview-permits')
        .createSignedUrl(path, 60 * 60);
      return data?.signedUrl ?? null;
    },
  },
};

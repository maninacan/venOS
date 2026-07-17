import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';

async function checkAndCreateAlerts(companyId: string) {
  // Check items at/below reorder threshold and create alerts for new ones
  const { data: lowItems } = await supabase
    .from('VendorInventory')
    .select('id, itemName, quantityOnHand, reorderThreshold')
    .eq('companyId', companyId)
    .not('reorderThreshold', 'is', null)
    .filter('quantityOnHand', 'lte', 'reorderThreshold');

  for (const item of (lowItems ?? []) as Array<Record<string, unknown>>) {
    // Only create if there's no unread alert for this item
    const { data: existing } = await supabase
      .from('InventoryAlerts')
      .select('id')
      .eq('companyId', companyId)
      .eq('itemId', item['id'])
      .eq('isRead', false)
      .single();

    if (!existing) {
      await supabase.from('InventoryAlerts').insert({
        companyId,
        itemId: item['id'],
        triggeredAt: new Date().toISOString(),
        isRead: false,
      });
    }
  }
}

export const inventoryResolvers = {
  Query: {
    inventory: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data, error } = await supabase
        .from('VendorInventory')
        .select('*')
        .eq('companyId', companyId)
        .order('itemName');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: Record<string, unknown>) => ({ ...r, id: r['id'], name: r['itemName'] }));
    },

    inventoryAlerts: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data } = await supabase
        .from('InventoryAlerts')
        .select('*, VendorInventory(id, itemName, unitCost, quantityOnHand, reorderThreshold)')
        .eq('companyId', companyId)
        .order('triggeredAt', { ascending: false });
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r['id'],
        isRead: r['isRead'],
        triggeredAt: r['triggeredAt'],
        item: {
          id: (r['VendorInventory'] as Record<string, unknown>)?.['id'],
          name: (r['VendorInventory'] as Record<string, unknown>)?.['itemName'],
          companyId,
          unitCost: (r['VendorInventory'] as Record<string, unknown>)?.['unitCost'],
          quantityOnHand: (r['VendorInventory'] as Record<string, unknown>)?.['quantityOnHand'],
          reorderThreshold: (r['VendorInventory'] as Record<string, unknown>)?.['reorderThreshold'],
        },
      }));
    },

    lowStockItems: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data } = await supabase
        .from('VendorInventory')
        .select('*')
        .eq('companyId', companyId)
        .not('reorderThreshold', 'is', null);
      return (data ?? [])
        .filter((r: Record<string, unknown>) => Number(r['quantityOnHand'] ?? 0) <= Number(r['reorderThreshold'] ?? 0))
        .map((r: Record<string, unknown>) => ({ ...r, id: r['id'], name: r['itemName'] }));
    },

    posMappings: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data } = await supabase
        .from('PosItemMapping')
        .select('*')
        .eq('companyId', companyId);
      // DB stores `inventoryId`; the GraphQL field is `inventoryItemId`. Map it
      // (and pass recipeId through) so the mapping modal can prefill saved values.
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        inventoryItemId: r['inventoryId'] ?? null,
        recipeId: r['recipeId'] ?? null,
      }));
    },

    posModifierMappings: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data } = await supabase
        .from('PosModifierMapping')
        .select('*')
        .eq('companyId', companyId);
      // DB stores `inventoryId`; the GraphQL field is `inventoryItemId`.
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        inventoryItemId: r['inventoryId'] ?? null,
        recipeId: r['recipeId'] ?? null,
        quantity: r['quantity'] ?? null,
      }));
    },

    eventInventory: async (_: unknown, { eventId }: { eventId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const { data } = await supabase
        .from('EventInventory')
        .select('*, VendorInventory(id, itemName, unitCost, category)')
        .eq('eventID', eventId);
      return (data ?? []).map((r: Record<string, unknown>) => {
        const inv = r['VendorInventory'] as Record<string, unknown>;
        const loaded = Number(r['quantityLoaded'] ?? 0);
        const sold = Number(r['quantitySold'] ?? 0);
        return {
          id: r['id'],
          quantityLoaded: loaded,
          quantitySold: sold,
          quantityRemaining: loaded - sold,
          item: { id: inv?.['id'], name: inv?.['itemName'], companyId: '', unitCost: inv?.['unitCost'], category: inv?.['category'], quantityOnHand: 0 },
        };
      });
    },
  },

  Mutation: {
    createInventoryItem: async (
      _: unknown,
      { companyId, input }: { companyId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      // Map 'name' → 'itemName' for the DB column. VendorInventory is scoped by
      // companyId (there is no userId column — including one makes PostgREST reject
      // the insert with "Could not find the 'userId' column").
      const dbInput: Record<string, unknown> = { ...input, companyId, updatedAt: new Date().toISOString() };
      if ('name' in dbInput) { dbInput['itemName'] = dbInput['name']; delete dbInput['name']; }

      // Upsert by itemName within company so re-imports update rather than duplicate
      const { data, error } = await supabase
        .from('VendorInventory')
        .upsert(dbInput, { onConflict: 'companyId,itemName' })
        .select()
        .single();

      if (error) throw new Error(error.message);

      const row = data as Record<string, unknown>;
      const qty = Number(row['quantityOnHand'] ?? 0);
      const threshold = Number(row['reorderThreshold'] ?? 0);
      if (threshold > 0 && qty <= threshold) {
        await checkAndCreateAlerts(companyId);
      }

      return { ...row, id: row['id'], name: row['itemName'] };
    },

    updateInventoryItem: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);

      // Map 'name' → 'itemName' for the DB column
      const dbInput: Record<string, unknown> = { ...input };
      if ('name' in dbInput) { dbInput['itemName'] = dbInput['name']; delete dbInput['name']; }
      dbInput['updatedAt'] = new Date().toISOString();

      const { data, error } = await supabase
        .from('VendorInventory')
        .update(dbInput)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Check if we need to create reorder alert
      const row = data as Record<string, unknown>;
      const qty = Number(row['quantityOnHand'] ?? 0);
      const threshold = Number(row['reorderThreshold'] ?? 0);
      if (threshold > 0 && qty <= threshold) {
        await checkAndCreateAlerts(row['companyId'] as string);
      }

      return { ...row, id: row['id'], name: row['itemName'] };
    },

    deleteInventoryItem: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('VendorInventory').delete().eq('id', id);
      return true;
    },

    clearInventory: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      await supabase.from('VendorInventory').delete().eq('companyId', companyId);
      return true;
    },

    savePosMappings: async (
      _: unknown,
      { companyId, mappings }: { companyId: string; mappings: Array<Record<string, unknown>> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      // The POS system is determined by the company's configured provider —
      // never trust a client-supplied value.
      const { data: companyRow } = await supabase
        .from('Company')
        .select('posSystem')
        .eq('id', companyId)
        .single();
      const posSystem = companyRow?.posSystem ?? 'square';

      // Delete existing and replace
      await supabase.from('PosItemMapping').delete().eq('companyId', companyId);

      const toInsert = mappings
        .filter(m => m['posItemId'])
        .map(m => ({
          companyId,
          posSystem,
          posItemId: m['posItemId'],
          posItemName: m['posItemName'],
          variationName: m['variationName'],
          inventoryId: m['inventoryId'] || null,
          recipeId: m['recipeId'] || null,
        }));

      if (toInsert.length > 0) {
        await supabase.from('PosItemMapping').insert(toInsert);
      }
      return true;
    },

    savePosModifierMappings: async (
      _: unknown,
      { companyId, mappings }: { companyId: string; mappings: Array<Record<string, unknown>> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      // The POS system is determined by the company's configured provider —
      // never trust a client-supplied value.
      const { data: companyRow } = await supabase
        .from('Company')
        .select('posSystem')
        .eq('id', companyId)
        .single();
      const posSystem = companyRow?.posSystem ?? 'square';

      // Delete existing and replace
      await supabase.from('PosModifierMapping').delete().eq('companyId', companyId);

      const toInsert = mappings
        .filter(m => m['posModifierId'])
        .map(m => ({
          companyId,
          posSystem,
          posModifierId: m['posModifierId'],
          posModifierName: m['posModifierName'],
          inventoryId: m['inventoryId'] || null,
          recipeId: m['recipeId'] || null,
          quantity: m['quantity'] == null ? 1 : Number(m['quantity']),
        }));

      if (toInsert.length > 0) {
        await supabase.from('PosModifierMapping').insert(toInsert);
      }
      return true;
    },

    updateEventInventory: async (
      _: unknown,
      { eventId, inventoryItemId, quantityLoaded }: { eventId: string; inventoryItemId: string; quantityLoaded: number },
      ctx: AppContext
    ) => {
      requireAuth(ctx);

      const upsertData = { eventID: eventId, inventoryItemId, quantityLoaded };
      const { data, error } = await supabase
        .from('EventInventory')
        .upsert(upsertData, { onConflict: 'eventID,inventoryItemId' })
        .select('*, VendorInventory(id, itemName, unitCost, category)')
        .single();

      if (error) throw new Error(error.message);
      const row = data as Record<string, unknown>;
      const inv = row['VendorInventory'] as Record<string, unknown>;
      const loaded = Number(row['quantityLoaded'] ?? 0);
      const sold = Number(row['quantitySold'] ?? 0);
      return {
        id: row['id'],
        quantityLoaded: loaded,
        quantitySold: sold,
        quantityRemaining: loaded - sold,
        item: { id: inv?.['id'], name: inv?.['itemName'], companyId: '', unitCost: inv?.['unitCost'], category: inv?.['category'], quantityOnHand: 0 },
      };
    },

    restockEventInventory: async (
      _: unknown,
      { eventId, eventInventoryId, quantity }: { eventId: string; eventInventoryId: string; quantity: number },
      ctx: AppContext
    ) => {
      requireAuth(ctx);

      // Get the EventInventory record
      const { data: ei } = await supabase
        .from('EventInventory')
        .select('*, VendorInventory(*)')
        .eq('id', eventInventoryId)
        .single();

      if (!ei) throw new Error('Event inventory record not found');
      const row = ei as Record<string, unknown>;
      const inv = row['VendorInventory'] as Record<string, unknown>;
      const invId = inv?.['id'] as string;

      // Add quantity back to warehouse stock
      const currentQty = Number(inv?.['quantityOnHand'] ?? 0);
      await supabase
        .from('VendorInventory')
        .update({ quantityOnHand: currentQty + quantity, updatedAt: new Date().toISOString() })
        .eq('id', invId);

      // Return updated EventInventory
      const loaded = Number(row['quantityLoaded'] ?? 0);
      const sold = Number(row['quantitySold'] ?? 0);
      return {
        id: row['id'],
        quantityLoaded: loaded,
        quantitySold: sold,
        quantityRemaining: loaded - sold,
        item: { id: inv?.['id'], name: inv?.['itemName'], companyId: '', unitCost: inv?.['unitCost'], category: inv?.['category'], quantityOnHand: currentQty + quantity },
      };
    },

    markAlertRead: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('InventoryAlerts').update({ isRead: true }).eq('id', id);
      return true;
    },

    markAllAlertsRead: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      await supabase.from('InventoryAlerts').update({ isRead: true }).eq('companyId', companyId);
      return true;
    },
  },
};

import type { AppContext } from '../../context/index.js';
import { requireAuth } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';

async function assertEventAccess(eventId: string, ctx: AppContext) {
  requireAuth(ctx);
  const { data } = await supabase.from('EventInfo').select('companyId').eq('eventID', eventId).single();
  if (!data) throw new Error('Event not found');
  const { requireCompanyMember } = await import('../../context/index.js');
  await requireCompanyMember((data as Record<string, unknown>)['companyId'] as string, ctx.user!.id);
}

export const expenseResolvers = {
  Mutation: {
    updateExpenses: async (
      _: unknown,
      { eventId, input }: { eventId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);

      const { data: existing } = await supabase
        .from('EventExpenses')
        .select('id')
        .eq('eventID', eventId)
        .single();

      const upsertData = { ...input, eventID: eventId };

      if (existing) {
        const { data, error } = await supabase
          .from('EventExpenses')
          .update(input)
          .eq('eventID', eventId)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      } else {
        const { data, error } = await supabase
          .from('EventExpenses')
          .insert(upsertData)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      }
    },

    updateAdjustments: async (
      _: unknown,
      { eventId, tips, posFee }: { eventId: string; tips?: number; posFee?: number },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);

      const updates: Record<string, unknown> = {};
      if (posFee !== undefined) updates['posFee'] = posFee;

      if (Object.keys(updates).length > 0) {
        await supabase.from('EventExpenses').update(updates).eq('eventID', eventId);
      }

      if (tips !== undefined) {
        await supabase
          .from('SalesSummary')
          .update({ tips })
          .eq('eventID', eventId);
      }

      return true;
    },

    createAdditionalFee: async (
      _: unknown,
      { eventId, input }: { eventId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);
      const { data, error } = await supabase
        .from('AdditionalFees')
        .insert({ ...input, eventID: eventId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    updateAdditionalFee: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const { data, error } = await supabase
        .from('AdditionalFees')
        .update(input)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    deleteAdditionalFee: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('AdditionalFees').delete().eq('id', id);
      return true;
    },

    createSupply: async (
      _: unknown,
      { eventId, input }: { eventId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);
      const { data, error } = await supabase
        .from('EventSupplies')
        .insert({ ...input, eventID: eventId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    updateSupply: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const { data, error } = await supabase
        .from('EventSupplies')
        .update(input)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    deleteSupply: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('EventSupplies').delete().eq('id', id);
      return true;
    },
  },
};

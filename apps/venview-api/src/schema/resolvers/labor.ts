import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';

async function assertEventAccess(eventId: string, ctx: AppContext) {
  requireAuth(ctx);
  const { data } = await supabase.from('EventInfo').select('companyId').eq('eventID', eventId).single();
  if (!data) throw new Error('Event not found');
  await requireCompanyMember((data as Record<string, unknown>)['companyId'] as string, ctx.user!.id);
}

// Recompute and store laborFees total in EventExpenses (ceiling per shift, matching client Labor Card)
async function syncLaborFees(eventId: string) {
  const { data: rows } = await supabase
    .from('EventLabor')
    .select('hours, wage, total')
    .eq('eventID', eventId);

  const laborFees = (rows ?? []).reduce((sum: number, r: Record<string, unknown>) => {
    const shiftTotal = Number(r['total'] ?? 0) || (Number(r['hours'] ?? 0) * Number(r['wage'] ?? 0));
    return sum + Math.ceil(shiftTotal * 100) / 100;
  }, 0);

  // Upsert EventExpenses row if it doesn't exist
  const { data: existing } = await supabase
    .from('EventExpenses')
    .select('id')
    .eq('eventID', eventId)
    .single();

  if (existing) {
    await supabase.from('EventExpenses').update({ laborFees }).eq('eventID', eventId);
  } else {
    await supabase.from('EventExpenses').insert({ eventID: eventId, laborFees });
  }
}

export const laborResolvers = {
  Mutation: {
    createLaborEntry: async (
      _: unknown,
      { eventId, input }: { eventId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      await assertEventAccess(eventId, ctx);
      const { data, error } = await supabase
        .from('EventLabor')
        .insert({ ...input, eventID: eventId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      await syncLaborFees(eventId);
      const row = data as Record<string, unknown>;
      return {
        ...row,
        total: Number(row['total'] ?? 0) || (Number(row['hours'] ?? 0) * Number(row['wage'] ?? 0)),
      };
    },

    updateLaborEntry: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const { data, error } = await supabase
        .from('EventLabor')
        .update(input)
        .eq('id', id)
        .select('*, eventID')
        .single();
      if (error) throw new Error(error.message);
      const row = data as Record<string, unknown>;
      await syncLaborFees(row['eventID'] as string);
      return {
        ...row,
        total: Number(row['total'] ?? 0) || (Number(row['hours'] ?? 0) * Number(row['wage'] ?? 0)),
      };
    },

    deleteLaborEntry: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const { data } = await supabase.from('EventLabor').select('eventID').eq('id', id).single();
      await supabase.from('EventLabor').delete().eq('id', id);
      if (data) await syncLaborFees((data as Record<string, unknown>)['eventID'] as string);
      return true;
    },

    createEmployee: async (
      _: unknown,
      { companyId, name, defaultWage }: { companyId: string; name: string; defaultWage?: number },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data, error } = await supabase
        .from('EmployeeTracker')
        .insert({ companyId, name, defaultWage: defaultWage ?? 0 })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    updateEmployee: async (
      _: unknown,
      { id, name, defaultWage }: { id: string; name?: string; defaultWage?: number },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates['name'] = name;
      if (defaultWage !== undefined) updates['defaultWage'] = defaultWage;
      const { data, error } = await supabase
        .from('EmployeeTracker')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    deleteEmployee: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('EmployeeTracker').delete().eq('id', id);
      return true;
    },
  },

  Query: {
    employees: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);
      const { data } = await supabase
        .from('EmployeeTracker')
        .select('*')
        .eq('companyId', companyId)
        .order('name');
      return data ?? [];
    },
  },
};

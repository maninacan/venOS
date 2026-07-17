import type { AppContext } from '../../context/index.js';
import { requireAuth } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';

export const userResolvers = {
  Query: {
    me: async (_: unknown, __: unknown, ctx: AppContext) => {
      requireAuth(ctx);

      const { data: memberships } = await supabase
        .from('CompanyMembers')
        .select('companyId, role, status, lastRemindedAt')
        .eq('userId', ctx.user.id)
        .in('status', ['active', 'pending']);

      const all = (memberships ?? []) as Array<Record<string, unknown>>;
      const ids = all.map(m => m['companyId']).filter(Boolean);

      const { data: companiesData } = ids.length > 0
        ? await supabase.from('Companies').select('*').in('id', ids)
        : { data: [] };

      const companyMap = new Map(
        (companiesData ?? []).map((c: Record<string, unknown>) => [String(c['id']), c])
      );

      const buildList = (status: string) =>
        all
          .filter(row => row['status'] === status)
          .map(row => {
            const company = companyMap.get(String(row['companyId']));
            if (!company) return null;
            return { ...company, myRole: row['role'], lastRemindedAt: row['lastRemindedAt'] ?? null };
          })
          .filter(Boolean);

      return {
        id: ctx.user.id,
        email: ctx.user.email,
        isSuperAdmin: ctx.isSuperAdmin,
        companies: buildList('active'),
        pendingCompanies: buildList('pending'),
      };
    },
  },
};

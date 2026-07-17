import type { Request } from 'express';
import { supabase } from '../lib/supabase.js';

export interface AppContext {
  user: { id: string; email: string } | null;
  isSuperAdmin: boolean;
}

export async function createContext(req: Request): Promise<AppContext> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, isSuperAdmin: false };
  }

  const token = authHeader.slice(7);
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return { user: null, isSuperAdmin: false };

    const email = data.user.email ?? '';
    return {
      user: { id: data.user.id, email },
      isSuperAdmin: data.user.app_metadata?.['role'] === 'super_admin',
    };
  } catch {
    return { user: null, isSuperAdmin: false };
  }
}

export function requireAuth(ctx: AppContext): asserts ctx is AppContext & { user: NonNullable<AppContext['user']> } {
  if (!ctx.user) throw new Error('Unauthorized');
}

export async function requireCompanyMember(
  companyId: string,
  userId: string
): Promise<{ role: string }> {
  const { data, error } = await supabase
    .from('CompanyMembers')
    .select('role')
    .eq('companyId', companyId)
    .eq('userId', userId)
    .eq('status', 'active')
    .single();

  if (error || !data) throw new Error('Forbidden: not a member of this company');
  return data as { role: string };
}

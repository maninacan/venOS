import { randomBytes } from 'crypto';
import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';
import { encryptToken } from '../../lib/crypto.js';
import { verifyTaxjarToken } from '../../lib/taxRates.js';
import { sendWelcomeEmail, sendJoinRequestEmail } from '../../lib/email.js';
import logger from '../../lib/logger.js';

function generateJoinCode(): string {
  return randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

// Look up an auth user by email (paging through the admin list). Returns null
// if not found. Email match is case-insensitive.
async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const found = data.users.find(u => (u.email ?? '').toLowerCase() === target);
    if (found) return { id: found.id };
    if (data.users.length < perPage) return null;
  }
  return null;
}

// Load a company's members of a given status, resolving emails from auth.
async function membersByStatus(companyId: string, status: 'active' | 'pending') {
  const { data } = await supabase
    .from('CompanyMembers')
    .select('userId, role')
    .eq('companyId', companyId)
    .eq('status', status);

  if (!data) return [];

  return Promise.all(
    (data as Array<{ userId: string; role: string }>).map(async (m) => {
      const { data: user } = await supabase.auth.admin.getUserById(m.userId);
      return { userId: m.userId, email: user?.user?.email ?? '', role: m.role };
    })
  );
}

export const companyResolvers = {
  Query: {
    company: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(id, ctx.user.id);

      const { data, error } = await supabase
        .from('Companies')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) throw new Error('Company not found');
      return data;
    },
  },

  Mutation: {
    createCompany: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);

      const joinCode = generateJoinCode();
      const { data: company, error } = await supabase
        .from('Companies')
        .insert({
          ...input,
          ownerId: ctx.user.id,
          joinCode,
          plan: 'starter',
        })
        .select()
        .single();

      if (error || !company) throw new Error(error?.message ?? 'Failed to create company');

      // Add owner as member
      await supabase.from('CompanyMembers').insert({
        companyId: (company as Record<string, unknown>)['id'],
        userId: ctx.user.id,
        role: 'owner',
        joinedAt: new Date().toISOString(),
      });

      // Best-effort welcome email — never block company creation on email.
      if (ctx.user.email) {
        const companyRow = company as Record<string, unknown>;
        const companyName = companyRow['name'] as string;
        const newCompanyId = companyRow['id'] as string;
        sendWelcomeEmail(ctx.user.email, companyName, newCompanyId).catch(err =>
          logger.error('createCompany: welcome email failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }

      return company;
    },

    updateCompany: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(id, ctx.user.id);

      const { data, error } = await supabase
        .from('Companies')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to update company');
      return data;
    },

    deleteCompany: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const member = await requireCompanyMember(id, ctx.user.id);
      if (member.role !== 'owner') throw new Error('Only the owner can delete a company');

      await supabase.from('Companies').delete().eq('id', id);
      return true;
    },

    // Submit a request to join a company by its join code. Creates a PENDING
    // membership the owner must approve — it does not grant access.
    requestAccess: async (_: unknown, { joinCode }: { joinCode: string }, ctx: AppContext) => {
      requireAuth(ctx);

      const { data: company, error } = await supabase
        .from('Companies')
        .select('id, name, ownerId')
        .eq('joinCode', joinCode.toUpperCase())
        .single();

      if (error || !company) throw new Error('Invalid join code');

      const companyId = (company as Record<string, unknown>)['id'] as string;
      const companyName = (company as Record<string, unknown>)['name'] as string;
      const ownerId = (company as Record<string, unknown>)['ownerId'] as string;

      // Already has a row? Report its current status instead of duplicating.
      const { data: existing } = await supabase
        .from('CompanyMembers')
        .select('status')
        .eq('companyId', companyId)
        .eq('userId', ctx.user.id)
        .single();

      if (existing) {
        const status = (existing as Record<string, unknown>)['status'] as string;
        return { companyName, status: status === 'active' ? 'active' : 'pending' };
      }

      await supabase.from('CompanyMembers').insert({
        companyId,
        userId: ctx.user.id,
        role: 'member',
        status: 'pending',
        joinedAt: new Date().toISOString(),
      });

      // Best-effort: notify the owner so they can approve/deny in team settings.
      if (ownerId) {
        supabase.auth.admin.getUserById(ownerId)
          .then(({ data }) => {
            const ownerEmail = data?.user?.email;
            if (ownerEmail) {
              return sendJoinRequestEmail(ownerEmail, {
                companyId,
                companyName,
                requesterEmail: ctx.user.email || undefined,
              });
            }
            return false;
          })
          .catch(err => logger.error('requestAccess: join-request email failed', {
            error: err instanceof Error ? err.message : String(err),
          }));
      }

      return { companyName, status: 'pending' };
    },

    // Re-notify the owner about the caller's own PENDING join request.
    // Rate-limited to one reminder per company per REMINDER_COOLDOWN_MS.
    remindJoinRequest: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);

      const { data: membership } = await supabase
        .from('CompanyMembers')
        .select('status, lastRemindedAt')
        .eq('companyId', companyId)
        .eq('userId', ctx.user.id)
        .single();

      const row = membership as Record<string, unknown> | null;
      if (!row || row['status'] !== 'pending') {
        throw new Error('No pending join request found for this company.');
      }

      const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per day
      const last = row['lastRemindedAt'] as string | null;
      if (last) {
        const elapsed = Date.now() - new Date(last).getTime();
        if (elapsed < REMINDER_COOLDOWN_MS) {
          const hrs = Math.ceil((REMINDER_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
          throw new Error(`You already sent a reminder recently. You can send another in about ${hrs} hour${hrs === 1 ? '' : 's'}.`);
        }
      }

      const { data: company } = await supabase
        .from('Companies').select('name, ownerId').eq('id', companyId).single();
      if (!company) throw new Error('Company not found');
      const companyName = (company as Record<string, unknown>)['name'] as string;
      const ownerId = (company as Record<string, unknown>)['ownerId'] as string;

      const { data: ownerData } = await supabase.auth.admin.getUserById(ownerId);
      const ownerEmail = ownerData?.user?.email;
      const sent = ownerEmail
        ? await sendJoinRequestEmail(ownerEmail, {
            companyId,
            companyName,
            requesterEmail: ctx.user.email || undefined,
            reminder: true,
          })
        : false;

      // Only start the cooldown once a reminder actually went out, so a transient
      // email failure doesn't lock the user out for a day.
      if (!sent) throw new Error('Could not send the reminder right now. Please try again later.');

      const now = new Date().toISOString();
      await supabase.from('CompanyMembers')
        .update({ lastRemindedAt: now })
        .eq('companyId', companyId)
        .eq('userId', ctx.user.id);

      return { ok: true, lastRemindedAt: now };
    },

    // Owner approves a pending access request, promoting it to an active member.
    approveMember: async (
      _: unknown,
      { companyId, userId }: { companyId: string; userId: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role !== 'owner') throw new Error('Only the owner can approve requests');

      await supabase
        .from('CompanyMembers')
        .update({ status: 'active' })
        .eq('companyId', companyId)
        .eq('userId', userId);

      return true;
    },

    // Owner invites a user by email. Existing users are added directly (the
    // owner is vouching for them); unknown emails get a Supabase invite email
    // and are added as members so they're in once they accept.
    inviteMember: async (
      _: unknown,
      { companyId, email }: { companyId: string; email: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role !== 'owner') throw new Error('Only the owner can invite members');

      const normalized = email.trim().toLowerCase();
      if (!normalized) throw new Error('Email required');

      let userId: string;
      let invited = false;

      const existingUser = await findUserByEmail(normalized);
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const redirectTo = `${process.env['CLIENT_URL'] ?? ''}/auth`;
        const { data, error } = await supabase.auth.admin.inviteUserByEmail(normalized, { redirectTo });
        if (error || !data?.user) throw new Error(error?.message ?? 'Failed to send invite email');
        userId = data.user.id;
        invited = true;
      }

      const { data: existingMember } = await supabase
        .from('CompanyMembers')
        .select('status')
        .eq('companyId', companyId)
        .eq('userId', userId)
        .single();

      if (existingMember) {
        if ((existingMember as Record<string, unknown>)['status'] === 'active') {
          return { email: normalized, status: 'exists' };
        }
        // Promote a prior pending request straight to active.
        await supabase
          .from('CompanyMembers')
          .update({ status: 'active' })
          .eq('companyId', companyId)
          .eq('userId', userId);
        return { email: normalized, status: 'added' };
      }

      await supabase.from('CompanyMembers').insert({
        companyId,
        userId,
        role: 'member',
        status: 'active',
        joinedAt: new Date().toISOString(),
      });

      return { email: normalized, status: invited ? 'invited' : 'added' };
    },

    // Save onboarding answers (POS choice + labor method). Any active member can set.
    setCompanyProfile: async (
      _: unknown,
      { companyId, posSystem, laborMethod }: { companyId: string; posSystem?: string | null; laborMethod?: string | null },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user.id);

      const patch: Record<string, unknown> = {};
      if (posSystem !== undefined) patch['posSystem'] = posSystem;
      if (laborMethod !== undefined) patch['laborMethod'] = laborMethod;

      const { data, error } = await supabase
        .from('Companies')
        .update(patch)
        .eq('id', companyId)
        .select()
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to save company profile');
      return data;
    },

    // Store the company's own TaxJar API token, encrypted at rest (owner only).
    setTaxjarToken: async (
      _: unknown,
      { companyId, token }: { companyId: string; token: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role !== 'owner') throw new Error('Only the owner can manage integrations');
      const trimmed = token.trim();
      if (!trimmed) throw new Error('Token required');

      // Verify before storing so a bad token is rejected immediately.
      const check = await verifyTaxjarToken(trimmed);
      if (check === 'invalid') throw new Error('That TaxJar API token was rejected. Double-check it in app.taxjar.com → Account → API Access.');
      if (check === 'unreachable') throw new Error('Could not reach TaxJar to verify the token. Please try again in a moment.');

      await supabase.from('Companies').update({ taxjarToken: encryptToken(trimmed) }).eq('id', companyId);
      return true;
    },

    removeTaxjarToken: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role !== 'owner') throw new Error('Only the owner can manage integrations');
      await supabase.from('Companies').update({ taxjarToken: null }).eq('id', companyId);
      return true;
    },

    leaveCompany: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role === 'owner') {
        throw new Error('Owners must transfer ownership or delete the company before leaving.');
      }

      await supabase
        .from('CompanyMembers')
        .delete()
        .eq('companyId', companyId)
        .eq('userId', ctx.user.id);

      return true;
    },

    // Owner offers ownership to another active member. Nothing changes until the
    // recipient accepts — this just records the pending offer.
    offerOwnership: async (
      _: unknown,
      { companyId, newOwnerId }: { companyId: string; newOwnerId: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role !== 'owner') throw new Error('Only the owner can transfer ownership');
      if (newOwnerId === ctx.user.id) throw new Error('You are already the owner');

      const { data: target } = await supabase
        .from('CompanyMembers')
        .select('userId')
        .eq('companyId', companyId)
        .eq('userId', newOwnerId)
        .eq('status', 'active')
        .single();
      if (!target) throw new Error('The new owner must be an active member of the company');

      await supabase.from('Companies').update({ pendingOwnerId: newOwnerId }).eq('id', companyId);
      return true;
    },

    // Recipient of a pending offer accepts: roles swap and ownership moves.
    acceptOwnership: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user.id);

      const { data: company } = await supabase
        .from('Companies')
        .select('ownerId, pendingOwnerId')
        .eq('id', companyId)
        .single();

      const row = company as Record<string, unknown> | null;
      if (!row || row['pendingOwnerId'] !== ctx.user.id) {
        throw new Error('No pending ownership offer for you');
      }

      const previousOwnerId = row['ownerId'] as string;
      await supabase.from('CompanyMembers').update({ role: 'owner' }).eq('companyId', companyId).eq('userId', ctx.user.id);
      await supabase.from('CompanyMembers').update({ role: 'member' }).eq('companyId', companyId).eq('userId', previousOwnerId);
      await supabase.from('Companies').update({ ownerId: ctx.user.id, pendingOwnerId: null }).eq('id', companyId);

      return true;
    },

    // Cancel a pending offer — either the owner (rescinding) or the recipient (declining).
    declineOwnership: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user.id);

      const { data: company } = await supabase
        .from('Companies')
        .select('ownerId, pendingOwnerId')
        .eq('id', companyId)
        .single();

      const row = company as Record<string, unknown> | null;
      if (!row || !row['pendingOwnerId']) return true; // nothing pending
      if (row['pendingOwnerId'] !== ctx.user.id && row['ownerId'] !== ctx.user.id) {
        throw new Error('Only the owner or the offered member can cancel this transfer');
      }

      await supabase.from('Companies').update({ pendingOwnerId: null }).eq('id', companyId);
      return true;
    },

    removeMember: async (
      _: unknown,
      { companyId, userId }: { companyId: string; userId: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      const membership = await requireCompanyMember(companyId, ctx.user.id);
      if (membership.role !== 'owner') throw new Error('Only the owner can remove members');

      await supabase
        .from('CompanyMembers')
        .delete()
        .eq('companyId', companyId)
        .eq('userId', userId);

      return true;
    },
  },

  Company: {
    // Whether a TaxJar token is stored — never expose the token itself.
    taxjarConnected: (company: Record<string, unknown>) => !!company['taxjarToken'],

    members: async (company: Record<string, unknown>) => {
      return membersByStatus(company['id'] as string, 'active');
    },

    // Blast-radius counts for the delete-company confirmation. Uses head+count
    // queries so no rows are transferred. Resolved on demand (queried lazily when
    // the delete modal opens), not part of the default settings load.
    deletionStats: async (company: Record<string, unknown>) => {
      const companyId = company['id'] as string;
      const countOf = async (table: string) => {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('companyId', companyId);
        return count ?? 0;
      };
      const [events, recipes, inventory, members] = await Promise.all([
        countOf('EventInfo'),
        countOf('RecipeCards'),
        countOf('VendorInventory'),
        countOf('CompanyMembers'),
      ]);
      return { events, recipes, inventory, members };
    },

    pendingRequests: async (company: Record<string, unknown>) => {
      return membersByStatus(company['id'] as string, 'pending');
    },

    posStatus: async (company: Record<string, unknown>) => {
      const provider = (company['posSystem'] as string | null) ?? null;
      // Only 'manual'/unset means definitively no provider; otherwise look up the connection.
      const { data } = await supabase
        .from('PosConnection')
        .select('provider, locationId, locationName, needsReauth')
        .eq('companyId', company['id'])
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return { connected: false, provider, needsReauth: false };
      const row = data as Record<string, unknown>;
      return {
        connected: true,
        provider: (row['provider'] as string) ?? provider,
        locationId: row['locationId'],
        locationName: row['locationName'],
        needsReauth: !!row['needsReauth'],
      };
    },
  },
};

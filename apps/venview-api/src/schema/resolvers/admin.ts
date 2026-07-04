import type { AppContext } from '../../context/index.js';
import { requireAuth } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';

function zipToState(zip: string | null | undefined): string | null {
  const digits = (zip ?? '').replace(/\D/g, '');
  if (digits.length < 3) return null;
  const p = parseInt(digits.slice(0, 3), 10);
  if (isNaN(p)) return null;
  if (p >= 10  && p <= 27)  return 'MA';
  if (p >= 28  && p <= 29)  return 'RI';
  if (p >= 30  && p <= 38)  return 'NH';
  if (p >= 39  && p <= 49)  return 'ME';
  if (p >= 50  && p <= 59)  return 'VT';
  if (p >= 60  && p <= 69)  return 'CT';
  if (p >= 70  && p <= 89)  return 'NJ';
  if (p >= 100 && p <= 149) return 'NY';
  if (p >= 150 && p <= 196) return 'PA';
  if (p >= 197 && p <= 199) return 'DE';
  if (p >= 200 && p <= 205) return 'DC';
  if (p >= 206 && p <= 219) return 'MD';
  if (p >= 220 && p <= 246) return 'VA';
  if (p >= 247 && p <= 268) return 'WV';
  if (p >= 270 && p <= 289) return 'NC';
  if (p >= 290 && p <= 299) return 'SC';
  if (p >= 300 && p <= 319) return 'GA';
  if (p >= 320 && p <= 349) return 'FL';
  if (p >= 350 && p <= 369) return 'AL';
  if (p >= 370 && p <= 385) return 'TN';
  if (p >= 386 && p <= 399) return 'MS';
  if (p >= 400 && p <= 427) return 'KY';
  if (p >= 430 && p <= 459) return 'OH';
  if (p >= 460 && p <= 479) return 'IN';
  if (p >= 480 && p <= 499) return 'MI';
  if (p >= 500 && p <= 528) return 'IA';
  if (p >= 530 && p <= 549) return 'WI';
  if (p >= 550 && p <= 567) return 'MN';
  if (p >= 570 && p <= 577) return 'SD';
  if (p >= 580 && p <= 588) return 'ND';
  if (p >= 590 && p <= 599) return 'MT';
  if (p >= 600 && p <= 629) return 'IL';
  if (p >= 630 && p <= 658) return 'MO';
  if (p >= 660 && p <= 679) return 'KS';
  if (p >= 680 && p <= 693) return 'NE';
  if (p >= 700 && p <= 714) return 'LA';
  if (p >= 716 && p <= 729) return 'AR';
  if (p >= 730 && p <= 749) return 'OK';
  if (p >= 750 && p <= 799) return 'TX';
  if (p >= 800 && p <= 816) return 'CO';
  if (p >= 820 && p <= 831) return 'WY';
  if (p >= 832 && p <= 838) return 'ID';
  if (p >= 840 && p <= 847) return 'UT';
  if (p >= 850 && p <= 865) return 'AZ';
  if (p >= 870 && p <= 884) return 'NM';
  if (p >= 885 && p <= 886) return 'TX';
  if (p >= 890 && p <= 898) return 'NV';
  if (p >= 900 && p <= 961) return 'CA';
  if (p >= 967 && p <= 968) return 'HI';
  if (p >= 970 && p <= 979) return 'OR';
  if (p >= 980 && p <= 994) return 'WA';
  if (p >= 995 && p <= 999) return 'AK';
  return null;
}

function monthKey(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 7); // "YYYY-MM"
}

function lastNMonths(n: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export const adminResolvers = {
  Query: {
    adminDashboard: async (_: unknown, __: unknown, ctx: AppContext) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      // eventDate is stored as "YYYY-MM-DD"; compare using date-only strings
      const thirtyDaysAgoDate = thirtyDaysAgo.toISOString().slice(0, 10);
      const sixtyDaysAgoDate  = sixtyDaysAgo.toISOString().slice(0, 10);
      // createdAt / finalizedDate are ISO timestamps
      const thirtyDaysAgoISO  = thirtyDaysAgo.toISOString();

      const [
        { data: companies },
        { data: { users: authUsers } },
        { data: events },
        { data: squareConns },
        { data: salesData },
      ] = await Promise.all([
        supabase.from('Companies').select('id, plan, createdAt'),
        supabase.auth.admin.listUsers({ perPage: 1000 }),
        supabase.from('EventInfo').select('eventID, companyId, isFinalized, eventDate, finalizedDate, zipCode, country'),
        supabase.from('PosConnection').select('companyId'),
        supabase.from('SalesSummary').select('eventID, netProfit'),
      ]);

      const allCompanies = (companies ?? []) as Array<{ id: string; plan: string; createdAt?: string | null }>;
      const allUsers     = authUsers ?? [];
      const allEvents    = (events ?? []) as Array<{ eventID: string; companyId: string; isFinalized: boolean; eventDate?: string | null; finalizedDate?: string | null; zipCode?: string | null; country?: string | null }>;
      const allSales     = (salesData ?? []) as Array<{ eventID: string; netProfit?: number | null }>;

      // ── Totals ───────────────────────────────────────────────────────────────
      const totalCompanies = allCompanies.length;
      const totalUsers     = allUsers.length;
      const totalEvents    = allEvents.length;
      const totalFinalizedEvents = allEvents.filter(e => e.isFinalized).length;

      // ── 30-day growth ────────────────────────────────────────────────────────
      const newCompanies30d = allCompanies.filter(c => (c.createdAt ?? '') >= thirtyDaysAgoISO).length;
      const newUsers30d     = allUsers.filter(u => (u.created_at ?? '') >= thirtyDaysAgoISO).length;
      const newEvents30d    = allEvents.filter(e => (e.eventDate ?? '') >= thirtyDaysAgoDate).length;
      const newFinalizedEvents30d = allEvents.filter(e =>
        e.isFinalized && (e.finalizedDate ?? '') >= thirtyDaysAgoISO
      ).length;

      // ── Plans ────────────────────────────────────────────────────────────────
      const proCount      = allCompanies.filter(c => c.plan === 'pro').length;
      const starterCount  = allCompanies.filter(c => c.plan === 'starter').length;

      // ── Activation: companies with ≥1 event ──────────────────────────────────
      const companyIdsWithEvents = new Set(allEvents.map(e => e.companyId));
      const activatedCompanies = allCompanies.filter(c => companyIdsWithEvents.has(c.id)).length;
      const activationRate     = totalCompanies > 0 ? activatedCompanies / totalCompanies : 0;

      // ── Square integration ───────────────────────────────────────────────────
      const squareConnectedIds  = new Set((squareConns ?? []).map((s: Record<string, unknown>) => s['companyId'] as string));
      const squareConnectedCount = squareConnectedIds.size;
      const squareConnectedRate  = totalCompanies > 0 ? squareConnectedCount / totalCompanies : 0;

      // ── Engagement ───────────────────────────────────────────────────────────
      const avgEventsPerCompany = totalCompanies > 0 ? totalEvents / totalCompanies : 0;

      const profitableSales = allSales.filter(s => s.netProfit !== null && s.netProfit !== undefined);
      const avgNetProfitPerEvent = profitableSales.length > 0
        ? profitableSales.reduce((sum, s) => sum + Number(s.netProfit ?? 0), 0) / profitableSales.length
        : null;

      // ── Health signals ───────────────────────────────────────────────────────
      // Inactive 60d: activated but no event in last 60 days
      const recentlyActiveIds = new Set(
        allEvents.filter(e => (e.eventDate ?? '') >= sixtyDaysAgoDate).map(e => e.companyId)
      );
      const companiesInactive60d = allCompanies.filter(c =>
        companyIdsWithEvents.has(c.id) && !recentlyActiveIds.has(c.id)
      ).length;

      // Starter at limit: Starter plan + ≥1 finalized event
      const finalizedCountByCompany = new Map<string, number>();
      for (const e of allEvents.filter(e => e.isFinalized)) {
        finalizedCountByCompany.set(e.companyId, (finalizedCountByCompany.get(e.companyId) ?? 0) + 1);
      }
      const starterAtLimit = allCompanies.filter(c =>
        c.plan === 'starter' && (finalizedCountByCompany.get(c.id) ?? 0) >= 1
      ).length;

      // ── Monthly trends (last 6 months) ───────────────────────────────────────
      const months = lastNMonths(6);

      const companiesByMonth = months.map(m => ({
        month: m,
        count: allCompanies.filter(c => monthKey(c.createdAt) === m).length,
      }));

      const eventsByMonth = months.map(m => ({
        month: m,
        count: allEvents.filter(e => monthKey(e.eventDate) === m).length,
      }));

      // ── Top zip codes ────────────────────────────────────────────────────────
      const zipCounts = new Map<string, number>();
      for (const e of allEvents) {
        const z = e.zipCode?.trim();
        if (z) zipCounts.set(z, (zipCounts.get(z) ?? 0) + 1);
      }
      const topZipCodes = Array.from(zipCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([zipCode, count]) => ({ zipCode, count }));

      // ── Events by state ──────────────────────────────────────────────────────
      const stateCounts = new Map<string, number>();
      for (const e of allEvents) {
        const state = zipToState(e.zipCode);
        if (state) stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
      }
      const eventsByState = Array.from(stateCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([state, count]) => ({ state, count }));

      // ── Events by country ─────────────────────────────────────────────────────
      // Uses the event's country (ISO 3166-1 alpha-2). Events created before the
      // country field existed fall back to 'US' (the app was US-only then).
      const countryCounts = new Map<string, number>();
      for (const e of allEvents) {
        const country = (e.country ?? '').trim().toUpperCase() || 'US';
        countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      }
      const eventsByCountry = Array.from(countryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([country, count]) => ({ country, count }));

      return {
        totalUsers, totalCompanies, totalEvents, totalFinalizedEvents,
        newUsers30d, newCompanies30d, newEvents30d, newFinalizedEvents30d,
        proCount, starterCount,
        activatedCompanies, activationRate,
        squareConnectedCount, squareConnectedRate,
        avgEventsPerCompany, avgNetProfitPerEvent,
        companiesInactive60d, starterAtLimit,
        companiesByMonth, eventsByMonth,
        topZipCodes,
        eventsByState,
        eventsByCountry,
      };
    },

    companiesInState: async (_: unknown, { state }: { state: string }, ctx: AppContext) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const zipcodes = require('zipcodes') as {
        lookup: (zip: string) => { latitude: number; longitude: number; city: string; state: string } | null;
      };

      const [{ data: companies }, { data: members }, { data: events }] = await Promise.all([
        supabase.from('Companies').select('id, name, plan'),
        supabase.from('CompanyMembers').select('companyId, userId'),
        supabase.from('EventInfo').select('companyId, zipCode'),
      ]);

      type EventRow = { companyId: string; zipCode?: string | null };
      type MemberRow = { companyId: string; userId: string };
      type CompanyRow = { id: string; name: string; plan: string };

      // Event count + zip frequency per company
      const eventsByCompany = new Map<string, Map<string, number>>();
      for (const e of (events ?? []) as EventRow[]) {
        if (!eventsByCompany.has(e.companyId)) eventsByCompany.set(e.companyId, new Map());
        const z = e.zipCode?.trim();
        if (z) {
          const freq = eventsByCompany.get(e.companyId)!;
          freq.set(z, (freq.get(z) ?? 0) + 1);
        }
      }

      // Member count per company
      const memberCount = new Map<string, number>();
      for (const m of (members ?? []) as MemberRow[]) {
        memberCount.set(m.companyId, (memberCount.get(m.companyId) ?? 0) + 1);
      }

      const results: Array<{
        id: string; name: string; plan: string;
        lat: number; lng: number; city: string | undefined;
        zipCode: string; eventCount: number; memberCount: number;
      }> = [];

      for (const company of (companies ?? []) as CompanyRow[]) {
        const zipFreq = eventsByCompany.get(company.id);
        if (!zipFreq || zipFreq.size === 0) continue;

        // Use most common event zip as the company's primary location
        const primaryZip = Array.from(zipFreq.entries()).sort((a, b) => b[1] - a[1])[0][0];
        const loc = zipcodes.lookup(primaryZip);
        if (!loc || loc.state !== state) continue;

        const eventCount = Array.from(zipFreq.values()).reduce((a, b) => a + b, 0);

        results.push({
          id: company.id,
          name: company.name,
          plan: company.plan,
          lat: loc.latitude,
          lng: loc.longitude,
          city: loc.city,
          zipCode: primaryZip,
          eventCount,
          memberCount: memberCount.get(company.id) ?? 0,
        });
      }

      return results.sort((a, b) => b.eventCount - a.eventCount);
    },

    // Companies with events in a given country (ISO alpha-2). Events predating the
    // country field count as 'US'. No lat/lng — non-US locations aren't geocoded —
    // so this is a ranked list, not a marker map.
    companiesInCountry: async (_: unknown, { country }: { country: string }, ctx: AppContext) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      const target = (country ?? '').trim().toUpperCase();
      const [{ data: companies }, { data: members }, { data: events }] = await Promise.all([
        supabase.from('Companies').select('id, name, plan'),
        supabase.from('CompanyMembers').select('companyId, userId'),
        supabase.from('EventInfo').select('companyId, country'),
      ]);

      const eventCountByCompany = new Map<string, number>();
      for (const e of (events ?? []) as Array<{ companyId: string; country?: string | null }>) {
        const c = (e.country ?? '').trim().toUpperCase() || 'US';
        if (c !== target) continue;
        eventCountByCompany.set(e.companyId, (eventCountByCompany.get(e.companyId) ?? 0) + 1);
      }

      const memberCount = new Map<string, number>();
      for (const m of (members ?? []) as Array<{ companyId: string; userId: string }>) {
        memberCount.set(m.companyId, (memberCount.get(m.companyId) ?? 0) + 1);
      }

      return ((companies ?? []) as Array<{ id: string; name: string; plan: string }>)
        .map(co => ({
          id: co.id, name: co.name, plan: co.plan,
          eventCount: eventCountByCompany.get(co.id) ?? 0,
          memberCount: memberCount.get(co.id) ?? 0,
        }))
        .filter(r => r.eventCount > 0)
        .sort((a, b) => b.eventCount - a.eventCount);
    },

    adminUsers: async (_: unknown, __: unknown, ctx: AppContext) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      const [{ data: allMembers }, { data: { users: authUsers } }] = await Promise.all([
        supabase.from('CompanyMembers').select('userId, role, Companies(id, name, plan)'),
        supabase.auth.admin.listUsers({ perPage: 1000 }),
      ]);

      const emailMap = new Map((authUsers ?? []).map(u => [u.id, u.email ?? '']));

      // Group by userId
      const userMap = new Map<string, { userId: string; companies: Array<Record<string, unknown>> }>();
      for (const m of (allMembers ?? []) as Array<Record<string, unknown>>) {
        const uid = m['userId'] as string;
        if (!userMap.has(uid)) userMap.set(uid, { userId: uid, companies: [] });
        const company = m['Companies'] as Record<string, unknown> | null;
        if (company) userMap.get(uid)!.companies.push(company);
      }

      return Array.from(userMap.values()).map(u => ({
        userId: u.userId,
        email: emailMap.get(u.userId) ?? '',
        companyCount: u.companies.length,
        companies: u.companies.map(c => ({
          id: c['id'],
          name: c['name'],
          plan: c['plan'],
          memberCount: 0,
        })),
      }));
    },

    adminCompanies: async (_: unknown, __: unknown, ctx: AppContext) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      const [{ data: companies }, { data: members }, { data: { users: authUsers } }] = await Promise.all([
        supabase.from('Companies').select('id, name, plan, ownerId, createdAt'),
        supabase.from('CompanyMembers').select('companyId, userId, role, status, joinedAt'),
        supabase.auth.admin.listUsers({ perPage: 1000 }),
      ]);

      const emailMap = new Map((authUsers ?? []).map(u => [u.id, u.email ?? '']));

      // Group members by company
      const membersByCompany = new Map<string, Array<Record<string, unknown>>>();
      for (const m of (members ?? []) as Array<Record<string, unknown>>) {
        const cid = m['companyId'] as string;
        if (!membersByCompany.has(cid)) membersByCompany.set(cid, []);
        membersByCompany.get(cid)!.push({
          userId: m['userId'],
          email: emailMap.get(m['userId'] as string) ?? '',
          role: m['role'],
          status: m['status'] ?? 'active',
          joinedAt: m['joinedAt'],
        });
      }

      return ((companies ?? []) as Array<Record<string, unknown>>).map(c => {
        const mem = membersByCompany.get(c['id'] as string) ?? [];
        return {
          id: c['id'],
          name: c['name'],
          plan: c['plan'],
          ownerId: c['ownerId'],
          ownerEmail: emailMap.get(c['ownerId'] as string) ?? '',
          createdAt: c['createdAt'],
          memberCount: mem.filter(m => m['status'] === 'active').length,
          members: mem,
        };
      });
    },

    waitlistSignups: async (_: unknown, __: unknown, ctx: AppContext) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      const { data, error } = await supabase
        .from('Waitlist')
        .select('id, email, source, createdAt')
        .order('createdAt', { ascending: false });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },

  Mutation: {
    updateCompanyPlan: async (
      _: unknown,
      { companyId, plan }: { companyId: string; plan: string },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');
      if (!['starter', 'pro'].includes(plan)) throw new Error('Invalid plan');

      const { data, error } = await supabase
        .from('Companies')
        .update({ plan, planUpdatedAt: new Date().toISOString() })
        .eq('id', companyId)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },

    setSuperAdmin: async (
      _: unknown,
      { userId, isSuperAdmin }: { userId: string; isSuperAdmin: boolean },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      if (!ctx.isSuperAdmin) throw new Error('Forbidden');

      const { error } = await supabase.auth.admin.updateUserById(userId, {
        app_metadata: { role: isSuperAdmin ? 'super_admin' : null },
      });
      if (error) throw new Error(error.message);
      return true;
    },

    updateUserPrefs: async (_: unknown, __: unknown, ctx: AppContext) => {
      requireAuth(ctx);
      return true;
    },
  },
};

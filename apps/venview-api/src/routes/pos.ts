import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { encryptToken } from '../lib/crypto.js';
import { getProvider } from '../lib/pos/index.js';
import { getToastRestaurantName } from '../lib/toast.js';
import { createContext } from '../context/index.js';
import logger from '../lib/logger.js';
import { safeError } from '../lib/safeError.js';

const router: IRouter = Router();

// ── GET /api/pos/:provider/oauth/start?companyId=<id> ─────────────────────────
router.get('/pos/:provider/oauth/start', async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const provider = req.params['provider'] as string;
    const companyId = req.query['companyId'] as string;
    if (!companyId) return void res.status(400).json({ error: 'companyId required' });

    const adapter = getProvider(provider);
    if (!adapter.implemented) return void res.status(400).json({ error: `${adapter.displayName} is not available yet.` });

    const { data: member } = await supabase
      .from('CompanyMembers').select('role')
      .eq('companyId', companyId).eq('userId', ctx.user.id).eq('status', 'active').single();
    if (!member) return void res.status(403).json({ error: 'Forbidden' });

    // Purge stale states, then store a fresh one for this provider.
    await supabase.from('OAuthState').delete().lt('createdAt', new Date(Date.now() - 15 * 60 * 1000).toISOString());
    const state = randomBytes(24).toString('hex');
    const { error: insertErr } = await supabase.from('OAuthState').insert({ state, companyId, userId: ctx.user.id, provider });
    if (insertErr) {
      logger.error('pos.oauth.start: OAuthState insert failed', { error: insertErr, companyId, provider });
      return void res.status(500).json({ error: 'Failed to start OAuth' });
    }

    const url = await adapter.getAuthUrl(companyId, state);
    res.json({ url });
  } catch (err) {
    logger.error('pos.oauth.start: error', { error: safeError(err) });
    res.status(500).json({ error: 'Failed to start OAuth' });
  }
});

// ── POST /api/pos/toast/connect ───────────────────────────────────────────────
// Toast has no redirect OAuth: a company connects by entering its restaurant
// GUID. Partner clientId/secret live in env vars; we store only the GUID.
router.post('/pos/toast/connect', async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const companyId = (req.body?.companyId as string | undefined)?.trim();
    const restaurantGuid = (req.body?.restaurantGuid as string | undefined)?.trim();
    if (!companyId || !restaurantGuid) return void res.status(400).json({ error: 'companyId and restaurantGuid are required' });

    const { data: member } = await supabase
      .from('CompanyMembers').select('role')
      .eq('companyId', companyId).eq('userId', ctx.user.id).eq('status', 'active').single();
    if (!member || !['owner', 'admin'].includes((member as { role: string }).role)) {
      return void res.status(403).json({ error: 'Forbidden' });
    }

    // Best-effort name lookup; also serves as a light validity check of the GUID.
    const locationName = await getToastRestaurantName(restaurantGuid);

    const { error: upsertErr } = await supabase.from('PosConnection').upsert({
      companyId,
      provider: 'toast',
      externalId: restaurantGuid,
      locationId: restaurantGuid,
      locationName,
    }, { onConflict: 'companyId,provider' });
    if (upsertErr) {
      logger.error('pos.toast.connect: save failed', { companyId, error: upsertErr.message });
      return void res.status(500).json({ error: 'Failed to save Toast connection' });
    }

    // Mark the company's POS provider so provider resolution works (see companyProvider).
    const { error: sysErr } = await supabase.from('Companies').update({ posSystem: 'toast' }).eq('id', companyId);
    if (sysErr) logger.error('pos.toast.connect: posSystem update failed', { companyId, error: sysErr.message });

    res.json({ success: true, locationName });
  } catch (err) {
    logger.error('pos.toast.connect: error', { error: safeError(err) });
    res.status(500).json({ error: 'Failed to connect Toast' });
  }
});

// Shared OAuth callback handler — provider comes from the route param when present,
// otherwise from the stored state (used by the Square back-compat alias).
async function handleCallback(req: Request, res: Response, providerOverride?: string) {
  const { code, state, error: oauthError } = req.query;
  const clientUrl = process.env['CLIENT_URL'] ?? 'http://localhost:4200';

  if (oauthError) { logger.error('pos.oauth.callback: provider error', { oauthError }); return void res.redirect(`${clientUrl}/companies`); }
  if (!code || !state) return void res.status(400).send('Missing code or state');

  const { data: stateRow } = await supabase
    .from('OAuthState').select('companyId, userId, provider').eq('state', state as string).single();
  if (!stateRow) return void res.status(400).send('Invalid or expired state');

  const row = stateRow as { companyId: string; userId: string; provider: string };
  const companyId = row.companyId;
  const provider = providerOverride ?? (req.params['provider'] as string | undefined) ?? row.provider ?? 'square';
  await supabase.from('OAuthState').delete().eq('state', String(state));

  try {
    const adapter = getProvider(provider);
    const tokens = await adapter.exchangeCode(code as string);

    const { error: upsertErr } = await supabase.from('PosConnection').upsert({
      companyId,
      provider,
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      externalId: tokens.externalId ?? null,
      locationId: tokens.locationId ?? null,
      locationName: tokens.locationName ?? null,
      expiresAt: tokens.expiresAt ?? null,
      needsReauth: false,
    }, { onConflict: 'companyId,provider' });
    if (upsertErr) logger.error('pos.oauth.callback: save failed', { companyId, provider, error: upsertErr.message });

    // Mark the company's POS provider (this is what drives provider resolution in
    // companyProvider — without it, locations/catalog/sync all no-op) and adopt the
    // merchant's currency so amounts display like the POS does.
    const companyPatch: Record<string, unknown> = { posSystem: provider };
    if (tokens.currency) companyPatch['currency'] = tokens.currency;
    const { error: curErr } = await supabase
      .from('Companies').update(companyPatch).eq('id', companyId);
    if (curErr) logger.error('pos.oauth.callback: company update failed', { companyId, error: curErr.message });

    res.redirect(`${clientUrl}/companies/${companyId}/settings?pos=connected`);
  } catch (err) {
    logger.error('pos.oauth.callback: exchange failed', { companyId, provider, error: safeError(err) });
    res.redirect(`${clientUrl}/companies/${companyId}/settings?pos=error`);
  }
}

// ── GET /api/pos/:provider/oauth/callback ─────────────────────────────────────
router.get('/pos/:provider/oauth/callback', (req, res) => { void handleCallback(req, res); });

// ── Back-compat: Square's already-registered redirect URI ─────────────────────
router.get('/square/oauth/callback', (req, res) => { void handleCallback(req, res, 'square'); });

// ── DELETE /api/pos/:provider/disconnect/:companyId ───────────────────────────
router.delete('/pos/:provider/disconnect/:companyId', async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const provider = req.params['provider'] as string;
    const companyId = req.params['companyId'] as string;

    const adapter = getProvider(provider);
    if (adapter.revoke) { try { await adapter.revoke(companyId); } catch { /* non-fatal */ } }

    await supabase.from('PosConnection').delete().eq('companyId', companyId).eq('provider', provider);
    res.json({ success: true });
  } catch (err) {
    logger.error('pos.disconnect: error', { error: safeError(err) });
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default router;

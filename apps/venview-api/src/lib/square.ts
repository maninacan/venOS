import { SquareClient, SquareEnvironment } from 'square';
import { supabase } from './supabase.js';
import { encryptToken, decryptToken } from './crypto.js';

// Re-exported for existing importers (e.g. the Square OAuth route).
export { encryptToken, decryptToken } from './crypto.js';

// ── Square environment helpers ────────────────────────────────────────────────

export function getSquareEnv(): SquareEnvironment {
  return (process.env['SQUARE_ENV'] ?? 'production') === 'sandbox'
    ? SquareEnvironment.Sandbox
    : SquareEnvironment.Production;
}

export function getSquareBaseUrl(): string {
  return getSquareEnv() === SquareEnvironment.Sandbox
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

// ── Unauthenticated Square client (for OAuth only) ────────────────────────────
export function getSquareOAuthClient(): SquareClient {
  return new SquareClient({
    token: '',
    environment: getSquareEnv(),
  });
}

// ── Token retrieval + refresh ─────────────────────────────────────────────────

async function refreshSquareToken(companyId: string, row: Record<string, unknown>): Promise<string> {
  const refreshEnc = row['refreshToken'] as string | null;
  if (!refreshEnc) throw new Error('Cannot refresh Square token: no refresh token stored.');

  const oauthClient = getSquareOAuthClient();
  const tokenResponse = await oauthClient.oAuth.obtainToken({
    clientId: process.env['SQUARE_APP_ID']!,
    clientSecret: process.env['SQUARE_APP_SECRET']!,
    grantType: 'refresh_token',
    refreshToken: decryptToken(refreshEnc),
  });

  const accessToken = tokenResponse.accessToken!;
  const newRefresh = tokenResponse.refreshToken!;
  const expiresAt = tokenResponse.expiresAt;

  await supabase.from('PosConnection').update({
    accessToken: encryptToken(accessToken),
    refreshToken: encryptToken(newRefresh),
    externalId: tokenResponse.merchantId,
    expiresAt: expiresAt ?? new Date().toISOString(),
  }).eq('companyId', companyId).eq('provider', 'square');

  return accessToken;
}

export async function getSquareToken(companyId: string): Promise<string> {
  const { data, error } = await supabase
    .from('PosConnection')
    .select('accessToken, refreshToken, expiresAt')
    .eq('companyId', companyId)
    .eq('provider', 'square')
    .single();

  if (error || !data) {
    throw new Error('Square account not connected. Please connect via Settings.');
  }

  const row = data as Record<string, unknown>;
  const accessEnc = row['accessToken'] as string | null;
  if (!accessEnc) throw new Error('Square connection has no access token. Please reconnect.');

  // Proactively refresh if token is expiring within 7 days (Square tokens last 30 days,
  // so 30-day window means every call would refresh, causing race conditions).
  const expiresAt = row['expiresAt'] as string | null;
  if (expiresAt && row['refreshToken']) {
    const expiresDate = new Date(expiresAt);
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (expiresDate < sevenDaysFromNow) {
      return refreshSquareToken(companyId, row);
    }
  }

  return decryptToken(accessEnc);
}

export async function getSquareClient(companyId: string): Promise<SquareClient> {
  const token = await getSquareToken(companyId);
  return new SquareClient({ token, environment: getSquareEnv() });
}

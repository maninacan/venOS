import axios from 'axios';
import { supabase } from './supabase.js';

// Toast uses an OAuth2 client-credentials grant: the *partner* app's
// clientId/secret (global env vars) are exchanged for a short-lived access
// token, and each restaurant is addressed by its GUID via the
// `Toast-Restaurant-External-ID` header. There is no per-restaurant token, so
// the access token is cached process-wide and reused across companies.

const TOAST_API_HOST = process.env['TOAST_API_HOST'] ?? 'https://ws-api.toasttab.com';
const TOAST_CLIENT_ID = process.env['TOAST_CLIENT_ID'] ?? '';
const TOAST_CLIENT_SECRET = process.env['TOAST_CLIENT_SECRET'] ?? '';

export function getToastHost(): string {
  return TOAST_API_HOST;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// Fetch (and cache) a partner access token. Refreshed a minute before expiry.
export async function getToastAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
    throw new Error('Toast is not configured. Set TOAST_CLIENT_ID and TOAST_CLIENT_SECRET.');
  }
  const res = await axios.post(
    `${TOAST_API_HOST}/authentication/v1/authentication/login`,
    { clientId: TOAST_CLIENT_ID, clientSecret: TOAST_CLIENT_SECRET, userAccessType: 'TOAST_MACHINE_CLIENT' },
    { headers: { 'Content-Type': 'application/json' } }
  );
  const token = (res.data as { token?: { accessToken?: string; expiresIn?: number } } | null)?.token;
  if (!token?.accessToken) throw new Error('Toast authentication failed: no access token returned.');
  cachedToken = {
    token: token.accessToken,
    expiresAt: Date.now() + Number(token.expiresIn ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// The restaurant GUID a company stored when it connected Toast.
export async function getToastRestaurantGuid(companyId: string): Promise<string> {
  const { data, error } = await supabase
    .from('PosConnection')
    .select('externalId')
    .eq('companyId', companyId)
    .eq('provider', 'toast')
    .single();
  if (error || !data) throw new Error('Toast account not connected. Please connect via Settings.');
  const guid = (data as Record<string, unknown>)['externalId'] as string | null;
  if (!guid) throw new Error('Toast connection has no restaurant GUID. Please reconnect.');
  return guid;
}

// Authenticated GET against the Toast API, scoped to a company's restaurant.
export async function toastGet<T>(companyId: string, path: string, params?: Record<string, unknown>): Promise<T> {
  const [token, guid] = await Promise.all([getToastAccessToken(), getToastRestaurantGuid(companyId)]);
  return toastGetWithGuid<T>(token, guid, path, params);
}

// Lower-level GET when the GUID isn't yet stored (e.g. validating a new connection).
export async function toastGetWithGuid<T>(token: string, restaurantGuid: string, path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await axios.get(`${TOAST_API_HOST}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': restaurantGuid },
    ...(params ? { params } : {}),
  });
  return res.data as T;
}

// Best-effort restaurant display name for a GUID (used at connect time).
export async function getToastRestaurantName(restaurantGuid: string): Promise<string | null> {
  try {
    const token = await getToastAccessToken();
    const data = await toastGetWithGuid<{ general?: { name?: string; locationName?: string } }>(
      token, restaurantGuid, `/restaurants/v1/restaurants/${restaurantGuid}`
    );
    return data?.general?.locationName || data?.general?.name || null;
  } catch {
    return null;
  }
}

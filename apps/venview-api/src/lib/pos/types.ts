// Provider-agnostic POS adapter interface. Each integration (Square today;
// Shopify/Toast later) implements this; the rest of the app talks only to the
// registry, never to a specific provider.

export type PosProviderKey = 'square' | 'shopify' | 'toast';

export interface PosCapabilities {
  sales: boolean;
  labor: boolean;
  catalog: boolean;
}

export interface PosTokens {
  accessToken: string;
  refreshToken?: string | null;
  externalId?: string | null;     // merchant / shop / restaurant id
  locationId?: string | null;
  locationName?: string | null;
  currency?: string | null;       // ISO 4217 of the default location, if known
  expiresAt?: string | null;      // ISO; access-token expiry
}

export interface PosLocation { id: string; name: string; currency?: string | null }

export interface PosCatalogItem {
  posItemId: string;
  posItemName: string;
  variationName: string;
  price: number;
}

// Normalized sales aggregate the provider returns; persistence is shared.
export interface PosSalesPull {
  grossSales: number;
  discounts: number;
  refunds: number;
  tips: number;
  processingFees: number;   // provider processing fees (stored in SalesSummary.squareFees)
  totalCollected: number;
  taxCollected: number;
  items: Array<{ name: string; qty: number; catalogObjectId?: string | null; revenue?: number }>;
  orderCount: number;
}

export interface PosLaborPull {
  rows: Array<{ name: string; hours: number; wage: number }>;
}

// The event shape the adapters need to scope a date window.
export interface PosEvent {
  posLocationId?: string | null;
  eventDate?: string | null;
  endDate?: string | null;
  EventDays?: Array<Record<string, unknown>> | null;
}

export interface PosProvider {
  key: PosProviderKey;
  displayName: string;
  capabilities: PosCapabilities;
  implemented: boolean;
  /** Build the provider's OAuth authorize URL. */
  getAuthUrl(companyId: string, state: string): string | Promise<string>;
  /** Exchange an auth code for tokens (+ default location). */
  exchangeCode(code: string): Promise<PosTokens>;
  /** Best-effort token revocation on disconnect. */
  revoke?(companyId: string): Promise<void>;
  listLocations(companyId: string): Promise<PosLocation[]>;
  listCatalog(companyId: string): Promise<PosCatalogItem[]>;
  pullSales(companyId: string, event: PosEvent): Promise<PosSalesPull>;
  pullLabor(companyId: string, event: PosEvent): Promise<PosLaborPull>;
}

// Offset (ms) that `timeZone` is ahead of UTC at the given instant.
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {} as Record<string, string>);
  const asUTC = Date.UTC(
    Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']),
    Number(parts['hour']), Number(parts['minute']), Number(parts['second'])
  );
  return asUTC - date.getTime();
}

// The UTC instant of `dateStr`T`timeStr` interpreted in `timeZone`.
function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}Z`);
  return new Date(naive.getTime() - tzOffsetMs(naive, timeZone));
}

function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the query window for an event's sales/labor. When `timeZone` (an IANA
 * zone from the POS location) is provided, the window spans the event's local
 * business days — local midnight of the first day through local midnight after
 * the last day, plus a 2h buffer for late-settling payments — matching how the
 * POS reports a "reporting day". Without a timeZone it falls back to a UTC
 * window (used by providers that don't resolve a location timezone).
 * `startDate`/`endDate` are the local calendar dates (YYYY-MM-DD) for workday
 * filters.
 */
export function buildDateWindow(
  event: PosEvent,
  timeZone?: string
): { startAt: string; endAt: string; startDate: string; endDate: string } {
  const days = (event.EventDays as Array<Record<string, unknown>> | null) ?? [];
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (days.length > 0) {
    const sorted = [...days].sort((a, b) => String(a['eventDate']).localeCompare(String(b['eventDate'])));
    startDate = sorted[0]['eventDate'] as string;
    endDate = sorted[sorted.length - 1]['eventDate'] as string;
  } else {
    startDate = event.eventDate ?? null;
    endDate = event.endDate ?? startDate;
  }
  if (!startDate) throw new Error('Event has no date set');
  const first = startDate;
  const last = endDate ?? startDate;

  // Guard against invalid / corrupt dates (e.g. a stray pre-2000 day) so we
  // surface a clear message instead of a raw provider error.
  const gStart = new Date(first + 'T00:00:00Z');
  const gEnd = new Date(last + 'T00:00:00Z');
  if (isNaN(gStart.getTime()) || isNaN(gEnd.getTime()) || gStart.getUTCFullYear() < 2000) {
    throw new Error("This event has an invalid date. Please check the event's dates in its details and try again.");
  }

  let start: Date;
  let end: Date;
  if (timeZone) {
    start = zonedTimeToUtc(first, '00:00:00', timeZone);
    end = new Date(zonedTimeToUtc(addDaysStr(last, 1), '00:00:00', timeZone).getTime() + 2 * 60 * 60 * 1000);
  } else {
    start = new Date(first + 'T00:00:00Z');
    end = new Date(last + 'T00:00:00Z');
    end.setUTCHours(26);
  }
  return { startAt: start.toISOString(), endAt: end.toISOString(), startDate: first, endDate: last };
}

// Thrown when a capability isn't supported by the company's provider.
export class PosUnsupportedError extends Error {}

// True when a provider API error is an authentication failure (dead/revoked/
// wrong-app token) — i.e. the user needs to reconnect the POS.
export function isPosAuthError(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: unknown; errors?: Array<{ category?: string; code?: string }> } | null;
  if (!e) return false;
  if (e.statusCode === 401) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  if (/status code:\s*401/i.test(msg) || /AUTHENTICATION_ERROR|UNAUTHORIZED/i.test(msg)) return true;
  if (Array.isArray(e.errors) && e.errors.some(x => x?.category === 'AUTHENTICATION_ERROR' || x?.code === 'UNAUTHORIZED')) return true;
  return false;
}

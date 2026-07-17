import axios from 'axios';
import logger from '../logger.js';
import { getSquareClient, getSquareBaseUrl, getSquareToken } from '../square.js';
import {
  buildDateWindow,
  type PosProvider, type PosTokens, type PosLocation, type PosCatalogItem,
  type PosModifierCatalogItem, type PosSalesPull, type PosLaborPull, type PosEvent,
} from './types.js';

const SQUARE_APP_ID = process.env['SQUARE_APP_ID'] ?? '';
const SQUARE_APP_SECRET = process.env['SQUARE_APP_SECRET'] ?? '';
const SQUARE_OAUTH_REDIRECT = process.env['SQUARE_OAUTH_REDIRECT'] ??
  `${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/api/square/oauth/callback`;

const SQUARE_SCOPES = [
  'TIMECARDS_READ', 'TIMECARDS_SETTINGS_READ', 'EMPLOYEES_READ',
  'ORDERS_READ', 'PAYMENTS_READ', 'MERCHANT_PROFILE_READ', 'ITEMS_READ',
].join(' ');

// Fallback when a location has no timezone / the lookup fails. US vendor app,
// so a US zone beats UTC (which would shift the reporting-day window ~6-7h).
const DEFAULT_TZ = 'America/Denver';

// Resolve the Square location's IANA timezone so the sales/labor window aligns
// to the merchant's local business day (matching Square's reporting day).
async function getLocationTimeZone(companyId: string, locationId: string): Promise<string> {
  try {
    const client = await getSquareClient(companyId);
    const res = await client.locations.get({ locationId });
    const tz = (res.location as Record<string, unknown> | null)?.['timezone'] as string | undefined;
    return tz || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

export const squareProvider: PosProvider = {
  key: 'square',
  displayName: 'Square',
  capabilities: { sales: true, labor: true, catalog: true },
  implemented: true,

  getAuthUrl(_companyId, state) {
    const params = new URLSearchParams({
      client_id: SQUARE_APP_ID,
      scope: SQUARE_SCOPES,
      session: 'false',
      state,
      redirect_uri: SQUARE_OAUTH_REDIRECT,
      response_type: 'code',
    });
    return `${getSquareBaseUrl()}/oauth2/authorize?${params.toString()}`;
  },

  async exchangeCode(code): Promise<PosTokens> {
    const tokenRes = await axios.post(
      `${getSquareBaseUrl()}/oauth2/token`,
      { client_id: SQUARE_APP_ID, client_secret: SQUARE_APP_SECRET, code, grant_type: 'authorization_code', redirect_uri: SQUARE_OAUTH_REDIRECT },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const { access_token, refresh_token, merchant_id, expires_at } = tokenRes.data as {
      access_token: string; refresh_token: string; merchant_id: string; expires_at: string;
    };

    // Do NOT auto-select a location on connect — the location is chosen per event
    // (event.posLocationId). We only read the merchant's currency here (account-level,
    // for display formatting); location stays unset until an event picks one.
    let currency: string | null = null;
    try {
      const locRes = await axios.get(`${getSquareBaseUrl()}/v2/locations`, {
        headers: { Authorization: `Bearer ${access_token}`, 'Square-Version': '2025-01-15' },
      });
      const locs = locRes.data?.locations ?? [];
      if (locs.length > 0) currency = locs[0].currency ?? null;
    } catch { /* non-fatal */ }

    return { accessToken: access_token, refreshToken: refresh_token, externalId: merchant_id, locationId: null, locationName: null, currency, expiresAt: expires_at };
  },

  async revoke(companyId) {
    const token = await getSquareToken(companyId);
    await axios.post(
      `${getSquareBaseUrl()}/oauth2/revoke`,
      { access_token: token, client_id: SQUARE_APP_ID },
      { headers: { Authorization: `Client ${SQUARE_APP_SECRET}`, 'Content-Type': 'application/json', 'Square-Version': '2025-01-15' } }
    );
  },

  async listLocations(companyId): Promise<PosLocation[]> {
    const client = await getSquareClient(companyId);
    const response = await client.locations.list();
    return (response.locations ?? []).map((loc) => {
      const l = loc as Record<string, unknown>;
      return { id: l['id'] as string, name: l['name'] as string, currency: (l['currency'] as string) ?? null };
    });
  },

  async listCatalog(companyId): Promise<PosCatalogItem[]> {
    const client = await getSquareClient(companyId);
    const items: PosCatalogItem[] = [];
    const page = await client.catalog.list({ types: 'ITEM' });
    for await (const obj of page) {
      const catalogObj = obj as unknown as Record<string, unknown>;
      const itemData = catalogObj['itemData'] as Record<string, unknown> | null;
      for (const v of (itemData?.['variations'] ?? []) as Array<Record<string, unknown>>) {
        const varData = v['itemVariationData'] as Record<string, unknown> | null;
        items.push({
          posItemId: v['id'] as string,
          posItemName: (itemData?.['name'] as string) ?? '',
          variationName: (varData?.['name'] as string) ?? 'Regular',
          price: Number((varData?.['priceMoney'] as { amount?: bigint } | null)?.amount ?? 0) / 100,
        });
      }
    }
    return items;
  },

  async listModifierCatalog(companyId): Promise<PosModifierCatalogItem[]> {
    const client = await getSquareClient(companyId);
    const mods: PosModifierCatalogItem[] = [];
    // MODIFIER_LIST objects hold the individual MODIFIER children; iterate the
    // lists and emit one entry per modifier (its id is what appears on line items).
    const page = await client.catalog.list({ types: 'MODIFIER_LIST' });
    for await (const obj of page) {
      const catalogObj = obj as unknown as Record<string, unknown>;
      const listData = catalogObj['modifierListData'] as Record<string, unknown> | null;
      for (const m of (listData?.['modifiers'] ?? []) as Array<Record<string, unknown>>) {
        const modData = m['modifierData'] as Record<string, unknown> | null;
        mods.push({
          posModifierId: m['id'] as string,
          posModifierName: (modData?.['name'] as string) ?? '',
          price: Number((modData?.['priceMoney'] as { amount?: bigint } | null)?.amount ?? 0) / 100,
        });
      }
    }
    return mods;
  },

  async pullSales(companyId, event: PosEvent): Promise<PosSalesPull> {
    const locationId = event.posLocationId;
    if (!locationId) throw new Error('Event has no POS location linked. Edit the event and select a location first.');
    const token = await getSquareToken(companyId);
    const timeZone = await getLocationTimeZone(companyId, locationId);
    const { startAt, endAt } = buildDateWindow(event, timeZone);
    logger.info('pullSales', { build: 'SQUARE_RAWHTTP_v4', locationId, startAt, endAt });

    // Orders via raw HTTP: the SDK intermittently serializes an empty sort_field
    // on orders.search (Square then 400s). Build the request explicitly, as the
    // prior working app did. Raw responses are snake_case with integer-cent amounts.
    const allOrders: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = {
        location_ids: [locationId],
        query: {
          filter: { date_time_filter: { created_at: { start_at: startAt, end_at: endAt } }, state_filter: { states: ['COMPLETED'] } },
          sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' },
        },
      };
      if (cursor) body['cursor'] = cursor;
      const res = await axios.post(`${getSquareBaseUrl()}/v2/orders/search`, body, {
        headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2025-01-15', 'Content-Type': 'application/json' },
      });
      const data = res.data as { orders?: Array<Record<string, unknown>>; cursor?: string };
      for (const order of data.orders ?? []) allOrders.push(order);
      cursor = data.cursor;
    } while (cursor);

    // Payments via raw HTTP too: the SDK's payments.list serializes an empty
    // sort_field the same way orders.search does, which Square 400s.
    const allPayments: Array<Record<string, unknown>> = [];
    let payCursor: string | undefined;
    do {
      const url = new URL(`${getSquareBaseUrl()}/v2/payments`);
      url.searchParams.set('location_id', locationId);
      url.searchParams.set('begin_time', startAt);
      url.searchParams.set('end_time', endAt);
      url.searchParams.set('limit', '100');
      if (payCursor) url.searchParams.set('cursor', payCursor);
      const res = await axios.get(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2025-01-15' },
      });
      const data = res.data as { payments?: Array<Record<string, unknown>>; cursor?: string };
      for (const payment of data.payments ?? []) allPayments.push(payment);
      payCursor = data.cursor;
    } while (payCursor);

    const amt = (m: unknown): number => Number((m as { amount?: number | bigint } | null)?.amount ?? 0);

    let grossSales = 0, discounts = 0, tips = 0, taxCollected = 0, refunds = 0;
    type PulledMod = { name: string; catalogObjectId: string | null; qty: number };
    const itemMap = new Map<string, { name: string; qty: number; catalogObjectId: string | null; revenue: number; modifiers: PulledMod[] }>();
    // Actual taxes Square applied, aggregated by name+rate across orders. Square
    // returns each order's `taxes` with a `name`, string `percentage` (e.g. "8.25"),
    // and `applied_money`. This is the real collected rate — the source of truth for
    // the Sales Tax tab (vs. a separate ZIP-based estimate).
    const taxMap = new Map<string, { name: string; rate: number; amount: number }>();
    for (const order of allOrders) {
      // Gross = true item sales (pre-discount/return/tax/tip), summed per line
      // item from gross_sales_money (fallback total_money, then base_price × qty).
      for (const item of (order['line_items'] as Array<Record<string, unknown>> | null) ?? []) {
        const name = (item['name'] as string ?? '').trim();
        const qty = Number(item['quantity'] ?? 0);
        // Variation id ordered — the exact key mappings are stored under (PosItemMapping.posItemId).
        const catalogObjectId = (item['catalog_object_id'] as string | undefined) ?? null;
        const giAmt = (item['gross_sales_money'] as { amount?: number } | null)?.amount;
        const tmAmt = (item['total_money'] as { amount?: number } | null)?.amount;
        const bpAmt = (item['base_price_money'] as { amount?: number } | null)?.amount;
        const cents = giAmt != null ? Number(giAmt)
          : tmAmt != null ? Number(tmAmt)
          : Number(bpAmt ?? 0) * qty;
        grossSales += cents / 100;
        // Modifiers (flavor add-ons, whip, …): their upcharge is already inside
        // gross_sales_money above, so we capture COST only. Applied count = line
        // qty × the modifier's own quantity (usually 1).
        const mods: PulledMod[] = [];
        for (const mod of (item['modifiers'] as Array<Record<string, unknown>> | null) ?? []) {
          const modName = (mod['name'] as string ?? '').trim();
          const modId = (mod['catalog_object_id'] as string | undefined) ?? null;
          const modQty = qty * Number(mod['quantity'] ?? 1);
          if ((modName || modId) && modQty > 0) mods.push({ name: modName, catalogObjectId: modId, qty: modQty });
        }
        // Key by variation id when present (distinct cost per variation); else by name.
        const key = catalogObjectId ?? name;
        if (name) {
          const prev = itemMap.get(key);
          itemMap.set(key, {
            name,
            qty: (prev?.qty ?? 0) + qty,
            catalogObjectId,
            revenue: (prev?.revenue ?? 0) + cents / 100,
            modifiers: [...(prev?.modifiers ?? []), ...mods],
          });
        }
      }
      discounts += amt(order['total_discount_money']) / 100;
      tips += amt(order['total_tip_money']) / 100;
      taxCollected += amt(order['total_tax_money']) / 100;
      // Capture the actual applied taxes (name + rate + amount), keyed by name+rate
      // so state/county/city lines stay distinct and merge across orders.
      for (const tax of (order['taxes'] as Array<Record<string, unknown>> | null) ?? []) {
        const taxName = (tax['name'] as string ?? '').trim() || 'Sales Tax';
        const rate = Number(tax['percentage'] ?? 0) / 100; // percentage is a string like "8.25"
        const applied = amt(tax['applied_money']) / 100;
        if (rate <= 0 && applied <= 0) continue;
        const key = `${taxName}|${rate}`;
        const prev = taxMap.get(key);
        taxMap.set(key, { name: taxName, rate, amount: +((prev?.amount ?? 0) + applied).toFixed(2) });
      }
      // Returns/refunds recorded on the order.
      refunds += amt((order['return_amounts'] as { total_money?: unknown } | null)?.total_money) / 100;
      // Auto-gratuity service charges are tips too (card tips arrive via total_tip_money).
      for (const sc of (order['service_charges'] as Array<Record<string, unknown>> | null) ?? []) {
        if (sc['type'] === 'AUTO_GRATUITY') tips += amt(sc['total_money']) / 100;
      }
    }

    let processingFees = 0, totalCollected = 0;
    for (const payment of allPayments) {
      // Raw HTTP payments are snake_case with integer-cent amounts.
      totalCollected += amt(payment['amount_money']) / 100;
      for (const fee of (payment['processing_fee'] as Array<{ amount_money?: { amount?: number } }> | null) ?? []) {
        processingFees += Math.abs(Number(fee.amount_money?.amount ?? 0)) / 100;
      }
    }

    return {
      grossSales, discounts, refunds, tips, processingFees, totalCollected, taxCollected,
      taxLines: [...taxMap.values()],
      items: [...itemMap.values()],
      orderCount: allOrders.length,
    };
  },

  async pullLabor(companyId, event: PosEvent): Promise<PosLaborPull> {
    const locationId = event.posLocationId;
    if (!locationId) throw new Error('Event has no POS location linked.');
    const client = await getSquareClient(companyId);
    const timeZone = await getLocationTimeZone(companyId, locationId);
    // Local calendar dates for the workday filter (interpreted in the location tz).
    const { startDate, endDate } = buildDateWindow(event, timeZone);

    const allTimecards: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const response = await client.labor.searchTimecards({
        query: { filter: { locationIds: [locationId], workday: { dateRange: { startDate, endDate }, matchTimecardsBy: 'START_AT', defaultTimezone: timeZone }, status: 'CLOSED' } },
        ...(cursor ? { cursor } : {}),
      });
      for (const tc of response.timecards ?? []) allTimecards.push(tc as unknown as Record<string, unknown>);
      cursor = response.cursor ?? undefined;
    } while (cursor);

    // Resolve team-member display names once per member.
    const memberIds = [...new Set(allTimecards.map(tc => tc['teamMemberId'] as string).filter(Boolean))];
    const nameMap = new Map<string, string>();
    await Promise.all(memberIds.map(async memberId => {
      try {
        const memberResponse = await client.teamMembers.get({ teamMemberId: memberId });
        const member = memberResponse.teamMember as Record<string, unknown> | null;
        nameMap.set(memberId, member ? `${member['givenName'] ?? ''} ${member['familyName'] ?? ''}`.trim() || memberId : memberId);
      } catch {
        nameMap.set(memberId, memberId);
      }
    }));

    // Current Square Labor API timecards carry startAt/endAt and the shift wage
    // directly (the old clockInEvent/clockOutEvent shape no longer exists).
    const rows = allTimecards.map(tc => {
      const memberId = tc['teamMemberId'] as string;
      const startStr = tc['startAt'] as string | null;
      const endStr = tc['endAt'] as string | null;
      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : null;
      const hours = start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())
        ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 36000) / 100)
        : 0;
      const hourly = (tc['wage'] as { hourlyRate?: { amount?: bigint } } | null)?.hourlyRate;
      const wage = hourly ? Number(hourly.amount ?? 0) / 100 : 0;
      return { name: nameMap.get(memberId) ?? memberId, hours, wage };
    });

    return { rows };
  },
};

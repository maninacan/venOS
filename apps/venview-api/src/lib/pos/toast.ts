import { getToastRestaurantGuid, getToastRestaurantName, toastGet } from '../toast.js';
import {
  buildDateWindow, PosUnsupportedError,
  type PosProvider, type PosTokens, type PosLocation, type PosCatalogItem,
  type PosSalesPull, type PosLaborPull, type PosEvent,
} from './types.js';

// Toast connects via a restaurant GUID entered in Settings (client-credentials
// model), not a redirect OAuth flow — so getAuthUrl/exchangeCode don't apply.
// Monetary values from the Toast API are decimal dollars (not cents).

const notViaOAuth = (): never => {
  throw new PosUnsupportedError('Toast connects with a restaurant GUID in Settings, not an OAuth redirect.');
};

// Recursively collect menu items from Toast's nested menu → group → item tree.
function collectMenuItems(node: Record<string, unknown>, out: PosCatalogItem[]): void {
  for (const item of (node['items'] as Array<Record<string, unknown>> | null) ?? []) {
    const guid = item['guid'] as string | undefined;
    if (!guid) continue;
    out.push({
      posItemId: guid,
      posItemName: (item['name'] as string) ?? '',
      variationName: 'Regular',
      price: Number(item['price'] ?? 0),
    });
  }
  for (const group of (node['menuGroups'] as Array<Record<string, unknown>> | null) ?? (node['groups'] as Array<Record<string, unknown>> | null) ?? []) {
    collectMenuItems(group, out);
  }
}

export const toastProvider: PosProvider = {
  key: 'toast',
  displayName: 'Toast',
  capabilities: { sales: true, labor: true, catalog: true },
  implemented: true,

  getAuthUrl: notViaOAuth,
  exchangeCode: (): Promise<PosTokens> => Promise.reject(new PosUnsupportedError('Toast connects with a restaurant GUID in Settings, not an OAuth redirect.')),

  async listLocations(companyId): Promise<PosLocation[]> {
    // A Toast connection maps to a single restaurant; surface it as one location
    // so events can bind to it the same way they bind a Square location.
    const guid = await getToastRestaurantGuid(companyId);
    const name = (await getToastRestaurantName(guid)) ?? 'Toast Restaurant';
    return [{ id: guid, name }];
  },

  async listCatalog(companyId): Promise<PosCatalogItem[]> {
    const menus = await toastGet<{ menus?: Array<Record<string, unknown>> }>(companyId, '/menus/v2/menus');
    const items: PosCatalogItem[] = [];
    for (const menu of menus?.menus ?? []) collectMenuItems(menu, items);
    return items;
  },

  async pullSales(companyId, event: PosEvent): Promise<PosSalesPull> {
    if (!event.posLocationId) throw new Error('Event has no POS location linked. Edit the event and select a location first.');
    const { startAt, endAt } = buildDateWindow(event);

    const allOrders: Array<Record<string, unknown>> = [];
    let page = 1;
    // ordersBulk returns up to pageSize orders per page; paginate until short page.
    for (;;) {
      const batch = await toastGet<Array<Record<string, unknown>>>(
        companyId, '/orders/v2/ordersBulk', { startDate: startAt, endDate: endAt, page, pageSize: 100 }
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      allOrders.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }

    let grossSales = 0, discounts = 0, refunds = 0, tips = 0, taxCollected = 0, totalCollected = 0;
    let orderCount = 0;
    const itemMap = new Map<string, { name: string; qty: number; catalogObjectId: string | null; revenue: number }>();

    for (const order of allOrders) {
      if (order['voided']) continue;
      orderCount += 1;
      for (const check of (order['checks'] as Array<Record<string, unknown>> | null) ?? []) {
        if (check['voided']) continue;
        grossSales += Number(check['amount'] ?? 0);
        taxCollected += Number(check['taxAmount'] ?? 0);
        for (const d of (check['appliedDiscounts'] as Array<Record<string, unknown>> | null) ?? []) {
          discounts += Number(d['discountAmount'] ?? 0);
        }
        for (const sel of (check['selections'] as Array<Record<string, unknown>> | null) ?? []) {
          if (sel['voided']) continue;
          const name = String(sel['displayName'] ?? '').trim();
          const qty = Number(sel['quantity'] ?? 0);
          if (!name) continue;
          // Toast menu-item guid — the key mappings are stored under (PosItemMapping.posItemId).
          const catalogObjectId = ((sel['item'] as Record<string, unknown> | null)?.['guid'] as string | undefined) ?? null;
          const key = catalogObjectId ?? name;
          const prev = itemMap.get(key);
          itemMap.set(key, {
            name,
            qty: (prev?.qty ?? 0) + qty,
            catalogObjectId,
            revenue: (prev?.revenue ?? 0) + Number(sel['price'] ?? 0),
          });
        }
        for (const p of (check['payments'] as Array<Record<string, unknown>> | null) ?? []) {
          totalCollected += Number(p['amount'] ?? 0) + Number(p['tipAmount'] ?? 0);
          tips += Number(p['tipAmount'] ?? 0);
          const refund = p['refund'] as Record<string, unknown> | null;
          if (refund) refunds += Number(refund['refundAmount'] ?? 0) + Number(refund['tipRefundAmount'] ?? 0);
        }
      }
    }

    return {
      // Toast doesn't expose payment-processing fees via the Orders API.
      grossSales, discounts, refunds, tips, processingFees: 0, totalCollected, taxCollected,
      items: [...itemMap.values()],
      orderCount,
    };
  },

  async pullLabor(companyId, event: PosEvent): Promise<PosLaborPull> {
    if (!event.posLocationId) throw new Error('Event has no POS location linked.');
    const { startAt, endAt } = buildDateWindow(event);

    const entries = await toastGet<Array<Record<string, unknown>>>(
      companyId, '/labor/v1/timeEntries', { startDate: startAt, endDate: endAt }
    );

    // Resolve employee names once.
    const nameByGuid = new Map<string, string>();
    try {
      const employees = await toastGet<Array<Record<string, unknown>>>(companyId, '/labor/v1/employees');
      for (const emp of employees ?? []) {
        const guid = emp['guid'] as string | undefined;
        if (!guid) continue;
        const name = (emp['chosenName'] as string) || `${emp['firstName'] ?? ''} ${emp['lastName'] ?? ''}`.trim();
        if (name) nameByGuid.set(guid, name);
      }
    } catch { /* names are best-effort */ }

    const rows = (Array.isArray(entries) ? entries : []).map(entry => {
      const empGuid = (entry['employeeReference'] as Record<string, unknown> | null)?.['guid'] as string | undefined;
      let hours = Number(entry['regularHours'] ?? 0) + Number(entry['overtimeHours'] ?? 0);
      if (!hours && entry['inDate'] && entry['outDate']) {
        const ms = new Date(entry['outDate'] as string).getTime() - new Date(entry['inDate'] as string).getTime();
        hours = Math.round((ms / 3_600_000) * 100) / 100;
      }
      return {
        name: (empGuid && nameByGuid.get(empGuid)) || empGuid || 'Unknown',
        hours,
        wage: Number(entry['hourlyWage'] ?? 0),
      };
    });

    return { rows };
  },
};

import { squareProvider } from './square.js';
import { toastProvider } from './toast.js';
import { PosUnsupportedError, type PosProvider, type PosProviderKey, type PosCapabilities } from './types.js';

export * from './types.js';

// A not-yet-implemented provider: declares its capabilities (so the UI/registry
// can show it) but throws if any operation is attempted.
function stub(key: PosProviderKey, displayName: string, capabilities: PosCapabilities): PosProvider {
  const notReady = (): never => { throw new PosUnsupportedError(`${displayName} integration is coming soon.`); };
  return {
    key, displayName, capabilities, implemented: false,
    getAuthUrl: notReady,
    exchangeCode: notReady,
    listLocations: notReady,
    listCatalog: notReady,
    listModifierCatalog: notReady,
    pullSales: notReady,
    pullLabor: notReady,
  };
}

const REGISTRY: Record<PosProviderKey, PosProvider> = {
  square: squareProvider,
  shopify: stub('shopify', 'Shopify', { sales: true, labor: false, catalog: true }),
  toast: toastProvider,
};

export function getProvider(key: string | null | undefined): PosProvider {
  const p = key ? REGISTRY[key as PosProviderKey] : undefined;
  if (!p) throw new PosUnsupportedError(`Unknown POS provider: ${key ?? '(none)'}`);
  return p;
}

// The provider currently active for a company (its onboarding posSystem choice).
export function providerForCompany(posSystem: string | null | undefined): PosProvider | null {
  if (!posSystem || posSystem === 'manual') return null;
  const p = REGISTRY[posSystem as PosProviderKey];
  return p ?? null;
}

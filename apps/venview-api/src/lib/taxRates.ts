import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import zipcodes from 'zipcodes';

export interface TaxRateLookup {
  stateRate: number;   // decimal, e.g. 0.047
  localRate: number;   // combined county + city + special districts
  combinedRate: number;
  jurisdiction: { state: string; county: string; city: string };
}

// General statewide sales-tax rates (decimals) by USPS state code, used as a
// fallback when TaxJar isn't configured so at least the STATE portion can be
// estimated. These are the base state rates only — local (county/city/district)
// tax is not included, so callers should treat this as an estimate and let the
// user override with exact rates. NH/OR/MT/DE/AK have no statewide sales tax.
const STATE_SALES_TAX_RATES: Record<string, number> = {
  AL: 0.04, AK: 0.0, AZ: 0.056, AR: 0.065, CA: 0.0725, CO: 0.029, CT: 0.0635,
  DE: 0.0, DC: 0.06, FL: 0.06, GA: 0.04, HI: 0.04, ID: 0.06, IL: 0.0625,
  IN: 0.07, IA: 0.06, KS: 0.065, KY: 0.06, LA: 0.05, ME: 0.055, MD: 0.06,
  MA: 0.0625, MI: 0.06, MN: 0.06875, MS: 0.07, MO: 0.04225, MT: 0.0, NE: 0.055,
  NV: 0.0685, NH: 0.0, NJ: 0.06625, NM: 0.04875, NY: 0.04, NC: 0.0475,
  ND: 0.05, OH: 0.0575, OK: 0.045, OR: 0.0, PA: 0.06, RI: 0.07, SC: 0.06,
  SD: 0.042, TN: 0.07, TX: 0.0625, UT: 0.0485, VT: 0.06, VA: 0.053, WA: 0.065,
  WV: 0.06, WI: 0.05, WY: 0.04,
};

// Fallback rate lookup that needs no external API: resolve the state from the
// ZIP (via the bundled `zipcodes` dataset) and return that state's base rate.
// Local tax is unknown, so localRate is 0 and combinedRate == stateRate.
// Returns null for unknown ZIPs or no-sales-tax states.
export function lookupStateFallbackRate(zip: string): TaxRateLookup | null {
  const clean = (zip ?? '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(clean)) return null;
  const zc = zipcodes.lookup(clean);
  const state = String(zc?.state ?? '').toUpperCase();
  const stateRate = STATE_SALES_TAX_RATES[state];
  if (!state || stateRate == null || stateRate === 0) return null;
  return {
    stateRate,
    localRate: 0,
    combinedRate: stateRate,
    jurisdiction: { state, county: '', city: String(zc?.city ?? '') },
  };
}

// Validate a TaxJar token with a lightweight rate lookup. Distinguishes a
// rejected token (auth failure) from a transient network problem so the caller
// can give a precise error and never store an unverified token.
export async function verifyTaxjarToken(token: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  if (!token.trim()) return 'invalid';
  try {
    await axios.get('https://api.taxjar.com/v2/rates/90210', {
      headers: { Authorization: `Bearer ${token.trim()}` },
      timeout: 8000,
    });
    return 'valid';
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    return status === 401 || status === 403 ? 'invalid' : 'unreachable';
  }
}

// Look up the state + combined-local sales tax rate for a US ZIP, using the
// company's own TaxJar token.
//
// Provider boundary: this single function isolates the rate source so it can be
// swapped (TaxJar today; another API or a static dataset later). Returns null
// on any failure / missing token so callers degrade to manual entry.
export async function lookupTaxRates(zip: string, token: string): Promise<TaxRateLookup | null> {
  const clean = (zip ?? '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(clean)) return null;
  if (!token) return null;

  try {
    const res = await axios.get(`https://api.taxjar.com/v2/rates/${clean}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });
    const r = (res.data as { rate?: Record<string, unknown> })?.rate;
    if (!r) return null;

    const stateRate = Number(r['state_rate'] ?? 0);
    const combinedRate = Number(r['combined_rate'] ?? 0);
    const localRate = Math.max(0, +(combinedRate - stateRate).toFixed(6));

    // Fall back to the zipcodes package for names TaxJar may omit.
    const zc = zipcodes.lookup(clean);
    return {
      stateRate,
      localRate,
      combinedRate,
      jurisdiction: {
        state: String(r['state'] ?? zc?.state ?? ''),
        county: String(r['county'] ?? ''),
        city: String(r['city'] ?? zc?.city ?? ''),
      },
    };
  } catch {
    return null;
  }
}

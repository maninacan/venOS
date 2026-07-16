// eslint-disable-next-line @typescript-eslint/no-require-imports
import zipcodes from 'zipcodes';

export interface TaxRateLookup {
  stateRate: number;   // decimal, e.g. 0.047
  localRate: number;   // combined county + city + special districts
  combinedRate: number;
  jurisdiction: { state: string; county: string; city: string };
}

// General statewide sales-tax rates (decimals) by USPS state code. Used to
// estimate the STATE portion for events whose POS didn't report actual tax
// (e.g. manual/non-POS events). These are the base state rates only — local
// (county/city/district) tax is not included, so callers should treat this as an
// estimate and let the user override with exact rates. NH/OR/MT/DE/AK have no
// statewide sales tax.
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

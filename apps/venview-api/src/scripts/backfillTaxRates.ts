// One-time backfill: populate SalesSummary.stateTaxRate / localTaxRate / taxRate
// for events created before the state-tax fix (commit c760fe0). Those rows still
// have stateTaxRate = 0, so the dashboard renders state tax as $0 until something
// re-triggers a rate lookup.
//
// This mirrors applyTaxRates() in resolvers/sales.ts (ZIP-based state estimate,
// via the same shared lib function) but runs standalone against whichever
// database the env points at. Run it once per environment:
//
//   doppler run --project venos --config dev -- node <bundle> --dry-run
//   doppler run --project venos --config dev -- node <bundle>
//   doppler run --project venos --config prd -- node <bundle> --dry-run
//   doppler run --project venos --config prd -- node <bundle>
//
// Idempotent: only touches rows that have no override and a zero/absent state
// rate, so re-running is a no-op. --dry-run reports what it *would* change and
// writes nothing.
import { createClient } from '@supabase/supabase-js';
import { lookupStateFallbackRate, type TaxRateLookup } from '../lib/taxRates.js';

const DRY_RUN = process.argv.includes('--dry-run');

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SECRET_KEY'];
if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY');
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

type Row = Record<string, unknown>;

async function main() {
  const host = new URL(url!).host;
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Backfilling tax rates against ${host}\n`);

  const { data: events, error: evErr } = await supabase
    .from('EventInfo')
    .select('eventID, zipCode, companyId');
  if (evErr) throw evErr;

  // Pull every summary + company once and join in memory (cheaper than per-event
  // round-trips). We only decide-to-touch from these; the write is per-event.
  const { data: summaries } = await supabase
    .from('SalesSummary')
    .select('eventID, taxOverride, stateTaxRate');
  const summaryByEvent = new Map<string, Row>();
  for (const s of (summaries ?? []) as Row[]) summaryByEvent.set(String(s['eventID']), s);

  // Cache lookups so N events with the same ZIP resolve once.
  const rateCache = new Map<string, TaxRateLookup | null>();
  function resolveRates(zip: string): TaxRateLookup | null {
    if (rateCache.has(zip)) return rateCache.get(zip)!;
    const rates = lookupStateFallbackRate(zip);
    rateCache.set(zip, rates);
    return rates;
  }

  const counts = { updated: 0, override: 0, alreadySet: 0, noSummary: 0, noZip: 0, noRate: 0 };

  for (const ev of (events ?? []) as Row[]) {
    const eventId = String(ev['eventID']);
    const zip = (ev['zipCode'] as string | null) ?? '';
    const companyId = (ev['companyId'] as string | null) ?? '';

    const summary = summaryByEvent.get(eventId);
    if (!summary) { counts.noSummary++; continue; }          // no dashboard figure to fix
    if (summary['taxOverride']) { counts.override++; continue; } // user set rates manually
    if (Number(summary['stateTaxRate'] ?? 0) > 0) { counts.alreadySet++; continue; } // already good
    if (!zip || !companyId) { counts.noZip++; continue; }

    const rates = resolveRates(zip);
    if (!rates) { counts.noRate++; continue; }               // unknown ZIP or no-sales-tax state

    if (DRY_RUN) {
      console.log(`  would set ${eventId}  zip=${zip}  state=${(rates.stateRate * 100).toFixed(2)}%  local=${(rates.localRate * 100).toFixed(2)}%  (${rates.jurisdiction.state})`);
    } else {
      const { error: upErr } = await supabase.from('SalesSummary').update({
        stateTaxRate: rates.stateRate,
        localTaxRate: rates.localRate,
        taxRate: rates.combinedRate,
        taxJurisdiction: rates.jurisdiction,
        updatedAt: new Date().toISOString(),
      }).eq('eventID', eventId);
      if (upErr) { console.error(`  FAILED ${eventId}: ${upErr.message}`); continue; }
    }
    counts.updated++;
  }

  console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'}: ${counts.updated}`);
  console.log(`Skipped — manual override: ${counts.override}, already set: ${counts.alreadySet}, no sales summary: ${counts.noSummary}, no ZIP/company: ${counts.noZip}, no resolvable rate (unknown ZIP / no-tax state): ${counts.noRate}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

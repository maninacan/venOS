-- Remove the TaxJar integration. Sales-tax rates now come from the POS (Square's
-- actual applied taxes) with a ZIP-based state estimate as the only fallback, so
-- the per-company TaxJar API token is no longer used or stored.
alter table public."Companies"
  drop column if exists "taxjarToken";

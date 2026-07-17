-- State + local sales-tax breakdown per event. Tax stays a pass-through
-- liability (never part of profit); these columns track what was COLLECTED so
-- the vendor knows what to remit, split by state vs combined local jurisdiction.
alter table public."SalesSummary"
  add column if not exists "stateTaxRate"    numeric(8,6) default 0,
  add column if not exists "localTaxRate"    numeric(8,6) default 0,
  add column if not exists "taxCollected"    numeric(12,2) default 0,
  add column if not exists "taxJurisdiction" jsonb;

-- Existing "taxRate" is retained as the combined (state + local) rate;
-- "taxOverride" continues to flag a manually-entered rate.

-- Custom expenses (reusing AdditionalFees) can now be flat, per-unit, or
-- percentage-based. `amount` holds the RATE for the chosen type:
--   flat       -> dollars
--   per_unit   -> dollars per item sold (multiplier = total items sold, computed at read time)
--   percentage -> percent value (e.g. 3 for 3%) applied to `pctBase`
-- `pctBase` ('gross' | 'net') is only meaningful when calcType = 'percentage'.
-- Existing rows are flat, preserving current behavior.
alter table public."AdditionalFees"
  add column if not exists "calcType" text not null default 'flat',
  add column if not exists "pctBase"  text;

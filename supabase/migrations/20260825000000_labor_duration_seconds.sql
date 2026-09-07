-- Store the raw shift duration so labor pay stops accumulating rounding error.
--
-- Square returns exact clock-in/clock-out timestamps, but pullLabor immediately
-- collapsed them to a 2-decimal `hours` figure (Math.round(ms/36000)/100), which
-- quantizes to 0.01 hr = 36 seconds. At $18-22/hr that is up to ~$0.10 of error
-- per shift, in either direction, and it compounds across an event.
--
-- `durationSeconds` keeps the exact duration. `hours` is retained: it is still the
-- input for manually entered shifts, and it remains the natural display figure.
-- When durationSeconds is present it is authoritative and hours is derived.
--
-- The generated `total` column must be dropped and recreated to change its
-- expression. It stays numeric(10,2) — a per-shift total is a real dollar figure
-- and rounding it for display is correct. The event total is NOT summed from this
-- column; it is recomputed from durationSeconds at full precision and rounded once
-- (see computeProfit / syncLaborFees), which is the only rounding that must happen.
alter table public."EventLabor"
  add column if not exists "durationSeconds" integer;

alter table public."EventLabor" drop column if exists "total";
alter table public."EventLabor"
  add column "total" numeric(10,2)
  generated always as (
    case
      when "flatRate" is not null then "flatRate"
      when "durationSeconds" is not null then round(("durationSeconds"::numeric / 3600) * wage, 2)
      else hours * wage
    end
  ) stored;

comment on column public."EventLabor"."durationSeconds" is
  'Exact shift length in seconds, from the POS timecard. Authoritative over `hours` when set; null for manually entered shifts.';

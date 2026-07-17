-- Onboarding answers stored on the company: which POS (if any) and how labor
-- is calculated.
alter table public."Companies"
  add column if not exists "posSystem"   text,   -- 'square' | 'manual' (shopify/toast reserved)
  add column if not exists "laborMethod" text;    -- 'pos' | 'other' | 'flat_rate'

-- Flat-rate-per-shift labor: an optional fixed amount per shift. The generated
-- `total` column must be dropped and recreated to change its expression.
alter table public."EventLabor"
  add column if not exists "flatRate" numeric(10,2);

alter table public."EventLabor" drop column if exists "total";
alter table public."EventLabor"
  add column "total" numeric(10,2)
  generated always as (case when "flatRate" is not null then "flatRate" else hours * wage end) stored;

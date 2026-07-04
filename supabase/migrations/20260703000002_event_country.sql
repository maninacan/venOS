-- Country for geographic reporting beyond the US. Each company sets a default
-- country; each event carries its own country (defaulted from the company at
-- creation, overridable per event). ISO 3166-1 alpha-2 codes (e.g. 'US', 'CA').
alter table public."Companies"
  add column if not exists "defaultCountry" text not null default 'US';

alter table public."EventInfo"
  add column if not exists "country" text;

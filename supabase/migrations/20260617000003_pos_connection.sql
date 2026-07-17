-- Generalize the Square-specific connection into a provider-keyed model so
-- Shopify/Toast can plug in later. One row per (company, provider).
create table if not exists public."PosConnection" (
  id             uuid primary key default gen_random_uuid(),
  "companyId"    uuid not null references public."Companies"(id) on delete cascade,
  provider       text not null,
  "accessToken"  text,
  "refreshToken" text,
  "externalId"   text,            -- merchant/shop/restaurant id
  "locationId"   text,
  "locationName" text,
  meta           jsonb,
  "expiresAt"    timestamptz,     -- access-token expiry (was SquareConnection.createdAt)
  "createdAt"    timestamptz default now(),
  unique("companyId", provider)
);

-- RLS deny-all (API uses the service role, which bypasses it) — matches every
-- other public table.
alter table public."PosConnection" enable row level security;

-- Migrate existing Square connections, then drop the old table.
insert into public."PosConnection"
  ("companyId", provider, "accessToken", "refreshToken", "externalId", "locationId", "locationName", "expiresAt", "createdAt")
select "companyId", 'square', "accessToken", "refreshToken", "merchantId", "locationId", "locationName", "createdAt", now()
from public."SquareConnection"
on conflict ("companyId", provider) do nothing;

drop table if exists public."SquareConnection";

-- The OAuth state now records which provider initiated the flow.
alter table public."OAuthState" add column if not exists provider text not null default 'square';

-- Per-event POS location binding is no longer Square-specific.
alter table public."EventInfo" rename column "squareLocationId" to "posLocationId";

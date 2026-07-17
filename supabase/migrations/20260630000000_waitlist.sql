-- Early-access waitlist captured from the marketing site (venview.io).
-- Rows are written only by the venview-api service-role client via
-- POST /api/waitlist. Emails are PII, so the table is locked down.
create table if not exists "Waitlist" (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  source      text,
  "createdAt" timestamptz default now()
);

-- Default-deny RLS (matches 20260616000001_enable_rls.sql): only the
-- service-role key (used by the API) may read/write. The public anon key
-- shipped to browsers must never be able to read captured emails.
alter table public."Waitlist" enable row level security;

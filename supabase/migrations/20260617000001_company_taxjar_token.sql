-- Per-company TaxJar API token, encrypted at rest (AES-256-GCM, same scheme as
-- Square tokens). Never exposed over GraphQL — only a `taxjarConnected` boolean.
alter table public."Companies"
  add column if not exists "taxjarToken" text;

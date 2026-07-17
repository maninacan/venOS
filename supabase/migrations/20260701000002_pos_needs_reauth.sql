-- Set true when a POS API call fails with an auth error (dead/revoked token),
-- so the UI can prompt the user to reconnect. Cleared on a successful sync or
-- reconnect.
alter table public."PosConnection"
  add column if not exists "needsReauth" boolean not null default false;

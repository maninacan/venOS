-- Ownership transfers are now a two-step handshake: the owner offers ownership
-- (sets pendingOwnerId), and the recipient must accept before it takes effect.
alter table public."Companies"
  add column if not exists "pendingOwnerId" uuid;

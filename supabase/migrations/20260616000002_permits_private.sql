-- Permit files are private. The bucket is already private; this stops storing a
-- (broken, non-functional) public URL and instead stores the storage object
-- path. The API mints short-lived signed URLs on read via the GraphQL
-- `Permit.fileUrl` field resolver.
alter table public."Permits" add column if not exists "filePath" text;

-- `fileUrl` is no longer written on new uploads (URLs are now signed on read).
alter table public."Permits" alter column "fileUrl" drop not null;

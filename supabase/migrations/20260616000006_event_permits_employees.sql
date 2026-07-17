-- Event details form captures free-text permit status and expected staffing.
alter table public."EventInfo"
  add column if not exists "permits"   text,
  add column if not exists "employees" text;

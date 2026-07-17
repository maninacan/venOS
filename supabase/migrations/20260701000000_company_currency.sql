-- Multi-currency support: each company (merchant) transacts in a single
-- currency, shown POS-style throughout the client. ISO 4217 code; defaults to
-- 'USD' so existing rows and US merchants are unaffected. Auto-populated from
-- the connected POS location currency on connect, with a manual override in
-- Settings.
alter table public."Companies"
  add column if not exists currency text not null default 'USD';

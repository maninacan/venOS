-- Enable Row Level Security on all public tables.
--
-- Default-deny (no policies): the anon/authenticated PostgREST roles can no
-- longer read or write these tables directly. This closes a multi-tenant data
-- isolation hole where the browser-shipped anon key could bypass the GraphQL
-- API's auth checks.
--
-- Safe with no policies because:
--   * the GraphQL API uses the service-role key, which bypasses RLS;
--   * the browser Supabase client uses the anon key for auth only (auth schema),
--     never querying these public tables directly.
-- If direct client access is ever added, add membership-scoped policies (see
-- the billing plan notes) instead of relying on default-deny.

alter table public."Companies"          enable row level security;
alter table public."CompanyMembers"     enable row level security;
alter table public."SquareConnection"   enable row level security;
alter table public."EventInfo"          enable row level security;
alter table public."EventDays"          enable row level security;
alter table public."SalesSummary"       enable row level security;
alter table public."EventExpenses"      enable row level security;
alter table public."EventLabor"         enable row level security;
alter table public."EventSupplies"      enable row level security;
alter table public."AdditionalFees"     enable row level security;
alter table public."InventorySales"     enable row level security;
alter table public."EmployeeTracker"    enable row level security;
alter table public."RecipeCards"        enable row level security;
alter table public."RecipeIngredients"  enable row level security;
alter table public."VendorInventory"    enable row level security;
alter table public."InventoryAlerts"    enable row level security;
alter table public."PosItemMapping"     enable row level security;
alter table public."EventInventory"     enable row level security;
alter table public."FormTemplate"       enable row level security;
alter table public."Permits"            enable row level security;
alter table public."OAuthState"         enable row level security;

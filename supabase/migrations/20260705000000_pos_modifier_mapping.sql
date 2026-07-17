-- POS modifier → recipe/inventory cost mapping.
--
-- Square line items carry `modifiers[]` (flavor add-ons, whip, etc.) whose
-- upcharge is already in the item's gross sales but whose COST was previously
-- dropped, understating COGS. This table maps each modifier (by its Square
-- catalog_object_id) to a recipe or inventory item so `syncSales` can fold the
-- modifier's ingredient cost into the sold line's totalCost. Mirrors
-- PosItemMapping (a mapped recipe wins over the inventory unit cost).

create table if not exists public."PosModifierMapping" (
  id                uuid primary key default gen_random_uuid(),
  "companyId"       uuid not null references public."Companies"(id) on delete cascade,
  "posSystem"       text default 'square',
  "posModifierId"   text not null,      -- Square modifier catalog_object_id
  "posModifierName" text,
  "inventoryId"     uuid references public."VendorInventory"(id) on delete set null,
  "recipeId"        uuid references public."RecipeCards"(id) on delete set null,
  unique("companyId", "posModifierId")
);
create index if not exists idx_posmodmapping_company on public."PosModifierMapping"("companyId");

-- Default-deny RLS (the GraphQL API uses the service-role key, which bypasses
-- RLS; the browser never queries this table directly). Matches every other
-- public table — see 20260616000001_enable_rls.sql.
alter table public."PosModifierMapping" enable row level security;

-- Per-line modifier COGS, stored for transparency. The row's `totalCost`
-- continues to be the full line COGS (base unit cost × qty + modifierCost);
-- this column just exposes the modifier portion for reporting/debugging.
alter table public."InventorySales"
  add column if not exists "modifierCost" numeric(10,4);

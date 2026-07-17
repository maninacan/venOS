-- Recipe composition ("sub-recipes").
--
-- Until now recipes were flat (RecipeCards + free-text RecipeIngredients). This
-- adds typed COMPONENTS so a recipe can be composed from a base recipe, a mapped
-- modifier, and/or an inventory item — each with a quantity. A recipe's cost then
-- becomes its own ingredients plus the resolved cost of each component (see
-- apps/venview-api/src/lib/recipeCost.ts). A negative quantity removes cost.
--
-- Flat RecipeIngredients is intentionally left untouched so existing recipes, the
-- full-replace updateRecipe flow, and the AI bulk-import all keep working.
create table if not exists public."RecipeComponents" (
  id               uuid primary key default gen_random_uuid(),
  "recipeId"       uuid not null references public."RecipeCards"(id) on delete cascade,      -- parent recipe
  "componentType"  text not null,                                                            -- 'recipe' | 'modifier' | 'inventory'
  "refRecipeId"    uuid references public."RecipeCards"(id) on delete cascade,               -- when componentType = 'recipe'
  "refModifierId"  uuid references public."PosModifierMapping"(id) on delete cascade,        -- when componentType = 'modifier'
  "refInventoryId" uuid references public."VendorInventory"(id) on delete cascade,           -- when componentType = 'inventory'
  quantity         numeric(10,4) default 1,                                                  -- multiplier/amount; negative = removal
  "position"       integer default 0                                                         -- display order
);
create index if not exists idx_recipecomponents_recipe on public."RecipeComponents"("recipeId");

-- Default-deny RLS (the GraphQL API uses the service-role key, which bypasses
-- RLS; the browser never queries this table directly) — matches every other
-- public table, see 20260616000001_enable_rls.sql.
alter table public."RecipeComponents" enable row level security;

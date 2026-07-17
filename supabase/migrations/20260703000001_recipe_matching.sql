-- Recipe matching for COGS: a POS item mapping can point to a recipe, and that
-- recipe's total ingredient cost becomes the sold item's unit COGS (recipe takes
-- precedence over the inventory item's unit cost). InventorySales stamps the
-- matched recipe at pull time so the event report can attribute COGS per item.
alter table public."PosItemMapping"
  add column if not exists "recipeId" uuid references public."RecipeCards"(id) on delete set null;

alter table public."InventorySales"
  add column if not exists "recipeId" uuid references public."RecipeCards"(id) on delete set null;

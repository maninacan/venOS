-- Amount of the mapped inventory item a modifier uses per drink.
--
-- A modifier's cost is `quantity × inventory.unitCost` per application (e.g.
-- "Strawberry" = 1 oz of Strawberry Syrup). A NEGATIVE quantity represents a
-- removal that REDUCES COGS (e.g. "No SCM" = -1 of Sweetened Condensed Milk),
-- netting out an ingredient the base drink recipe included — so no CHECK
-- constraint here. Default 1 for a plain single-unit add-on.
alter table public."PosModifierMapping"
  add column if not exists "quantity" numeric(10,4) default 1;

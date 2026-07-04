-- Per-item revenue on InventorySales, enabling an item-level P&L (revenue − COGS).
-- Also fixes a long-standing misnomer: `unitPrice` actually stored the unit COST,
-- so rename it to `unitCost`. The rename is guarded so re-runs are safe.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'InventorySales' and column_name = 'unitPrice')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'InventorySales' and column_name = 'unitCost')
  then
    alter table public."InventorySales" rename column "unitPrice" to "unitCost";
  end if;
end $$;

alter table public."InventorySales"
  add column if not exists "revenue" numeric(12,2);

-- Store the actual tax breakdown the POS applied (Square returns a per-order
-- `taxes` array with each tax's name, percentage, and amount). Persisting it lets
-- the Sales Tax tab show the real rate that was collected instead of relying on a
-- separate ZIP-based estimate (which shows 0.00% when it can't resolve).
-- Shape: [{ "name": "CA State Tax", "rate": 0.0725, "amount": 36.25 }, ...]
alter table public."SalesSummary"
  add column if not exists "taxLines" jsonb;

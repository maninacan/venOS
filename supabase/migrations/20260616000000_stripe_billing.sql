-- Stripe billing: mirror subscription state from Stripe onto the Companies row.
-- `plan` / `planUpdatedAt` already exist; `plan` remains the feature-gate flag.
alter table "Companies"
  add column if not exists "stripeCustomerId"     text,
  add column if not exists "stripeSubscriptionId" text,
  add column if not exists "subscriptionStatus"   text,
  add column if not exists "currentPeriodEnd"     timestamptz;

-- Webhook looks companies up by Stripe customer id.
create index if not exists "Companies_stripeCustomerId_idx"
  on "Companies" ("stripeCustomerId");

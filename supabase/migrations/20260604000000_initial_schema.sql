-- VenView initial schema
-- Multi-tenant: Companies are the primary unit. All data scoped per company.

create extension if not exists "pgcrypto";

-- ── Companies ─────────────────────────────────────────────────────────────────
create table if not exists "Companies" (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text,
  "contactName"   text,
  "vendorCategory" text,
  email           text,
  "ownerId"       uuid not null,
  "joinCode"      text unique,
  plan            text not null default 'starter',
  "planUpdatedAt" timestamptz,
  "createdAt"     timestamptz default now()
);

-- ── CompanyMembers ────────────────────────────────────────────────────────────
create table if not exists "CompanyMembers" (
  id          uuid primary key default gen_random_uuid(),
  "companyId" uuid not null references "Companies"(id) on delete cascade,
  "userId"    uuid not null,
  role        text not null default 'member',
  "joinedAt"  timestamptz default now(),
  unique("companyId", "userId")
);
create index if not exists idx_company_members_user    on "CompanyMembers"("userId");
create index if not exists idx_company_members_company on "CompanyMembers"("companyId");

-- ── SquareConnection ──────────────────────────────────────────────────────────
create table if not exists "SquareConnection" (
  id              uuid primary key default gen_random_uuid(),
  "companyId"     uuid not null unique references "Companies"(id) on delete cascade,
  "accessToken"   text,
  "refreshToken"  text,
  "locationId"    text,
  "locationName"  text,
  "merchantId"    text,
  "createdAt"     timestamptz default now()
);

-- ── OAuthState ────────────────────────────────────────────────────────────────
create table if not exists "OAuthState" (
  id          uuid primary key default gen_random_uuid(),
  state       text not null unique,
  "companyId" uuid not null references "Companies"(id) on delete cascade,
  "userId"    uuid not null,
  "createdAt" timestamptz default now()
);
create index if not exists idx_oauthstate_state on "OAuthState"(state);

-- ── EventInfo ─────────────────────────────────────────────────────────────────
create table if not exists "EventInfo" (
  "eventID"          uuid primary key default gen_random_uuid(),
  "companyId"        uuid not null references "Companies"(id) on delete cascade,
  "userId"           uuid,
  "eventName"        text not null,
  "eventDate"        date,
  "endDate"          date,
  status             text,
  "eventType"        text,
  "eventHost"        text,
  "eventLocation"    text,
  coordinator        text,
  notes              text,
  "zipCode"          text,
  "squareLocationId" text,
  time               text,
  "applicationDate"  date,
  "eventRating"      text,
  "customFields"     jsonb,
  "numDays"          integer default 1,
  "isFinalized"      boolean default false,
  "finalizedDate"    date,
  "createdAt"        timestamptz default now()
);
create index if not exists idx_eventinfo_company on "EventInfo"("companyId");

-- ── EventDays ─────────────────────────────────────────────────────────────────
create table if not exists "EventDays" (
  id          uuid primary key default gen_random_uuid(),
  "eventID"   uuid not null references "EventInfo"("eventID") on delete cascade,
  "dayNumber" integer not null,
  "eventDate" date,
  "startTime" text,
  "endTime"   text
);
create index if not exists idx_eventdays_event on "EventDays"("eventID");

-- ── SalesSummary ──────────────────────────────────────────────────────────────
create table if not exists "SalesSummary" (
  id               uuid primary key default gen_random_uuid(),
  "eventID"        uuid not null unique references "EventInfo"("eventID") on delete cascade,
  "grossSales"     numeric(12,2) default 0,
  "netSales"       numeric(12,2) default 0,
  discounts        numeric(12,2) default 0,
  refunds          numeric(12,2) default 0,
  tax              numeric(12,2) default 0,
  tips             numeric(12,2) default 0,
  "squareFees"     numeric(12,2) default 0,
  "posFees"        numeric(12,2) default 0,
  "taxRate"        numeric(8,6)  default 0,
  "taxOverride"    boolean default false,
  "totalCollected" numeric(12,2) default 0,
  "updatedAt"      timestamptz default now()
);

-- ── EventExpenses ─────────────────────────────────────────────────────────────
create table if not exists "EventExpenses" (
  id               uuid primary key default gen_random_uuid(),
  "eventID"        uuid not null unique references "EventInfo"("eventID") on delete cascade,
  "healthDeptFee"  numeric(10,2) default 0,
  "eventFee"       numeric(10,2) default 0,
  mileage          numeric(10,2) default 0,
  "mileageRate"    numeric(6,4)  default 0.67,
  "coordinatorFee" numeric(10,2) default 0,
  "posFee"         numeric(10,2) default 0,
  "employeeBonus"  numeric(10,2) default 0,
  "eventRunnerFees" numeric(10,2) default 0,
  -- Denormalized from EventLabor rows; kept in sync by syncLaborFees() in the API
  "laborFees"      numeric(10,2) default 0
);

-- ── EventLabor ────────────────────────────────────────────────────────────────
create table if not exists "EventLabor" (
  id           uuid primary key default gen_random_uuid(),
  "eventID"    uuid not null references "EventInfo"("eventID") on delete cascade,
  "employeeId" uuid,
  name         text,
  hours        numeric(6,2) default 0,
  wage         numeric(8,2) default 0,
  total        numeric(10,2) generated always as (hours * wage) stored
);
create index if not exists idx_eventlabor_event on "EventLabor"("eventID");

-- ── EventSupplies ─────────────────────────────────────────────────────────────
create table if not exists "EventSupplies" (
  id                uuid primary key default gen_random_uuid(),
  "eventID"         uuid not null references "EventInfo"("eventID") on delete cascade,
  name              text not null,
  quantity          numeric(10,3) default 1,
  "unitCost"        numeric(10,4) default 0,
  total             numeric(10,2) generated always as (quantity * "unitCost") stored,
  "inventoryItemId" uuid
);
create index if not exists idx_eventsupplies_event on "EventSupplies"("eventID");

-- ── AdditionalFees ────────────────────────────────────────────────────────────
create table if not exists "AdditionalFees" (
  id           uuid primary key default gen_random_uuid(),
  "eventID"    uuid not null references "EventInfo"("eventID") on delete cascade,
  label        text not null,
  amount       numeric(10,2) not null default 0,
  "isDiscount" boolean default false
);
create index if not exists idx_additionalfees_event on "AdditionalFees"("eventID");

-- ── InventorySales ────────────────────────────────────────────────────────────
create table if not exists "InventorySales" (
  id              uuid primary key default gen_random_uuid(),
  "eventID"       uuid not null references "EventInfo"("eventID") on delete cascade,
  name            text,
  "quantitySold"  numeric(10,3) default 0,
  "unitPrice"     numeric(10,4),
  "totalCost"     numeric(12,2)
);
create index if not exists idx_inventorysales_event on "InventorySales"("eventID");

-- ── EmployeeTracker ───────────────────────────────────────────────────────────
create table if not exists "EmployeeTracker" (
  id            uuid primary key default gen_random_uuid(),
  "companyId"   uuid not null references "Companies"(id) on delete cascade,
  name          text not null,
  "defaultWage" numeric(8,2) default 0
);
create index if not exists idx_employees_company on "EmployeeTracker"("companyId");

-- ── RecipeCards ───────────────────────────────────────────────────────────────
create table if not exists "RecipeCards" (
  id          uuid primary key default gen_random_uuid(),
  "companyId" uuid not null references "Companies"(id) on delete cascade,
  name        text not null,
  "createdAt" timestamptz default now()
);
create index if not exists idx_recipes_company on "RecipeCards"("companyId");

-- ── RecipeIngredients ─────────────────────────────────────────────────────────
create table if not exists "RecipeIngredients" (
  id         uuid primary key default gen_random_uuid(),
  "recipeId" uuid not null references "RecipeCards"(id) on delete cascade,
  name       text not null,
  quantity   numeric(10,4) default 1,
  "unitCost" numeric(10,4) default 0,
  unit       text
);
create index if not exists idx_ingredients_recipe on "RecipeIngredients"("recipeId");

-- ── VendorInventory ───────────────────────────────────────────────────────────
create table if not exists "VendorInventory" (
  id                 uuid primary key default gen_random_uuid(),
  "companyId"        uuid not null references "Companies"(id) on delete cascade,
  "itemName"         text not null,
  category           text,
  "unitCost"         numeric(10,4) default 0,
  "quantityOnHand"   numeric(10,3) default 0,
  "reorderThreshold" numeric(10,3) default 0,
  sku                text,
  "updatedAt"        timestamptz default now(),
  unique("companyId", "itemName")
);
create index if not exists idx_inventory_company on "VendorInventory"("companyId");

-- ── InventoryAlerts ───────────────────────────────────────────────────────────
create table if not exists "InventoryAlerts" (
  id            uuid primary key default gen_random_uuid(),
  "companyId"   uuid not null references "Companies"(id) on delete cascade,
  "itemId"      uuid not null references "VendorInventory"(id) on delete cascade,
  "triggeredAt" timestamptz default now(),
  "isRead"      boolean default false
);
create index if not exists idx_alerts_company on "InventoryAlerts"("companyId");

-- ── PosItemMapping ────────────────────────────────────────────────────────────
create table if not exists "PosItemMapping" (
  id              uuid primary key default gen_random_uuid(),
  "companyId"     uuid not null references "Companies"(id) on delete cascade,
  "posSystem"     text default 'square',
  "posItemId"     text not null,
  "posItemName"   text,
  "variationName" text,
  "inventoryId"   uuid references "VendorInventory"(id) on delete set null,
  unique("companyId", "posItemId")
);
create index if not exists idx_posmapping_company on "PosItemMapping"("companyId");

-- ── EventInventory (truck stock) ──────────────────────────────────────────────
create table if not exists "EventInventory" (
  id                uuid primary key default gen_random_uuid(),
  "eventID"         uuid not null references "EventInfo"("eventID") on delete cascade,
  "inventoryItemId" uuid not null references "VendorInventory"(id) on delete cascade,
  "quantityLoaded"  numeric(10,3) default 0,
  "quantitySold"    numeric(10,3) default 0,
  unique("eventID", "inventoryItemId")
);
create index if not exists idx_eventinventory_event on "EventInventory"("eventID");

-- ── FormTemplate ──────────────────────────────────────────────────────────────
create table if not exists "FormTemplate" (
  id             uuid primary key default gen_random_uuid(),
  "companyId"    uuid not null references "Companies"(id) on delete cascade,
  "templateName" text not null,
  fields         jsonb not null default '[]',
  "isActive"     boolean default false,
  "createdAt"    timestamptz default now()
);
create index if not exists idx_formtemplate_company on "FormTemplate"("companyId");

-- ── Permits ───────────────────────────────────────────────────────────────────
create table if not exists "Permits" (
  id           uuid primary key default gen_random_uuid(),
  "eventID"    uuid not null references "EventInfo"("eventID") on delete cascade,
  "fileName"   text not null,
  "fileUrl"    text not null,
  "uploadedAt" timestamptz default now()
);
create index if not exists idx_permits_event on "Permits"("eventID");

-- ── Supabase Storage bucket for permit files ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('venview-permits', 'venview-permits', false)
on conflict (id) do nothing;

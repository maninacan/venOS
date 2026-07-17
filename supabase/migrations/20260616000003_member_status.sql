-- Join-by-code now creates a pending access request instead of instant
-- membership. A CompanyMembers row carries a status: 'active' members have
-- access; 'pending' rows are access requests awaiting owner approval.
-- Existing rows (owners and current members) default to 'active'.
alter table public."CompanyMembers"
  add column if not exists "status" text not null default 'active';

create index if not exists "CompanyMembers_company_status_idx"
  on public."CompanyMembers" ("companyId", "status");

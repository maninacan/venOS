-- Tracks when a user last sent a reminder to the owner about their PENDING
-- join request, so reminders can be rate-limited (see remindJoinRequest).
alter table public."CompanyMembers"
  add column if not exists "lastRemindedAt" timestamptz;

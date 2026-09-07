-- Give events a real time zone, and make day times real times.
--
-- Calendar export needs both. A timed calendar entry is meaningless without a
-- zone: "10:00" exported from a Utah event lands at 10:00 in whatever zone the
-- recipient's calendar assumes. And `startTime`/`endTime` were free text, so
-- "10am", "10:00" and "Noon-6" were all equally storable and none reliably
-- parseable.
--
-- `timeZone` is IANA (e.g. 'America/Denver'), derived from the event's ZIP via
-- polygon lookup in lib/timeZone.ts rather than a state map — several states
-- span zones. Nullable: when it can't be resolved, callers fall back to all-day
-- entries instead of guessing an hour.
alter table public."EventInfo"
  add column if not exists "timeZone" text;

comment on column public."EventInfo"."timeZone" is
  'IANA time zone for the event (e.g. America/Denver), derived from zipCode. Null means unknown — treat times as unzoned and prefer all-day calendar entries.';

-- text -> time. Verified before writing this: zero rows in prod or dev have a
-- non-empty startTime/endTime, so there is nothing to convert. The regex guard
-- means the cast can never fail mid-deploy on a value entered between now and
-- when this runs; anything not HH:MM or HH:MM:SS becomes null rather than
-- aborting the migration.
alter table public."EventDays"
  alter column "startTime" type time using (
    case when "startTime" ~ '^\s*\d{1,2}:\d{2}(:\d{2})?\s*$'
         then btrim("startTime")::time else null end
  ),
  alter column "endTime" type time using (
    case when "endTime" ~ '^\s*\d{1,2}:\d{2}(:\d{2})?\s*$'
         then btrim("endTime")::time else null end
  );

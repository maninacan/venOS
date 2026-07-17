-- Form Builder feature removed. Drop the now-unused FormTemplate table.
-- (Events keep their EventInfo.customFields column for any historical data.)
drop table if exists public."FormTemplate";

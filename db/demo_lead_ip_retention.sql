-- ---------------------------------------------------------------------
-- Stop keeping an IP address beside a named person indefinitely.
--
-- demo_leads is the one table deliberately outside every retention tier:
-- it survives the hourly purge and is kept until someone unsubscribes,
-- because it is the thing the demo exists to collect. Its own comment in
-- demo_schema.sql says "Aggregates only -- no document text, no chat
-- text" -- but it carried last_ip, which is neither an aggregate nor
-- covered by that reasoning.
--
-- The privacy policy scopes that tier to the email address and the
-- interaction counts. It does say the demo collects an IP, which remains
-- true: demo_sessions.ip records it for the two hours a session lives,
-- which is the window where it is actually useful for investigating
-- abuse. Keeping a second copy forever, attached to a name, bought
-- nothing and was the part of this a reviewer would ask about.
--
-- demo-verify-code no longer writes the column. This drops it.
-- Apply after demo_schema.sql. Safe to re-run.
-- ---------------------------------------------------------------------

set search_path = public, extensions;

alter table public.demo_leads drop column if exists last_ip;

do $verify$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'demo_leads'
      and column_name = 'last_ip'
  ) then
    raise exception 'demo_leads.last_ip still exists';
  end if;

  -- The session-scoped copy must survive: dropping that one would remove
  -- the only record available while abuse is actually happening.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'demo_sessions'
      and column_name = 'ip'
  ) then
    raise exception 'demo_sessions.ip is missing -- abuse investigation has no address at all';
  end if;

  raise notice 'demo_leads.last_ip dropped; demo_sessions.ip retained';
end
$verify$;

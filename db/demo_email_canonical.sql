-- ---------------------------------------------------------------------
-- Canonical email addresses, so the quota cannot be walked around.
--
-- Every cost control in the demo counts by email address, and citext only
-- makes that case-insensitive. you+1@gmail.com and you+2@gmail.com are
-- distinct rows, and Gmail delivers both to the same inbox -- as it does
-- y.o.u@gmail.com. One free mailbox therefore yielded unlimited sessions,
-- each worth a document extraction plus ten grounded answers, while passing
-- Turnstile and the emailed code legitimately every time.
--
-- The canonical form lives in the DATABASE, as a generated column, rather
-- than being computed in a workflow. A workflow can forget; a generated
-- column cannot. Nothing that writes these tables has to know this exists,
-- and no future route can bypass it by inserting a row directly.
--
-- Apply AFTER demo_schema.sql. Safe to re-run.
-- ---------------------------------------------------------------------

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- text in, text out: the function deliberately does not touch citext, so
-- it resolves no extension types and can be inlined into a generated
-- column expression without depending on a search_path at evaluation time.
-- It lowercases, so the result is already case-insensitive by construction
-- and the column below needs no collation of its own.
-- ---------------------------------------------------------------------
create or replace function public.demo_canonical_email(addr text)
returns text
language sql
immutable
strict
as $fn$
  with e as (
    select lower(btrim(addr)) as full
  ),
  p as (
    select full,
           split_part(full, '@', 1) as loc,
           split_part(full, '@', 2) as dom
    from e
  ),
  s as (
    select
      full,
      dom,
      -- Strip a "+tag" suffix. Plus-addressing is near universal (Gmail,
      -- Outlook, Fastmail, iCloud), and it is stripped for EVERY domain
      -- rather than a provider list: an address where "+" is genuinely
      -- significant is vanishingly rare, and the only consequence there is
      -- sharing a quota bucket with the base address. Delivery is never
      -- affected -- mail is always sent to the address as typed.
      case
        when regexp_replace(loc, '\+.*$', '') = '' then loc
        else regexp_replace(loc, '\+.*$', '')
      end as loc
    from p
  )
  select case
    -- Not an address at all. Return it unchanged rather than inventing a
    -- canonical form; the caller's own validation rejects it.
    when position('@' in full) = 0 or dom = '' or full = '' then full
    -- Dots are stripped ONLY for Google. Everywhere else a dot is a
    -- significant character and removing it would merge distinct people.
    when dom in ('gmail.com', 'googlemail.com') then
      case
        when replace(loc, '.', '') = '' then loc || '@gmail.com'
        else replace(loc, '.', '') || '@gmail.com'
      end
    else loc || '@' || dom
  end
  from s;
$fn$;

comment on function public.demo_canonical_email(text) is
  'Quota identity for an email address: lowercased, +tag stripped, and for '
  'Google domains dots removed and googlemail.com folded to gmail.com. '
  'Never used for delivery -- mail goes to the address as the visitor typed it.';

-- ---------------------------------------------------------------------
-- The columns the quota actually counts on.
--
-- GENERATED ALWAYS ... STORED: derived by Postgres on every insert and
-- update, so it cannot drift from `email` and cannot be supplied by a
-- caller. Adding it rewrites the table, which is free here -- demo_sessions
-- and demo_email_codes are both purged hourly.
-- ---------------------------------------------------------------------
alter table public.demo_sessions
  add column if not exists email_canonical text
  generated always as (public.demo_canonical_email(email::text)) stored;

alter table public.demo_email_codes
  add column if not exists email_canonical text
  generated always as (public.demo_canonical_email(email::text)) stored;

-- Suppressions too: someone who unsubscribed me@gmail.com has asked not to
-- be contacted, and me+demo@gmail.com is the same person's inbox. Honouring
-- only the exact string would keep mailing them.
alter table public.demo_suppressions
  add column if not exists email_canonical text
  generated always as (public.demo_canonical_email(email::text)) stored;

-- The quota queries filter on (canonical, created_at) and nothing else, so
-- these replace the equivalents on the raw address as the useful shape.
create index if not exists demo_sessions_canonical_created
  on public.demo_sessions (email_canonical, created_at);

create index if not exists demo_email_codes_canonical_created
  on public.demo_email_codes (email_canonical, created_at);

create index if not exists demo_suppressions_canonical
  on public.demo_suppressions (email_canonical);

-- ---------------------------------------------------------------------
-- Verification. Runs on apply and RAISES rather than reporting, so a
-- migration that silently produced the wrong identity cannot be mistaken
-- for a successful one.
-- ---------------------------------------------------------------------
do $verify$
declare
  failures text[] := '{}';
  procedure_result text;
begin
  -- The attack this file exists to close: all four must collapse to one
  -- identity, or the daily session quota is per-alias rather than per-inbox.
  if demo_canonical_email('you+1@gmail.com') is distinct from 'you@gmail.com'
     or demo_canonical_email('you+demo+extra@gmail.com') is distinct from 'you@gmail.com'
     or demo_canonical_email('y.o.u@gmail.com') is distinct from 'you@gmail.com'
     or demo_canonical_email('Y.O.U+tag@GoogleMail.com') is distinct from 'you@gmail.com'
  then
    failures := failures || 'gmail aliases do not collapse to one identity';
  end if;

  -- Dots must survive everywhere else: first.last@ and firstlast@ are two
  -- different people at almost every other provider.
  if demo_canonical_email('first.last@firma.ro') is distinct from 'first.last@firma.ro' then
    failures := failures || 'dots were stripped from a non-Google domain';
  end if;

  -- Plus-addressing is stripped for every domain.
  if demo_canonical_email('First.Last+demo@Firma.RO') is distinct from 'first.last@firma.ro' then
    failures := failures || '+tag not stripped, or case not folded, on a non-Google domain';
  end if;

  -- Distinct people must stay distinct. A canonicaliser that over-merges is
  -- worse than none: it would lock strangers out of each other's quota.
  if demo_canonical_email('ana@firma.ro') = demo_canonical_email('ion@firma.ro')
     or demo_canonical_email('you@gmail.com') = demo_canonical_email('you@outlook.com')
  then
    failures := failures || 'distinct addresses collapsed into one identity';
  end if;

  -- Degenerate input must not throw; the caller's validation rejects it.
  if demo_canonical_email('notanemail') is distinct from 'notanemail'
     or demo_canonical_email('  ') is distinct from ''
     or demo_canonical_email('+only@gmail.com') is distinct from '+only@gmail.com'
  then
    failures := failures || 'degenerate input was not passed through unchanged';
  end if;

  -- The generated columns must actually exist and be generated, not plain.
  select string_agg(table_name, ', ')
    into procedure_result
  from information_schema.columns
  where table_schema = 'public'
    and column_name = 'email_canonical'
    and is_generated = 'ALWAYS';

  if procedure_result is null or procedure_result !~ 'demo_sessions'
     or procedure_result !~ 'demo_email_codes'
     or procedure_result !~ 'demo_suppressions'
  then
    failures := failures ||
      ('email_canonical is missing or not GENERATED on one of the three tables (found: ' ||
       coalesce(procedure_result, 'none') || ')');
  end if;

  if array_length(failures, 1) > 0 then
    raise exception 'demo_canonical_email verification failed: %',
      array_to_string(failures, ' | ');
  end if;

  raise notice 'demo_canonical_email: all checks passed';
end
$verify$;

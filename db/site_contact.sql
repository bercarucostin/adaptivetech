-- ---------------------------------------------------------------------
-- Contact-form messages from adaptivetech.ro.
--
-- One row per submission. This is deliberately NOT demo_leads: that table
-- is one row per email address with the demo's interaction counters, and
-- a person who writes in twice is two messages, not one lead with a
-- counter. Free text lives here and nowhere else.
--
-- No IP, no user agent. Turnstile and the edge rate limit are the abuse
-- controls for this route; a name, an address and a message are enough
-- to keep beside each other without adding a network identifier.
--
-- handled_at is the whole inbox: null until someone has replied. The
-- open-messages index makes "what is still unanswered" a cheap query.
--
-- Written by the site-contact workflow, read by nobody but a person in
-- the Supabase dashboard. Purged after 24 months by demo-cleanup, which
-- is what the privacy policy says.
--
-- Apply after demo_schema.sql. Safe to re-run.
-- ---------------------------------------------------------------------

set search_path = public, extensions;

create table if not exists public.contact_messages (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(name) between 1 and 120),
  email       citext      not null check (char_length(email) <= 254),
  company     text                 check (company is null or char_length(company) <= 160),
  message     text        not null check (char_length(message) between 1 and 4000),
  lang        text        not null default 'ro' check (lang in ('ro', 'en')),
  page        text                 check (page is null or char_length(page) <= 300),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

create index if not exists contact_messages_created
  on public.contact_messages (created_at);
create index if not exists contact_messages_open
  on public.contact_messages (created_at) where handled_at is null;

-- Same posture as every demo table: RLS on with no policies, and the
-- default grants revoked. n8n connects as the service role, which
-- bypasses RLS; nothing reachable from a browser gets in.
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

do $verify$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'contact_messages' and rowsecurity
  ) then
    raise exception 'contact_messages exists without row level security';
  end if;
end
$verify$;

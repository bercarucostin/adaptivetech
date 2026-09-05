-- =====================================================================
-- Website RAG demo schema.
-- Target: a DEDICATED Supabase project. Client data must not be here.
-- Apply before db/demo_hybrid_search.sql.
-- =====================================================================

create extension if not exists vector;
create extension if not exists citext;
create extension if not exists pgcrypto;

set search_path = public;

-- ---------------------------------------------------------------------
-- Email verification codes. Only the salted hash is stored.
-- ---------------------------------------------------------------------
create table public.demo_email_codes (
  id          uuid primary key default gen_random_uuid(),
  email       citext      not null,
  code_hash   text        not null,
  expires_at  timestamptz not null,
  attempts    integer     not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- verify-code looks up the newest unconsumed code for one email.
create index demo_email_codes_lookup
  on public.demo_email_codes (email, created_at desc)
  where consumed_at is null;

-- request-code counts codes issued to one email in the last hour.
create index demo_email_codes_created
  on public.demo_email_codes (email, created_at);

-- ---------------------------------------------------------------------
-- Sessions. The two token columns are the real budget: a message count
-- is a proxy for what is billed, tokens are the thing itself.
-- ---------------------------------------------------------------------
create table public.demo_sessions (
  id             uuid primary key default gen_random_uuid(),
  email          citext      not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  files_uploaded integer     not null default 0,
  messages_used  integer     not null default 0,
  input_tokens   bigint      not null default 0,
  output_tokens  bigint      not null default 0,
  ip             inet
);

-- request-code counts a day's sessions per email.
create index demo_sessions_email_created
  on public.demo_sessions (email, created_at);

-- The hourly purge scans by expiry.
create index demo_sessions_expires
  on public.demo_sessions (expires_at);

-- ---------------------------------------------------------------------
-- Uploads. This row is what makes the upload asynchronous and what the
-- progress UI renders.
-- ---------------------------------------------------------------------
create table public.demo_uploads (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid        not null references public.demo_sessions(id) on delete cascade,
  filename    text        not null,
  status      text        not null default 'pending'
                check (status in ('pending','extracting','embedding','ready','failed')),
  error       text,
  chunk_count integer,
  page_count  integer,
  created_at  timestamptz not null default now()
);

create index demo_uploads_session on public.demo_uploads (session_id);

-- ---------------------------------------------------------------------
-- Chunk store. Mirrors public.documents on main, plus session scoping.
--
-- NO HNSW INDEX. This is deliberate, not an omission. HNSW post-filters,
-- so a maximally selective filter -- one session holds one document,
-- 150-400 chunks -- starves the candidate pool. An exact cosine scan over
-- a btree-filtered subset that size is faster AND exactly accurate.
-- Dropping the index removes the recall problem instead of tuning it.
-- ---------------------------------------------------------------------
create table public.demo_documents (
  id         bigserial primary key,
  session_id uuid        not null references public.demo_sessions(id) on delete cascade,
  content    text        not null,
  metadata   jsonb       not null default '{}'::jsonb,
  embedding  vector(1536) not null,
  fts        tsvector generated always as
               (to_tsvector('romanian'::regconfig, content)) stored,
  created_at timestamptz not null default now()
);

-- The scoping index. Every query filters on session_id first.
create index demo_documents_session on public.demo_documents (session_id);

-- Lexical branch of demo_hybrid_search.
create index demo_documents_fts_gin
  on public.demo_documents using gin (fts);

create index demo_documents_metadata_gin
  on public.demo_documents using gin (metadata jsonb_path_ops);

-- ---------------------------------------------------------------------
-- Chat. SET NULL, not CASCADE: these questions are product signal and
-- must survive the 2h session purge, detached from the session.
-- ---------------------------------------------------------------------
create table public.demo_messages (
  id         bigserial primary key,
  session_id uuid references public.demo_sessions(id) on delete set null,
  role       text        not null check (role in ('user','assistant')),
  content    text        not null,
  created_at timestamptz not null default now()
);

create index demo_messages_session on public.demo_messages (session_id, created_at);
create index demo_messages_created on public.demo_messages (created_at);

-- ---------------------------------------------------------------------
-- Leads. Aggregates only -- no document text, no chat text.
-- Deliberately outside every cascade: the purge must not delete the
-- thing the demo exists to collect.
-- ---------------------------------------------------------------------
create table public.demo_leads (
  email              citext primary key,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  sessions_count     integer     not null default 0,
  documents_uploaded integer     not null default 0,
  messages_sent      integer     not null default 0,
  consent_at         timestamptz,
  last_ip            inet
);

-- ---------------------------------------------------------------------
-- Unsubscribes. Suppresses MARKETING CONTACT, not demo access:
-- verify-code skips the demo_leads upsert for these addresses but still
-- issues the session. Someone who unsubscribes is saying "stop
-- contacting me", not "revoke my access".
-- ---------------------------------------------------------------------
create table public.demo_suppressions (
  email      citext primary key,
  created_at timestamptz not null default now()
);

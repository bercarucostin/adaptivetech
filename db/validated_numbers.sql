-- Dropped and rebuilt on 2026-08-14. The previous table keyed validation on a
-- manually maintained phone list; this one keys it on the technician's sigiliu.
drop table if exists public.validated_numbers;

create table public.validated_numbers (
  id              bigserial primary key,
  phone_e164      text not null unique,
  sigiliu         text,
  nr_crt          integer,
  technician_name text,
  service_unit    text,
  is_active       boolean not null default true,
  ai_whisperer    boolean not null default false,
  notes           text,
  validated_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index validated_numbers_sigiliu_idx on public.validated_numbers (sigiliu);

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

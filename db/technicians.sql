create table public.technicians (
  id              bigserial primary key,
  nr_crt          integer,
  technician_name text not null,
  service_unit    text,
  sigiliu_raw     text not null,
  sigiliu         text not null,
  synced_at       timestamptz not null default now()
);

create index technicians_sigiliu_idx on public.technicians (sigiliu);

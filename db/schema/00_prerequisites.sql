-- ---------------------------------------------------------------------
-- Phase 00 — extensions and custom types.
--
-- Four enum types and citext are referenced throughout the schema and were
-- DEFINED NOWHERE in the snapshot export. That is why the previous split
-- could not rebuild a database: the first table using one of them failed.
--
-- Safe to re-run. Creates nothing that already exists.
-- ---------------------------------------------------------------------

create extension if not exists citext;

-- ---------------------------------------------------------------------
-- THE ENUM LABELS BELOW ARE RECONSTRUCTED, NOT EXPORTED.
--
-- The snapshot carried no type definitions, so every label here was inferred
-- from evidence in the schema and the application:
--
--   membership_status   'active'              column DEFAULT
--   relationship_status 'pending'             column DEFAULT
--                       'active'              cast literal in the DDL
--   lab_visibility      'private'             column DEFAULT
--                       'public'              cast literal in the DDL
--   organization_type   'lab', 'clinic'       not present in the DDL at all;
--                                             taken from the lab_profile_org_is_lab
--                                             CHECK and from admin-users /
--                                             authorize-work-order-file
--
-- Two ways this can be wrong, both quiet:
--   * A production label that is not listed here -- a rebuilt database then
--     rejects rows production accepts, and it reads as a data bug.
--   * A different sort order -- enum comparisons and ORDER BY change meaning.
--
-- CONFIRM against the live project before trusting this file:
--
--   select t.typname,
--          string_agg(e.enumlabel, ', ' order by e.enumsortorder) as labels
--   from pg_type t
--   join pg_enum e on e.enumtypid = t.oid
--   where t.typname in ('membership_status', 'relationship_status',
--                       'lab_visibility', 'organization_type')
--   group by t.typname
--   order by 1;
--
-- Then replace the lists below with what it returns, and delete this notice.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('active');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'relationship_status') then
    create type public.relationship_status as enum ('pending', 'active');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lab_visibility') then
    create type public.lab_visibility as enum ('private', 'public');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_type') then
    create type public.organization_type as enum ('lab', 'clinic');
  end if;
end $$;

-- Run after db/schema/apply.sql against a disposable Supabase database.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql
begin;

-- Structure ----------------------------------------------------------------
do $$
declare
    v_missing text;
begin
    select string_agg(required.column_name, ', ' order by required.column_name)
      into v_missing
    from (values
        ('id'), ('lab_organization_id'), ('document'), ('is_current'),
        ('note'), ('created_by'), ('created_at')
    ) required(column_name)
    where not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'public_price_lists'
          and c.column_name = required.column_name
    );
    if v_missing is not null then
        raise exception 'Missing public_price_lists columns: %', v_missing;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_class
        where oid = 'public.public_price_lists'::regclass and relrowsecurity
    ) then
        raise exception 'Row level security is not enabled on public_price_lists';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'public_price_lists_one_current'
          and indexdef ilike '%where is_current%'
    ) then
        raise exception 'A lab must be able to have only one current price list';
    end if;
end $$;

-- Only one current list per lab, enforced by the database ------------------
do $$
declare
    v_lab uuid;
begin
    insert into public.organizations (name, slug, organization_type, active)
    values ('Test Lab', 'test-lab-public-prices', 'lab', true)
    returning id into v_lab;

    insert into public.public_price_lists (lab_organization_id, document, is_current)
    values (v_lab, '{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]}]}'::jsonb, true);

    begin
        insert into public.public_price_lists (lab_organization_id, document, is_current)
        values (v_lab, '{"schema":1,"currency":"lei","groups":[{"title":"H","rows":[]}]}'::jsonb, true);
        raise exception 'A second current price list was accepted for the same lab';
    exception when unique_violation then
        null;
    end;
end $$;

-- Nobody writes from the browser ------------------------------------------
do $$
declare
    v_role text;
    v_privilege text;
begin
    foreach v_role in array array['anon', 'authenticated'] loop
        foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
            if has_table_privilege(v_role, 'public.public_price_lists', v_privilege) then
                raise exception '% must not hold % on public_price_lists', v_role, v_privilege;
            end if;
        end loop;
        if not has_table_privilege(v_role, 'public.public_price_lists', 'SELECT') then
            raise exception '% must be able to read the current price list', v_role;
        end if;
    end loop;
end $$;

-- An anonymous visitor sees the current list and nothing else -------------
-- The role switch is a statement, not something inside a DO block: SET LOCAL ROLE
-- inside plpgsql does not reliably survive the block, and a test that silently
-- runs as the owner would pass while proving nothing.
insert into public.organizations (id, name, slug, organization_type, active)
values ('00000000-0000-4000-8000-0000000a1101', 'Anon Lab', 'anon-lab-public-prices', 'lab', true);

insert into public.public_price_lists (lab_organization_id, document, is_current)
values
  ('00000000-0000-4000-8000-0000000a1101', '{"schema":1,"currency":"lei","groups":[{"title":"Current","rows":[]}]}'::jsonb, true),
  ('00000000-0000-4000-8000-0000000a1101', '{"schema":1,"currency":"lei","groups":[{"title":"Older","rows":[]}]}'::jsonb, false);

set local role anon;

do $$
declare
    v_visible int;
begin
    select count(*)
      into v_visible
      from public.public_price_lists
     where lab_organization_id = '00000000-0000-4000-8000-0000000a1101';

    if v_visible <> 1 then
        raise exception 'An anonymous visitor saw % price lists, expected exactly the current one', v_visible;
    end if;
end $$;

reset role;

rollback;

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

-- Exactly one policy, and it is read-only. Tasks 3 and 4 append to this same
-- file; this guards the rule while they do, so a future write policy can't
-- slip in unnoticed alongside the grants revoke.
do $$
declare
    v_policy_count int;
begin
    select count(*)
      into v_policy_count
      from pg_policies
     where schemaname = 'public'
       and tablename = 'public_price_lists';

    if v_policy_count <> 1 then
        raise exception 'Expected exactly one policy on public_price_lists, found %', v_policy_count;
    end if;

    if exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'public_price_lists'
          and cmd <> 'SELECT'
    ) then
        raise exception 'public_price_lists must not carry any write policy';
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

-- Document validation ------------------------------------------------------
do $$
declare
    v_case record;
begin
    for v_case in
        select * from (values
            ('{"schema":1,"currency":"lei","intro_note":"","footnote":"","groups":[{"title":"G","rows":[{"item":"X","amount":200}]}]}', true,  'a minimal valid document'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]}]}',                                      true,  'a group with no rows'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":199.5,"variant":"IVOCLAR","footnote":true,"currency":"EUR"}]}]}', true, 'every optional field'),
            ('{"schema":2,"currency":"lei","groups":[{"title":"G","rows":[]}]}',                                      false, 'an unknown schema version'),
            ('{"currency":"lei","groups":[{"title":"G","rows":[]}]}',                                                 false, 'a missing schema version'),
            ('{"schema":1,"currency":"lei","groups":[]}',                                                             false, 'no groups'),
            ('{"schema":1,"currency":"lei"}',                                                                         false, 'a missing groups key'),
            ('{"schema":1,"currency":"","groups":[{"title":"G","rows":[]}]}',                                          false, 'an empty currency'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"","rows":[]}]}',                                        false, 'an empty group title'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]},{"title":"G","rows":[]}]}',               false, 'duplicate group titles'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"","amount":1}]}]}',                 false, 'an empty item name'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":-1}]}]}',               false, 'a negative amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1.005}]}]}',            false, 'more than two decimals'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":"200"}]}]}',            false, 'an amount written as text'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X"}]}]}',                           false, 'a row with no amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1000001}]}]}',          false, 'an implausible amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":{"item":"X"}}]}',                             false, 'rows that are not an array'),
            ('[]',                                                                                                     false, 'an array instead of an object'),
            ('null',                                                                                                   false, 'a null document')
        ) as t(document, expected, description)
    loop
        if public.public_price_document_is_valid(v_case.document::jsonb) <> v_case.expected then
            raise exception 'Validator verdict wrong for %: expected %', v_case.description, v_case.expected;
        end if;
    end loop;
end $$;

do $$
declare
    v_long_item jsonb := jsonb_build_object(
        'schema', 1, 'currency', 'lei',
        'groups', jsonb_build_array(jsonb_build_object('title', 'G',
            'rows', jsonb_build_array(jsonb_build_object('item', repeat('x', 201), 'amount', 1)))));
    v_many_rows jsonb;
begin
    if public.public_price_document_is_valid(v_long_item) then
        raise exception 'An item name of 201 characters was accepted';
    end if;

    select jsonb_build_object('schema', 1, 'currency', 'lei',
             'groups', jsonb_build_array(jsonb_build_object('title', 'G', 'rows', jsonb_agg(
                 jsonb_build_object('item', 'Row ' || g, 'amount', 1)))))
      into v_many_rows
      from generate_series(1, 201) as g;

    if public.public_price_document_is_valid(v_many_rows) then
        raise exception 'A document with 201 rows was accepted';
    end if;
end $$;

-- The table refuses an invalid document even from a privileged writer -------
do $$
declare
    v_lab uuid;
begin
    insert into public.organizations (name, slug, organization_type, active)
    values ('Check Lab', 'check-lab-public-prices', 'lab', true)
    returning id into v_lab;

    begin
        insert into public.public_price_lists (lab_organization_id, document, is_current)
        values (v_lab, '{"schema":1,"currency":"lei","groups":[]}'::jsonb, false);
        raise exception 'An invalid document was stored';
    exception when check_violation then
        null;
    end;
end $$;

rollback;

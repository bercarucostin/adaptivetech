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
        -- anon deliberately no longer holds whole-table SELECT: 40_grants.sql
        -- narrows it to named columns so the internal `note` stays private, and
        -- has_table_privilege reports whole-table grants only. The column-level
        -- shape is asserted in its own block further down.
        if v_role = 'anon' then
            if not has_column_privilege(v_role, 'public.public_price_lists', 'document', 'SELECT') then
                raise exception 'anon must be able to read the published document';
            end if;
        elsif not has_table_privilege(v_role, 'public.public_price_lists', 'SELECT') then
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
            ('{"schema":1,"currency":"lei","groups":[{"title":"G"}]}',                                                 false, 'a group with no rows key'),
            ('{"schema":"1","currency":"lei","groups":[{"title":"G","rows":[]}]}',                                     false, 'a schema written as text'),
            ('{"schema":1,"currency":5,"groups":[{"title":"G","rows":[]}]}',                                           false, 'a currency that is a number'),
            ('{"schema":1,"currency":"lei","groups":[{"title":{"a":1},"rows":[]}]}',                                   false, 'a title that is an object'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":[1,2],"amount":1}]}]}',              false, 'an item that is an array'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1,"variant":null}]}]}', false, 'a variant that is explicitly null'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1.500}]}]}',            true,  'trailing zeros in a two-decimal amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1,"footnote":null}]}]}', true, 'a row footnote written as null'),
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
    v_many_rows_two_groups jsonb;
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

    -- The 200-row cap is document-wide, not per group: two groups of 101 rows
    -- each (202 total) must be rejected just like 201 rows in one group.
    select jsonb_build_object('schema', 1, 'currency', 'lei', 'groups', jsonb_build_array(
             jsonb_build_object('title', 'G1', 'rows', (
               select jsonb_agg(jsonb_build_object('item', 'Row ' || g, 'amount', 1))
                 from generate_series(1, 101) as g)),
             jsonb_build_object('title', 'G2', 'rows', (
               select jsonb_agg(jsonb_build_object('item', 'Row ' || g, 'amount', 1))
                 from generate_series(1, 101) as g))))
      into v_many_rows_two_groups;

    if public.public_price_document_is_valid(v_many_rows_two_groups) then
        raise exception 'A document with 101+101 rows across two groups was accepted';
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

-- Publishing contract ------------------------------------------------------
do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.publish_public_price_list(jsonb,text,uuid)'::regprocedure)
      into v_definition;

    if v_definition not ilike '%security definer%' then
        raise exception 'publish_public_price_list must be SECURITY DEFINER';
    end if;
    if v_definition not ilike '%is_lab_management%' then
        raise exception 'publish_public_price_list must gate on is_lab_management';
    end if;
    if v_definition not ilike '%public_price_document_is_valid%' then
        raise exception 'publish_public_price_list must validate the document';
    end if;
    if v_definition not ilike '%p_expected_current%' then
        raise exception 'publish_public_price_list must refuse a stale expected version';
    end if;
    if v_definition not ilike '%coalesce(v_current::text%' then
        raise exception 'publish_public_price_list must compare the current version with a null-safe comparison';
    end if;
    if v_definition not ilike '%for update%' then
        raise exception 'publish_public_price_list must lock the current row so two publishes serialize';
    end if;
    if v_definition not ilike '%pg_advisory_xact_lock%' then
        raise exception 'publish_public_price_list must serialize publishes per lab with an advisory lock';
    end if;
    if v_definition not ilike '%auth.uid()%' then
        raise exception 'publish_public_price_list must record who published';
    end if;

    select pg_get_functiondef('public.set_current_public_price_list(uuid)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%security definer%' then
        raise exception 'set_current_public_price_list must be SECURITY DEFINER';
    end if;
    if v_definition not ilike '%is_lab_management%' then
        raise exception 'set_current_public_price_list must gate on is_lab_management';
    end if;
    if v_definition not ilike '%pg_advisory_xact_lock%' then
        raise exception 'set_current_public_price_list must serialize restores per lab with an advisory lock';
    end if;
    if v_definition ilike '%insert into%' then
        raise exception 'set_current_public_price_list must restore in place, never copy the version';
    end if;

    select pg_get_functiondef('public.may_edit_public_prices()'::regprocedure)
      into v_definition;
    if v_definition not ilike '%is_lab_management%'
       or v_definition not ilike '%get_flowrise_lab_id%' then
        raise exception 'may_edit_public_prices must wrap is_lab_management(get_flowrise_lab_id())';
    end if;
end $$;

-- An unauthenticated caller cannot publish or restore ---------------------
-- Role switches are statements: inside a DO block the switch does not reliably
-- hold, and a test that quietly runs as the owner passes while proving nothing.
set local role anon;

do $$
begin
    begin
        perform public.publish_public_price_list(
            '{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]}]}'::jsonb, null, null);
        raise exception 'An anonymous caller published a price list';
    exception when insufficient_privilege then
        null;
    end;

    begin
        -- The uuid is the Anon Lab organization id seeded above, not a real
        -- version id -- deliberately arbitrary, since the call must die at the
        -- privilege check before the argument is ever interpreted as a version.
        perform public.set_current_public_price_list('00000000-0000-4000-8000-0000000a1101'::uuid);
        raise exception 'An anonymous caller restored a price list';
    exception when insufficient_privilege then
        null;
    end;
end $$;

reset role;

-- A signed-in user who is not lab management gets false, not an error ------
set local role authenticated;

do $$
declare
    v_can boolean;
begin
    select public.may_edit_public_prices() into v_can;
    if v_can then
        raise exception 'may_edit_public_prices answered true with no identity';
    end if;
end $$;

reset role;

-- The gate that actually matters: real calls, as real identities ------------
--
-- Everything above this point either runs as the table owner or checks the text
-- of a function definition. Neither touches the one thing that stands between a
-- signed-in technician and the public price list: `authenticated` holds EXECUTE
-- on publish_public_price_list, so the only barrier is the is_lab_management
-- check *inside* the function. A grep of pg_get_functiondef asserts that the
-- check is written, not that it works -- and on a branch where no SQL has ever
-- run, source text proves nothing.
--
-- The recipe is the one tests/sql/per_tooth_work_orders.sql already uses:
-- fixture users in auth.users and profiles, memberships for their roles, the
-- real lab's slug neutralised so get_flowrise_lab_id() resolves to the fixture
-- lab, and identity switched with set_config('request.jwt.claim.sub', ...),
-- which auth.uid() reads and which -- unlike `set local role` -- does hold
-- inside a DO block. All of it rolls back.
do $$
declare
    v_lab uuid := gen_random_uuid();
    v_manager uuid := gen_random_uuid();
    v_second uuid := gen_random_uuid();
    v_tech uuid := gen_random_uuid();
    v_doc1 jsonb := '{"schema":1,"currency":"lei","groups":[{"title":"Prima","rows":[{"item":"Coroana","amount":200}]}]}';
    v_doc2 jsonb := '{"schema":1,"currency":"lei","groups":[{"title":"A doua","rows":[{"item":"Coroana","amount":32.05}]}]}';
    v_v1 uuid;
    v_v2 uuid;
    v_orphan uuid;
    v_stored jsonb;
    v_count int;
    v_before int;
    v_after int;
    v_current uuid;
    v_first uuid;
    v_name text;
    v_flag boolean;
    v_failed boolean;
begin
    insert into auth.users (id) values (v_manager), (v_second), (v_tech);

    -- v_second has no display_name on purpose: published_by must fall back to
    -- the username rather than rendering a nameless version.
    insert into public.profiles (id, display_name, username, legacy_user_id)
    values (v_manager, 'Manager Preturi',    'manager_prices', v_manager::text),
           (v_second,  null,                 'al_doilea',      v_second::text),
           (v_tech,    'Tehnician Preturi',  'tehnician_pr',   v_tech::text);

    -- Isolate get_flowrise_lab_id() inside this rollback-only fixture, exactly as
    -- per_tooth_work_orders.sql does, so the fixture lab is the one the RPCs see.
    update public.organizations set slug = null where slug = 'flowrise-dental-lab';
    insert into public.organizations (id, organization_type, name, slug)
    values (v_lab, 'lab', 'Public price integration', 'flowrise-dental-lab');

    insert into public.organization_memberships (organization_id, user_id, role)
    values (v_lab, v_manager, 'Manager'), (v_lab, v_second, 'Manager'), (v_lab, v_tech, 'Technician');

    if public.get_flowrise_lab_id() <> v_lab then
        raise exception 'Fixture lab is not the one get_flowrise_lab_id() resolves';
    end if;

    -- 1. A signed-in technician is refused by the function itself -----------
    perform set_config('request.jwt.claim.sub', v_tech::text, true);

    if public.may_edit_public_prices() then
        raise exception 'may_edit_public_prices answered true for a technician';
    end if;

    v_failed := false;
    begin
        perform public.publish_public_price_list(v_doc1, 'de la tehnician', null::uuid);
    exception when others then
        v_failed := true;
        if sqlerrm not like '%Doar administratorii sau managerii pot publica%' then
            raise exception 'Technician publish failed for the wrong reason: %', sqlerrm;
        end if;
    end;
    if not v_failed then
        raise exception 'A technician published the public price list';
    end if;

    v_failed := false;
    begin
        perform * from public.get_public_price_list_history();
    exception when others then
        v_failed := true;
        if sqlerrm not like '%Doar administratorii sau managerii pot vedea istoricul%' then
            raise exception 'Technician history read failed for the wrong reason: %', sqlerrm;
        end if;
    end;
    if not v_failed then
        raise exception 'A technician read the public price list history';
    end if;

    -- 2. A manager publishes, and the result is exactly one current version --
    perform set_config('request.jwt.claim.sub', v_manager::text, true);

    if not public.may_edit_public_prices() then
        raise exception 'may_edit_public_prices answered false for a manager';
    end if;

    v_v1 := public.publish_public_price_list(v_doc1, 'prima versiune', null::uuid);

    select count(*) into v_count
      from public.public_price_lists
     where lab_organization_id = v_lab and is_current;
    if v_count <> 1 then
        raise exception 'After a publish % versions are current, expected exactly 1', v_count;
    end if;

    select id, document into v_current, v_stored
      from public.public_price_lists
     where lab_organization_id = v_lab and is_current;
    if v_current <> v_v1 then
        raise exception 'The current version is not the one the publish returned';
    end if;
    if v_stored <> v_doc1 then
        raise exception 'The current version does not hold the document that was published';
    end if;

    -- 3. Republishing with the FIRST call's expectation is refused as stale --
    --    That first call passed null, which was correct then and is stale now.
    v_failed := false;
    begin
        perform public.publish_public_price_list(v_doc2, 'a doua, cu asteptare veche', null::uuid);
    exception when others then
        v_failed := true;
        -- Matched on a diacritic-free prefix of 'Lista a fost modificată ...'.
        if sqlerrm not like '%Lista a fost modificat%' then
            raise exception 'A stale publish failed for the wrong reason: %', sqlerrm;
        end if;
    end;
    if not v_failed then
        raise exception 'A publish with a stale p_expected_current overwrote the current version';
    end if;

    -- 4. The second manager publishes on top, with the right expectation -----
    perform set_config('request.jwt.claim.sub', v_second::text, true);
    v_v2 := public.publish_public_price_list(v_doc2, 'a doua versiune', v_v1);

    select count(*) into v_count
      from public.public_price_lists
     where lab_organization_id = v_lab and is_current;
    if v_count <> 1 then
        raise exception 'After the second publish % versions are current, expected 1', v_count;
    end if;

    -- 5. The history names the OTHER account ---------------------------------
    --    This is what the profiles policy made impossible from the browser: the
    --    only policy on profiles is `id = auth.uid()`, so a PostgREST embed gave
    --    the viewer a name for their own publishes and null for everyone else's.
    perform set_config('request.jwt.claim.sub', v_manager::text, true);

    select count(*) into v_count from public.get_public_price_list_history();
    if v_count <> 2 then
        raise exception 'The history returned % versions, expected 2', v_count;
    end if;

    select h.id into v_first from public.get_public_price_list_history() h limit 1;
    if v_first <> v_v2 then
        raise exception 'The history is not newest first';
    end if;

    select h.published_by into v_name from public.get_public_price_list_history() h where h.id = v_v2;
    if v_name is distinct from 'al_doilea' then
        raise exception 'A version published by somebody else is attributed to %, expected the username fallback al_doilea', coalesce(v_name, '<null>');
    end if;

    select h.published_by into v_name from public.get_public_price_list_history() h where h.id = v_v1;
    if v_name is distinct from 'Manager Preturi' then
        raise exception 'The caller''s own version is attributed to %, expected Manager Preturi', coalesce(v_name, '<null>');
    end if;

    select h.note, h.is_current into v_name, v_flag
      from public.get_public_price_list_history() h where h.id = v_v2;
    if v_name is distinct from 'a doua versiune' or not v_flag then
        raise exception 'The history lost the note or the current flag of the newest version';
    end if;

    -- A version with no publisher recorded reports no name, rather than failing
    -- the join or inventing one. created_by is nullable and ON DELETE SET NULL,
    -- so a departed employee's versions land here.
    insert into public.public_price_lists (lab_organization_id, document, is_current, note, created_by)
    values (v_lab, v_doc1, false, 'fara autor', null)
    returning id into v_orphan;

    select h.published_by into v_name from public.get_public_price_list_history() h where h.id = v_orphan;
    if v_name is not null then
        raise exception 'A version with no created_by was attributed to %', v_name;
    end if;

    -- 6. Restore moves is_current and writes no new row ----------------------
    select count(*) into v_before from public.public_price_lists where lab_organization_id = v_lab;

    perform public.set_current_public_price_list(v_v1);

    select count(*) into v_after from public.public_price_lists where lab_organization_id = v_lab;
    if v_after <> v_before then
        raise exception 'Restoring changed the row count from % to %; it must only move is_current', v_before, v_after;
    end if;

    select count(*) into v_count
      from public.public_price_lists
     where lab_organization_id = v_lab and is_current;
    if v_count <> 1 then
        raise exception 'After a restore % versions are current, expected 1', v_count;
    end if;

    select id into v_current
      from public.public_price_lists
     where lab_organization_id = v_lab and is_current;
    if v_current <> v_v1 then
        raise exception 'A restore did not move is_current back to the earlier version';
    end if;

    -- 7. And a technician cannot undo any of it ------------------------------
    perform set_config('request.jwt.claim.sub', v_tech::text, true);

    v_failed := false;
    begin
        perform public.set_current_public_price_list(v_v2);
    exception when others then
        v_failed := true;
        if sqlerrm not like '%Doar administratorii sau managerii pot modifica%' then
            raise exception 'Technician restore failed for the wrong reason: %', sqlerrm;
        end if;
    end;
    if not v_failed then
        raise exception 'A technician restored an earlier public price list';
    end if;

    select id into v_current
      from public.public_price_lists
     where lab_organization_id = v_lab and is_current;
    if v_current <> v_v1 then
        raise exception 'The refused restore still moved is_current';
    end if;

    perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- anon reads the published list, not management's notes about it ------------
-- The row policy limits anon to the current version; that says nothing about
-- which COLUMNS of it come back. `note` is the internal "what changed" log and
-- created_by identifies staff, so both are withheld by column grant, which
-- PostgREST honours. The landing page asks only for select=id,document.
do $$
declare
    v_column text;
begin
    foreach v_column in array array['id', 'lab_organization_id', 'document', 'is_current', 'created_at'] loop
        if not has_column_privilege('anon', 'public.public_price_lists', v_column, 'SELECT') then
            raise exception 'anon must be able to read %, which the landing page renders', v_column;
        end if;
    end loop;

    foreach v_column in array array['note', 'created_by'] loop
        if has_column_privilege('anon', 'public.public_price_lists', v_column, 'SELECT') then
            raise exception 'anon must not be able to read %', v_column;
        end if;
    end loop;

    -- Whole-table SELECT would defeat the column grants, so it must be gone.
    if has_table_privilege('anon', 'public.public_price_lists', 'SELECT') then
        raise exception 'anon still holds whole-table SELECT, which covers every column';
    end if;

    -- authenticated keeps the whole row: the row policy already hides
    -- non-current versions from anyone who is not lab management.
    if not has_table_privilege('authenticated', 'public.public_price_lists', 'SELECT') then
        raise exception 'authenticated must keep whole-row SELECT';
    end if;
end $$;

-- The history RPC is a signed-in call ---------------------------------------
do $$
begin
    if has_function_privilege('anon', 'public.get_public_price_list_history()', 'EXECUTE') then
        raise exception 'anon must not be able to execute get_public_price_list_history';
    end if;
    if not has_function_privilege('authenticated', 'public.get_public_price_list_history()', 'EXECUTE') then
        raise exception 'authenticated must be able to execute get_public_price_list_history';
    end if;
    if has_function_privilege('anon', 'public.public_price_document_is_valid(jsonb)', 'EXECUTE') then
        raise exception 'anon must not be able to execute public_price_document_is_valid';
    end if;
end $$;

rollback;

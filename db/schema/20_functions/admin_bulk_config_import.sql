-- Flowrise Supabase function: public.admin_bulk_config_import(p_kind text, p_mode text, p_rows jsonb)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.admin_bulk_config_import(p_kind text, p_mode text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_kind text := lower(trim(coalesce(p_kind,'')));
    v_mode text := upper(trim(coalesce(p_mode,'')));
    v_count integer := 0;
    v_row jsonb;
    v_id_text text;
    v_id_big bigint;
    v_source_row integer;
    v_contract text;
    v_work_type text;
    v_technician text;
    v_stage text;
    v_price numeric;
    v_cost numeric;
    v_active boolean;
    v_billing_mode text;
    v_next_work_type bigint;
    v_next_cost_row integer;
begin
    if not public.is_lab_management(v_lab)
       or lower(coalesce(public.current_org_role(v_lab),'')) <> 'admin' then
        raise exception 'Admin access required';
    end if;

    if v_kind not in ('prices','types','costs') then
        raise exception 'Invalid import section';
    end if;

    if v_mode not in ('MERGE','REPLACE') then
        raise exception 'Invalid import mode';
    end if;

    if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'CSV contains no rows';
    end if;

    if jsonb_array_length(p_rows) > 10000 then
        raise exception 'Maximum 10000 rows per import';
    end if;

    if v_kind = 'prices' then
        -- Validate the entire payload BEFORE a REPLACE delete.
        for v_row in select * from jsonb_array_elements(p_rows)
        loop
            v_contract := trim(coalesce(v_row->>'contract',''));
            v_work_type := trim(coalesce(v_row->>'tip_lucrare',''));

            begin
                v_price := nullif(trim(coalesce(v_row->>'pret','')),'')::numeric;
            exception when others then
                raise exception 'Invalid Pret value: %', coalesce(v_row->>'pret','');
            end;

            if v_contract = '' or v_work_type = '' or v_price is null or v_price < 0 then
                raise exception 'Each price row requires Contract, Tip_Lucrare and a non-negative Pret';
            end if;
        end loop;

        if v_mode = 'REPLACE' then
            delete from public.lab_contract_work_prices
            where lab_organization_id = v_lab;
        end if;

        for v_row in select * from jsonb_array_elements(p_rows)
        loop
            v_id_text := nullif(trim(coalesce(v_row->>'id','')),'');
            if v_id_text is null then
                v_id_text := 'price_' || gen_random_uuid()::text;
            end if;

            insert into public.lab_contract_work_prices (
                lab_organization_id,
                id,
                contract,
                tip_lucrare,
                pret,
                updated_at
            )
            values (
                v_lab,
                v_id_text,
                trim(v_row->>'contract'),
                trim(v_row->>'tip_lucrare'),
                (v_row->>'pret')::numeric,
                now()
            )
            on conflict (lab_organization_id,id)
            do update set
                contract = excluded.contract,
                tip_lucrare = excluded.tip_lucrare,
                pret = excluded.pret,
                updated_at = now();

            v_count := v_count + 1;
        end loop;

    elsif v_kind = 'types' then
        select coalesce(max(id),0) + 1
          into v_next_work_type
        from public.lab_work_types
        where lab_organization_id = v_lab;

        -- Validate first.
        for v_row in select * from jsonb_array_elements(p_rows)
        loop
            v_work_type := trim(coalesce(v_row->>'tip_lucrare',''));
            v_billing_mode := coalesce(nullif(lower(trim(v_row->>'billing_mode')),''),'per_tooth');
            if v_work_type = '' then
                raise exception 'Each work type row requires Tip_Lucrare';
            end if;
            if v_billing_mode not in ('per_tooth','per_arch','per_piece') then
                raise exception 'Invalid Billing_Mode: %', coalesce(v_row->>'billing_mode','');
            end if;

            if nullif(trim(coalesce(v_row->>'id','')),'') is not null then
                begin
                    perform (v_row->>'id')::bigint;
                exception when others then
                    raise exception 'Invalid work type ID: %', v_row->>'id';
                end;
            end if;
        end loop;

        if v_mode = 'REPLACE' then
            delete from public.lab_work_types
            where lab_organization_id = v_lab;

            -- Start generated IDs after the largest explicitly supplied ID.
            select greatest(
                coalesce(max((x->>'id')::bigint) filter (
                    where nullif(trim(coalesce(x->>'id','')),'') is not null
                ),0),
                0
            ) + 1
            into v_next_work_type
            from jsonb_array_elements(p_rows) x;
        end if;

        for v_row in select * from jsonb_array_elements(p_rows)
        loop
            v_billing_mode := coalesce(nullif(lower(trim(v_row->>'billing_mode')),''),'per_tooth');
            if nullif(trim(coalesce(v_row->>'id','')),'') is null then
                v_id_big := v_next_work_type;
                v_next_work_type := v_next_work_type + 1;
            else
                v_id_big := (v_row->>'id')::bigint;
            end if;

            v_active := case
                when lower(trim(coalesce(v_row->>'active','true')))
                     in ('false','0','no','inactive','nu') then false
                else true
            end;

            insert into public.lab_work_types (
                lab_organization_id,
                id,
                tip_lucrare,
                active,
                billing_mode,
                updated_at
            )
            values (
                v_lab,
                v_id_big,
                trim(v_row->>'tip_lucrare'),
                v_active,
                v_billing_mode,
                now()
            )
            on conflict (lab_organization_id,id)
            do update set
                tip_lucrare = excluded.tip_lucrare,
                active = excluded.active,
                billing_mode = excluded.billing_mode,
                updated_at = now();

            v_count := v_count + 1;
        end loop;

    else
        select coalesce(max(source_row_no),0) + 1
          into v_next_cost_row
        from public.lab_technician_costs
        where lab_organization_id = v_lab;

        -- Validate first.
        for v_row in select * from jsonb_array_elements(p_rows)
        loop
            v_technician := trim(coalesce(v_row->>'tehnician',''));
            v_work_type := trim(coalesce(v_row->>'tip_lucrare',''));
            v_stage := trim(coalesce(v_row->>'etapa',''));

            if v_technician = '' or v_work_type = '' or v_stage = '' then
                raise exception 'Each technician cost row requires Tehnician, Tip_Lucrare and Etapa';
            end if;

            if nullif(trim(coalesce(v_row->>'source_row_no','')),'') is not null then
                begin
                    perform (v_row->>'source_row_no')::integer;
                exception when others then
                    raise exception 'Invalid Source_Row_No: %', v_row->>'source_row_no';
                end;
            end if;

            if nullif(trim(coalesce(v_row->>'cost','')),'') is not null then
                begin
                    v_cost := (v_row->>'cost')::numeric;
                exception when others then
                    raise exception 'Invalid Cost: %', v_row->>'cost';
                end;
                if v_cost < 0 then
                    raise exception 'Cost cannot be negative';
                end if;
            end if;
        end loop;

        if v_mode = 'REPLACE' then
            delete from public.lab_technician_costs
            where lab_organization_id = v_lab;

            select greatest(
                coalesce(max((x->>'source_row_no')::integer) filter (
                    where nullif(trim(coalesce(x->>'source_row_no','')),'') is not null
                ),0),
                0
            ) + 1
            into v_next_cost_row
            from jsonb_array_elements(p_rows) x;
        end if;

        for v_row in select * from jsonb_array_elements(p_rows)
        loop
            if nullif(trim(coalesce(v_row->>'source_row_no','')),'') is null then
                v_source_row := v_next_cost_row;
                v_next_cost_row := v_next_cost_row + 1;
            else
                v_source_row := (v_row->>'source_row_no')::integer;
            end if;

            v_id_text := nullif(trim(coalesce(v_row->>'legacy_id','')),'');
            if v_id_text is null then
                v_id_text := 'cost_' || gen_random_uuid()::text;
            end if;

            if nullif(trim(coalesce(v_row->>'cost','')),'') is null then
                v_cost := null;
            else
                v_cost := (v_row->>'cost')::numeric;
            end if;

            insert into public.lab_technician_costs (
                lab_organization_id,
                source_row_no,
                legacy_id,
                tehnician,
                tip_lucrare,
                etapa,
                cost,
                updated_at
            )
            values (
                v_lab,
                v_source_row,
                v_id_text,
                trim(v_row->>'tehnician'),
                trim(v_row->>'tip_lucrare'),
                trim(v_row->>'etapa'),
                v_cost,
                now()
            )
            on conflict (lab_organization_id,source_row_no)
            do update set
                legacy_id = excluded.legacy_id,
                tehnician = excluded.tehnician,
                tip_lucrare = excluded.tip_lucrare,
                etapa = excluded.etapa,
                cost = excluded.cost,
                updated_at = now();

            v_count := v_count + 1;
        end loop;
    end if;

    return jsonb_build_object(
        'ok', true,
        'kind', v_kind,
        'mode', v_mode,
        'imported_rows', v_count
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_kind text, p_mode text, p_rows jsonb

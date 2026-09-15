-- Run after db/schema/apply.sql against a disposable Supabase database.
-- Canonical unit scenarios are transaction-local and require no fixture rows.
begin;

do $$
declare
    v_units jsonb;
begin
    select jsonb_agg(to_jsonb(u) order by u.billing_scope)
      into v_units
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"crown"},{"tooth_number":31,"work_type":"CROWN"}]'::jsonb,
        '[{"work_type":"Crown","billing_mode":"per_tooth"}]'::jsonb
    ) u;
    if jsonb_array_length(v_units) <> 3
       or (select array_agg(x->>'billing_scope' order by x->>'billing_scope')
           from jsonb_array_elements(v_units) x) <> array['tooth:11','tooth:12','tooth:31'] then
        raise exception 'per_tooth must return one stable unit for each configured tooth: %', v_units;
    end if;
end $$;

do $$
declare
    v_upper integer;
    v_both integer;
begin
    select count(*) into v_upper
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":28,"work_type":"bridge"}]'::jsonb,
        '[{"work_type":"BRIDGE","billing_mode":"per_arch"}]'::jsonb
    );
    select count(*) into v_both
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":28,"work_type":"bridge"},{"tooth_number":31,"work_type":"BRIDGE"}]'::jsonb,
        '[{"work_type":"Bridge","billing_mode":"per_arch"}]'::jsonb
    );
    if v_upper <> 1 or v_both <> 2 then
        raise exception 'per_arch must return one unit per involved arch: upper %, both %', v_upper, v_both;
    end if;
end $$;

do $$
declare
    v_piece integer;
begin
    select count(*) into v_piece
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Denture"},{"tooth_number":41,"work_type":"denture"}]'::jsonb,
        '[{"work_type":"DENTURE","billing_mode":"per_piece"}]'::jsonb
    );
    if v_piece <> 1 then
        raise exception 'per_piece must return one unit across both arches: %', v_piece;
    end if;
end $$;

do $$
declare
    v_items jsonb := '[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"Crown"},{"tooth_number":31,"work_type":"Bridge"},{"tooth_number":32,"work_type":"Bridge"},{"tooth_number":21,"work_type":"Denture"},{"tooth_number":41,"work_type":"Denture"}]'::jsonb;
    v_units integer;
    v_elements integer;
begin
    select count(*) into v_units
    from public.derive_billing_units(
        v_items,
        '[{"work_type":"Crown","billing_mode":"per_tooth"},{"work_type":"Bridge","billing_mode":"per_arch"},{"work_type":"Denture","billing_mode":"per_piece"}]'::jsonb
    );
    select jsonb_array_length(v_items) into v_elements;
    if v_units <> 4 or v_elements <> 6 then
        raise exception 'mixed modes must derive independently while preserving clinical element_count: units %, elements %', v_units, v_elements;
    end if;
end $$;

do $$
declare
    v_lab uuid:=gen_random_uuid();
    v_other_lab uuid:=gen_random_uuid();
    v_admin uuid:=gen_random_uuid();
    v_unrelated_technician uuid:=gen_random_uuid();
    v_denied boolean;
    v_result jsonb;
begin
    insert into auth.users(id) values(v_admin),(v_unrelated_technician);
    insert into public.profiles(id,display_name,legacy_user_id,technician_name)
    values(v_admin,'Billing mode admin',v_admin::text,null),
          (v_unrelated_technician,'Unrelated technician',v_unrelated_technician::text,'Unrelated technician');
    insert into public.organizations(id,organization_type,name)
    values(v_lab,'lab','Billing mode target'),(v_other_lab,'lab','Billing mode unrelated');
    insert into public.organization_memberships(organization_id,user_id,role)
    values(v_lab,v_admin,'Admin'),(v_other_lab,v_unrelated_technician,'Technician');
    insert into public.lab_work_types(lab_organization_id,id,tip_lucrare,billing_mode)
    values(v_lab,1,'Crown','per_tooth');
    insert into public.lab_contract_work_prices(lab_organization_id,id,contract,tip_lucrare,pret)
    values(v_lab,'billing-crown','General','Crown',10);
    insert into public.lab_work_orders(lab_organization_id,id,status,nume_pacient,nume_partener,discount)
    values(v_lab,1,'Not Started','Billing patient','Partner',0);
    insert into public.lab_work_order_items(
        lab_organization_id,work_order_id,tooth_number,work_type,contract,
        unit_price,quantity,line_total,price_source,price_fixed_at
    ) values
        (v_lab,1,11,'Crown','General',10,1,10,'legacy',now()),
        (v_lab,1,12,'crown','General',10,1,10,'legacy',now());
    insert into public.lab_work_order_price_lines(
        lab_organization_id,work_order_id,work_type,billing_mode,billing_scope,
        contract,unit_price,quantity,line_total,price_source,price_fixed_at
    ) values
        (v_lab,1,'Crown','per_tooth','tooth:11','General',10,1,10,'legacy',now()),
        (v_lab,1,'crown','per_tooth','tooth:12','General',10,1,10,'legacy',now());

    perform set_config('request.jwt.claim.sub',v_unrelated_technician::text,true);
    v_denied:=false;
    begin perform public.get_work_order_price_lines(v_lab,1);
    exception when others then v_denied:=SQLERRM='Price line access denied'; end;
    if not v_denied then raise exception 'Unrelated technician read target-lab price lines'; end if;

    v_denied:=false;
    begin perform public.estimate_work_order_items(v_lab,'Partner','General',
        '[{"tooth_number":11,"work_type":"Crown"}]'::jsonb,0);
    exception when others then v_denied:=SQLERRM='Price estimate access denied'; end;
    if not v_denied then raise exception 'Unrelated technician estimated target-lab prices'; end if;

    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    v_result:=public.replace_work_order_items(v_lab,1,
        '[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"CROWN"}]'::jsonb,
        'General');
    if (select count(*) from public.lab_work_order_price_lines
        where lab_organization_id=v_lab and work_order_id=1)<>2
       or (v_result->>'billing_unit_count')::numeric<>2
       or (v_result->>'list_price')::numeric<>20 then
        raise exception 'Mixed-case legacy units duplicated on unchanged save: %',v_result;
    end if;

    perform public.set_work_order_price_snapshot(v_lab,1,0.335,0,'rounding regression');
    if (select snapshot_list_price from public.lab_work_orders
        where lab_organization_id=v_lab and id=1)<>0.68
       or (select sum(line_total) from public.lab_work_order_price_lines
        where lab_organization_id=v_lab and work_order_id=1)<>0.68 then
        raise exception 'Override aggregate differs from persisted rounded lines';
    end if;
end $$;

rollback;

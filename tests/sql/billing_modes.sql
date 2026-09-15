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

-- Technician costs use the same frozen billable quantities as partner prices.
do $$
declare
    v_lab uuid:=gen_random_uuid();
    v_admin uuid:=gen_random_uuid();
    v_technician uuid:=gen_random_uuid();
    v_model_assignment uuid;
    v_amount numeric;
    v_quantity numeric;
    v_rows integer;
    v_error text;
    v_initial_items jsonb:='[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":12,"work_type":"Bridge"},{"tooth_number":13,"work_type":"Crown"},{"tooth_number":14,"work_type":"Crown"},{"tooth_number":21,"work_type":"Denture"},{"tooth_number":31,"work_type":"Denture"}]';
    v_same_arch_items jsonb:='[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":12,"work_type":"Bridge"},{"tooth_number":15,"work_type":"Bridge"},{"tooth_number":13,"work_type":"Crown"},{"tooth_number":14,"work_type":"Crown"},{"tooth_number":21,"work_type":"Denture"},{"tooth_number":31,"work_type":"Denture"}]';
    v_both_arch_items jsonb:='[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":12,"work_type":"Bridge"},{"tooth_number":15,"work_type":"Bridge"},{"tooth_number":32,"work_type":"Bridge"},{"tooth_number":13,"work_type":"Crown"},{"tooth_number":14,"work_type":"Crown"},{"tooth_number":21,"work_type":"Denture"},{"tooth_number":31,"work_type":"Denture"}]';
    v_lower_only_items jsonb:='[{"tooth_number":32,"work_type":"Bridge"},{"tooth_number":13,"work_type":"Crown"},{"tooth_number":14,"work_type":"Crown"},{"tooth_number":21,"work_type":"Denture"},{"tooth_number":31,"work_type":"Denture"}]';
begin
    insert into auth.users(id) values(v_admin),(v_technician);
    insert into public.profiles(id,display_name,legacy_user_id,technician_name)
    values(v_admin,'Billing technician admin',v_admin::text,null),
          (v_technician,'Billing technician',v_technician::text,'Billing technician');
    insert into public.organizations(id,organization_type,name)
    values(v_lab,'lab','Technician billing modes');
    insert into public.organization_memberships(organization_id,user_id,role)
    values(v_lab,v_admin,'Admin'),(v_lab,v_technician,'Technician');
    insert into public.lab_work_types(lab_organization_id,id,tip_lucrare,billing_mode)
    values(v_lab,1,'Crown','per_tooth'),(v_lab,2,'Bridge','per_arch'),
          (v_lab,3,'Denture','per_piece'),(v_lab,4,'Unpriced','per_piece');
    insert into public.lab_contract_work_prices(lab_organization_id,id,contract,tip_lucrare,pret)
    values(v_lab,'tech-crown','General','Crown',100),
          (v_lab,'tech-bridge','General','Bridge',200),
          (v_lab,'tech-denture','General','Denture',300),
          (v_lab,'tech-unpriced','General','Unpriced',400);
    insert into public.lab_technician_costs(
        lab_organization_id,source_row_no,tehnician,tip_lucrare,etapa,cost
    ) values
        (v_lab,1,'Billing technician','Crown','Model',10),
        (v_lab,2,'Billing technician','Bridge','Model',20),
        (v_lab,3,'Billing technician','Denture','Model',30),
        (v_lab,4,'Billing technician','Crown','Modelare',11),
        (v_lab,5,'Billing technician','Bridge','Modelare',21),
        (v_lab,6,'Billing technician','Denture','Modelare',31),
        (v_lab,7,'Billing technician','Crown','Ceramica Finisare',12),
        (v_lab,8,'Billing technician','Bridge','Ceramica Finisare',22),
        (v_lab,9,'Billing technician','Denture','Ceramica Finisare',32);
    insert into public.lab_work_orders(
        lab_organization_id,id,status,nume_pacient,nume_partener,discount
    ) values
        (v_lab,101,'Not Started','Mode technician patient','Partner',0),
        (v_lab,102,'Not Started','Missing technician patient','Partner',0);

    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    perform public.replace_work_order_items(v_lab,101,v_initial_items,'General');

    select quantity,amount into v_quantity,v_amount
    from public.resolve_work_order_technician_costs(v_lab,101,'model','Billing technician')
    where lower(work_type)='bridge';
    if v_quantity<>1 or v_amount<>20 then
        raise exception 'One-arch technician cost must be one unit: quantity %, amount %',v_quantity,v_amount;
    end if;
    select quantity,amount into v_quantity,v_amount
    from public.resolve_work_order_technician_costs(v_lab,101,'model','Billing technician')
    where lower(work_type)='denture';
    if v_quantity<>1 or v_amount<>30 then
        raise exception 'Piece technician cost must remain one unit across arches: quantity %, amount %',v_quantity,v_amount;
    end if;

    perform public.sync_work_order_stage_assignment(v_lab,101,'model','Billing technician');
    perform public.sync_work_order_stage_assignment(v_lab,101,'modelare','Billing technician');
    perform public.sync_work_order_stage_assignment(v_lab,101,'cer_fin','Billing technician');
    if (select agreed_amount from public.lab_work_order_stage_assignments
        where lab_organization_id=v_lab and work_order_id=101 and stage_key='model')<>70
       or (select agreed_amount from public.lab_work_order_stage_assignments
        where lab_organization_id=v_lab and work_order_id=101 and stage_key='modelare')<>74
       or (select agreed_amount from public.lab_work_order_stage_assignments
        where lab_organization_id=v_lab and work_order_id=101 and stage_key='cer_fin')<>78 then
        raise exception 'Mixed billing quantities were not applied independently to every stage';
    end if;
    if exists(
        select 1 from public.lab_work_order_stage_assignments
        where lab_organization_id=v_lab and work_order_id=101 and quantity<>4
    ) then
        raise exception 'Assignment summary quantity must equal total billable units';
    end if;
    if exists(
        select 1 from public.lab_work_order_assignment_cost_lines l
        join public.lab_work_order_stage_assignments a on a.id=l.assignment_id
        where a.lab_organization_id=v_lab and a.work_order_id=101
          and ((lower(l.work_type)='crown' and l.billing_mode<>'per_tooth')
            or (lower(l.work_type)='bridge' and l.billing_mode<>'per_arch')
            or (lower(l.work_type)='denture' and l.billing_mode<>'per_piece'))
    ) then
        raise exception 'Technician cost line did not freeze its billing mode';
    end if;

    perform public.replace_work_order_items(
        v_lab,102,'[{"tooth_number":11,"work_type":"Unpriced"}]'::jsonb,'General'
    );
    begin
        perform public.sync_work_order_stage_assignment(v_lab,102,'model','Billing technician');
    exception when others then
        v_error:=SQLERRM;
    end;
    if v_error is distinct from 'Missing technician cost configuration: Billing technician / Unpriced / model' then
        raise exception 'Unexpected missing technician cost error: %',v_error;
    end if;

    select id into v_model_assignment
    from public.lab_work_order_stage_assignments
    where lab_organization_id=v_lab and work_order_id=101 and stage_key='model';
    perform public.record_technician_payment(v_model_assignment,70,current_date,'billing-mode-payment');

    perform public.replace_work_order_items(v_lab,101,v_same_arch_items,'General');
    if exists(select 1 from public.lab_work_order_assignment_adjustments where assignment_id=v_model_assignment) then
        raise exception 'Another tooth on an involved arch created an adjustment';
    end if;

    perform public.replace_work_order_items(v_lab,101,v_both_arch_items,'General');
    select count(*) into v_rows
    from public.lab_work_order_assignment_adjustments
    where assignment_id=v_model_assignment and lower(work_type)='bridge'
      and billing_mode='per_arch' and quantity_delta=1 and amount=20;
    if v_rows<>1 or public.assignment_agreed_amount(v_model_assignment)<>90 then
        raise exception 'First tooth on the other arch must append one positive unit';
    end if;
    select quantity,amount into v_quantity,v_amount
    from public.resolve_work_order_technician_costs(v_lab,101,'model','Billing technician')
    where lower(work_type)='bridge';
    if v_quantity<>2 or v_amount<>40 then
        raise exception 'Two-arch technician cost must be two units: quantity %, amount %',v_quantity,v_amount;
    end if;

    perform public.replace_work_order_items(v_lab,101,v_lower_only_items,'General');
    if not exists(
        select 1 from public.lab_work_order_assignment_adjustments
        where assignment_id=v_model_assignment and lower(work_type)='bridge'
          and billing_mode='per_arch' and quantity_delta=-1 and amount=-20
    ) or public.assignment_agreed_amount(v_model_assignment)<>70 then
        raise exception 'Removing the last tooth from an arch must append one negative unit';
    end if;
    if exists(
        select 1 from public.lab_work_order_assignment_adjustments
        where assignment_id=v_model_assignment and lower(work_type)='denture'
    ) then
        raise exception 'Piece cost changed while the work type remained present';
    end if;
    select count(*) into v_rows
    from public.lab_work_order_assignment_adjustments
    where assignment_id=v_model_assignment;
    perform public.replace_work_order_items(v_lab,101,v_lower_only_items,'General');
    if (select count(*) from public.lab_work_order_assignment_adjustments
        where assignment_id=v_model_assignment)<>v_rows then
        raise exception 'Repeated identical scope save appended an adjustment';
    end if;
    if (select count(*) from public.lab_work_order_assignment_cost_lines
        where assignment_id=v_model_assignment)<>3
       or (select sum(amount) from public.lab_work_order_assignment_cost_lines
        where assignment_id=v_model_assignment)<>70
       or (select sum(amount) from public.technician_payments
        where assignment_id=v_model_assignment)<>70 then
        raise exception 'Scope edits rewrote base technician history or payment history';
    end if;
end $$;

rollback;

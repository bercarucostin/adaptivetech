-- Run as database owner after apply.sql in a disposable Supabase database.
-- Real RPC writes, snapshot changes, ACL failures and deferred constraints all roll back.
begin;
do $$
declare
    v_lab uuid:=gen_random_uuid(); v_tech uuid:=gen_random_uuid(); v_admin uuid:=gen_random_uuid();
    v_id bigint; v_assignment uuid; v_scope record; v_amount numeric; v_rows integer;
    v_items jsonb:='[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":21,"work_type":"Bridge"}]';
    v_changed jsonb:='[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"Crown"}]';
    v_failed boolean; v_audits integer; v_result jsonb; v_management_id bigint; v_case_input jsonb;
begin
    if exists(select 1 from information_schema.columns where table_schema='public' and
        ((table_name='lab_work_orders' and column_name in ('tip_lucrare','nr_elemente','snapshot_unit_price'))
        or (table_name='lab_patient_cases' and column_name in ('tip_lucrare','material')))) then
        raise exception 'Obsolete clinical columns remain';
    end if;
    if has_function_privilege('authenticated','public.replace_work_order_items(uuid,bigint,jsonb,text)','EXECUTE') then
        raise exception 'Raw item replacement must be private; public writers also save the case'; end if;
    insert into auth.users(id) values(v_tech),(v_admin);
    insert into public.profiles(id,display_name,technician_name,legacy_user_id)
        values(v_tech,'Per tooth technician','Per tooth technician',v_tech::text),(v_admin,'Per tooth admin',null,v_admin::text)
        on conflict(id) do update set technician_name=excluded.technician_name,legacy_user_id=excluded.legacy_user_id;
    -- Isolate the AI lab lookup inside this rollback-only disposable fixture.
    update public.organizations set slug=null where slug='flowrise-dental-lab';
    insert into public.organizations(id,organization_type,name,slug) values(v_lab,'lab','Per tooth integration','flowrise-dental-lab');
    insert into public.organization_memberships(organization_id,user_id,role) values(v_lab,v_tech,'Technician'),(v_lab,v_admin,'Admin');
    insert into public.lab_work_types(lab_organization_id,id,tip_lucrare) values(v_lab,1,'Crown'),(v_lab,2,'Bridge');
    insert into public.lab_contract_work_prices(lab_organization_id,id,contract,tip_lucrare,pret)
        values(v_lab,'test-crown','General','Crown',100),(v_lab,'test-bridge','General','Bridge',250);
    insert into public.lab_technician_costs(lab_organization_id,source_row_no,tehnician,tip_lucrare,etapa,cost)
        values(v_lab,1,'Per tooth technician','Crown','Model',20),(v_lab,2,'Per tooth technician','Bridge','Model',50);
    perform set_config('request.jwt.claim.sub',v_tech::text,true);
    v_id:=public.create_technician_work_order(v_lab,current_date,'Patient','Partner',v_items,null,'Model',
        '{"tooth_details_json":{"11":{"material":"remove","shade":"A2"},"__case":{"material":"remove"}}}');
    set constraints all immediate;
    set constraints all deferred;
    if not exists(select 1 from public.lab_patient_cases where lab_organization_id=v_lab and work_order_id=v_id and tooth_details_json not like '%material%') then
        raise exception 'Creation must atomically save sanitized case'; end if;
    select * into v_scope from public.get_my_work_orders(v_lab) where id=v_id;
    if v_scope.element_count<>2 or v_scope.work_types<>array['Crown','Bridge'] or v_scope.work_type_summary<>'Crown / Bridge' then
        raise exception 'Mixed scope read model is incorrect'; end if;
    if v_scope.items->0 ? 'unit_price' then raise exception 'Technician received sale price'; end if;
    -- Exercise the actual authenticated table boundary, not an owner-bypassed SELECT.
    execute 'SET LOCAL ROLE authenticated';
    select count(*) into v_rows from public.lab_work_order_items where lab_organization_id=v_lab and work_order_id=v_id;
    if v_rows<>0 then raise exception 'Technician raw SELECT exposed commercial items'; end if;
    select * into v_scope from public.get_my_work_orders(v_lab) where id=v_id;
    if v_scope.element_count<>2 or v_scope.items->0 ? 'contract' or v_scope.items->0 ? 'line_total' then
        raise exception 'Technician scrubbed RPC is missing scope or exposes commercial fields'; end if;
    execute 'RESET ROLE';
    select id into v_assignment from public.lab_work_order_stage_assignments where lab_organization_id=v_lab and work_order_id=v_id;
    if public.assignment_agreed_amount(v_assignment)<>70 then raise exception 'Mixed item costs incorrect'; end if;
    if (select snapshot_list_price from public.lab_work_orders where lab_organization_id=v_lab and id=v_id)<>350 then raise exception 'Mixed snapshot incorrect'; end if;
    update public.lab_contract_work_prices set pret=999 where lab_organization_id=v_lab;
    update public.lab_technician_costs set cost=999 where lab_organization_id=v_lab;
    select count(*) into v_audits from public.work_order_financial_audit where lab_organization_id=v_lab and work_order_id=v_id and entity_type='work_order_price';
    perform public.replace_work_order_items(v_lab,v_id,v_items,'General');
    if (select count(*) from public.work_order_financial_audit where lab_organization_id=v_lab and work_order_id=v_id and entity_type='work_order_price')<>v_audits then raise exception 'Unchanged save adds a price audit'; end if;
    if (select snapshot_list_price from public.lab_work_orders where lab_organization_id=v_lab and id=v_id)<>350 then raise exception 'Unchanged item price was recalculated'; end if;
    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    perform public.record_technician_payment(v_assignment,70,current_date,'test-settled');
    perform set_config('request.jwt.claim.sub',v_tech::text,true);
    insert into public.lab_contract_work_prices(lab_organization_id,id,contract,tip_lucrare,pret) values(v_lab,'test-forbidden-contract','Forbidden','Crown',1);
    perform public.replace_work_order_items(v_lab,v_id,v_changed,'Forbidden');
    if (select unit_price from public.lab_work_order_items where lab_organization_id=v_lab and work_order_id=v_id and tooth_number=12)<>999 then raise exception 'Technician influenced the commercial contract'; end if;
    if public.assignment_agreed_amount(v_assignment)<>40 then raise exception 'Signed adjustment must use frozen type costs'; end if;
    if (select agreed_amount from public.lab_work_order_stage_assignments where id=v_assignment)<>70 then raise exception 'Original assignment was rewritten'; end if;
    if (select sum(amount) from public.technician_payments where assignment_id=v_assignment)<>70 then raise exception 'Settled payment was rewritten'; end if;
    select count(*) into v_rows from public.lab_work_order_assignment_adjustments where assignment_id=v_assignment;
    perform public.replace_work_order_items(v_lab,v_id,v_changed,'General');
    if (select count(*) from public.lab_work_order_assignment_adjustments where assignment_id=v_assignment)<>v_rows then raise exception 'Repeated save adds duplicate adjustment'; end if;
    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    if (select cost_model from public.get_my_work_orders(v_lab) where id=v_id)<>40 then raise exception 'Management cost omits signed adjustments'; end if;
    perform set_config('request.jwt.claim.sub',v_tech::text,true);
    v_result:=public.ai_mutate_work_order_role_safe('update',jsonb_build_object('id',v_id,'fields',jsonb_build_object(
        'items','[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"Crown"},{"tooth_number":13,"work_type":"Crown"},{"tooth_number":14,"work_type":"Crown"}]'::jsonb)));
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Technician AI update failed: %',v_result; end if;
    if (select selected_teeth from public.lab_patient_cases where lab_organization_id=v_lab and work_order_id=v_id)<>'11,12,13,14' then raise exception 'Atomic AI writer did not synchronize clinical scope'; end if;
    if (select item->'My_Stages'->0->>'Payment_Status' from jsonb_array_elements(public.ai_technician_work_orders()) as rows(item) where (item->>'ID')::bigint=v_id)<>'Not Paid' then raise exception 'AI payment status ignores adjusted outstanding balance'; end if;
    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    -- Legacy cache says Paid, but the adjusted amount is 80 and only 70 was paid.
    update public.lab_work_orders set paid_model='Paid' where lab_organization_id=v_lab and id=v_id;
    if (select paid_model from public.get_my_work_orders(v_lab) where id=v_id)<>'Not Paid' then
        raise exception 'Management payment status ignores adjusted outstanding balance'; end if;
    v_result:=public.ai_mutate_work_order('update',jsonb_build_object('id',v_id,'fields',jsonb_build_object('Paid_Model','Paid')));
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Settlement update failed: %',v_result; end if;
    if (select sum(amount) from public.technician_payments where assignment_id=v_assignment)<>80 then
        raise exception 'Stale Paid cache prevented payment of added scope'; end if;
    update public.lab_work_orders set paid_model='Not Paid' where lab_organization_id=v_lab and id=v_id;
    perform public.set_stage_payment_status(v_lab,v_id,'model','Not Paid');
    if (select sum(amount) from public.technician_payments where assignment_id=v_assignment)<>70 then
        raise exception 'Stale Not Paid cache prevented reversal of the actual legacy payment'; end if;

    v_management_id:=public.create_management_work_order(
        p_lab_organization_id=>v_lab,p_deadline=>current_date,p_nume_pacient=>'Management patient',
        p_nume_partener=>'Partner',p_items=>v_items,p_tehnician_model=>'Per tooth technician',
        p_status=>'Finished',p_status_model=>'Finished',p_modelare_not_applicable=>true,p_cer_fin_not_applicable=>true,
        p_paid_model=>'Paid',p_locked=>true,p_case=>' {"clinic_note":"Saved note","shade":"A2","method":"Scan","production_notes":"Lab note","tooth_details_json":"{\"11\":{\"note\":\"Tooth note\"}}"}');
    if not exists(select 1 from public.lab_work_orders where lab_organization_id=v_lab and id=v_management_id
        and status='Finished' and status_model='Finished' and locked and modelare_not_applicable and cer_fin_not_applicable) then
        raise exception 'Management creation did not preserve complete initial state'; end if;
    if not exists(select 1 from public.lab_patient_cases where lab_organization_id=v_lab and work_order_id=v_management_id
        and clinic_note='Saved note' and production_notes='Lab note' and tooth_details_json::jsonb->'11'->>'note'='Tooth note') then
        raise exception 'Management creation lost clinical fields'; end if;
    if public.work_order_stage_payment_status(v_lab,v_management_id,'model')<>'Paid' then
        raise exception 'Management creation did not save initial payment'; end if;
    execute 'SET LOCAL ROLE authenticated';
    select count(*) into v_rows from public.lab_work_order_items where lab_organization_id=v_lab and work_order_id=v_management_id;
    execute 'RESET ROLE';
    if v_rows<>2 then raise exception 'Management commercial item access was lost'; end if;

    -- Failure after items/case/costs must roll back the entire creation.
    v_failed:=false;
    begin perform public.create_management_work_order(
        p_lab_organization_id=>v_lab,p_deadline=>current_date,p_nume_pacient=>'Rollback management',
        p_nume_partener=>'Partner',p_items=>v_items,p_tehnician_model=>'Per tooth technician',p_paid_model=>'Invalid');
    exception when others then v_failed:=true; end;
    if not v_failed or exists(select 1 from public.lab_work_orders where lab_organization_id=v_lab and nume_pacient='Rollback management')
        or exists(select 1 from public.lab_patient_cases where lab_organization_id=v_lab and nume_pacient='Rollback management') then
        raise exception 'Failed management creation left an order or case'; end if;
    for v_case_input in select value from jsonb_array_elements('[{"notes":"unsupported"},{"tooth_data":{}},{"material":"unsupported"},{"tooth_details":[]},{"tooth_details":{"11":[]}}, {"tooth_details":{},"tooth_details_json":{}}]') loop
        v_failed:=false;
        begin perform public.save_work_order_clinical_case(v_lab,v_id,v_case_input);
        exception when others then v_failed:=true; end;
        if not v_failed then raise exception 'Unsupported case contract accepted: %',v_case_input; end if;
    end loop;
    perform set_config('request.jwt.claim.sub',v_tech::text,true);
    v_failed:=false;
    begin insert into public.lab_work_order_items(lab_organization_id,work_order_id,tooth_number,work_type) values(v_lab,v_id,19,'Crown');
    exception when check_violation then v_failed:=true; end;
    if not v_failed then raise exception 'Invalid FDI tooth was accepted'; end if;
    v_failed:=false;
    begin perform public.create_technician_work_order(v_lab,current_date,'Empty','Partner','[]'::jsonb);
    exception when others then v_failed:=true; end;
    if not v_failed then raise exception 'Empty scope was accepted'; end if;
    if exists(select 1 from public.lab_work_orders where lab_organization_id=v_lab and nume_pacient='Empty') then raise exception 'Failed creation left an orphan'; end if;
    v_failed:=false;
    begin delete from public.lab_work_order_items where lab_organization_id=v_lab and work_order_id=v_id;
        set constraints all immediate;
    exception when others then v_failed:=true; end;
    if not v_failed then raise exception 'Deferred invariant accepted empty active order'; end if;
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    v_failed:=false;
    begin perform public.replace_work_order_items(v_lab,v_id,v_changed,'General');
    exception when others then v_failed:=true; end;
    if not v_failed then raise exception 'Unrelated user edited scope'; end if;
end $$;
rollback;

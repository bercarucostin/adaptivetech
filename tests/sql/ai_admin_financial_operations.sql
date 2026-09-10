begin;
do $$
declare v_definition text;
begin
    select pg_get_functiondef('public.ai_admin_technician_cost_operation(text,jsonb,jsonb)'::regprocedure) into v_definition;
    if v_definition not ilike '%insert into public.lab_technician_costs%' or v_definition not ilike '%advisory_xact_lock%' then
        raise exception 'Technician-cost duplication is not atomic';
    end if;
    if v_definition ilike '%lab_work_orders%' then
        raise exception 'Technician-cost operations must never create a Work Order';
    end if;
    select pg_get_functiondef('public.ai_admin_price_operation(text,text,jsonb,jsonb)'::regprocedure) into v_definition;
    if v_definition not ilike '%set_work_order_price_snapshot%' then
        raise exception 'Individual Work Order prices must use the audited snapshot API';
    end if;
end $$;
rollback;

-- Run after db/schema/apply.sql against a disposable Supabase database.
begin;

do $$
declare v_definition text;
begin
    select pg_get_functiondef('public.get_my_work_orders(uuid)'::regprocedure) into v_definition;
    if v_definition ilike '%join public.lab_contract_work_prices%' then
        raise exception 'Work Order reader still derives historic prices from current catalog';
    end if;
    if v_definition not ilike '%snapshot_final_price%' then
        raise exception 'Work Order reader does not expose saved totals';
    end if;

    select pg_get_functiondef('public.get_my_salary(uuid)'::regprocedure) into v_definition;
    if v_definition ilike '%join public.lab_technician_costs%' then
        raise exception 'Salary reader still derives historic costs from current catalog';
    end if;
    if v_definition not ilike '%lab_work_order_stage_assignments%' then
        raise exception 'Salary reader does not use saved assignments';
    end if;

    select pg_get_functiondef('public.ai_technician_receivables()'::regprocedure) into v_definition;
    if v_definition not ilike '%technician_payments%' then
        raise exception 'AI receivables do not use payment history';
    end if;
end $$;

rollback;

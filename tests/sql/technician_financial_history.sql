-- Run after db/schema/apply.sql against a disposable Supabase database.
begin;

select assignment_id, work_type, quantity, unit_cost, amount, cost_source
from public.lab_work_order_assignment_cost_lines limit 0;

do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.sync_work_order_stage_assignment(uuid,bigint,text,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%for update%' or v_definition not ilike '%ended_at%' then
        raise exception 'Assignment synchronization must lock and close prior assignment';
    end if;
    if v_definition not ilike '%lab_work_order_assignment_cost_lines%' then
        raise exception 'Assignment synchronization must snapshot all work-type cost lines';
    end if;

    select pg_get_functiondef('public.record_technician_payment(uuid,numeric,date,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%request_key%' or v_definition not ilike '%outstanding%' then
        raise exception 'Payment recording must be idempotent and prevent overpayment';
    end if;

    select pg_get_functiondef('public.reverse_technician_payment(uuid,text,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%reversal_of%' then
        raise exception 'Payment reversal must append rather than delete';
    end if;
end $$;

rollback;

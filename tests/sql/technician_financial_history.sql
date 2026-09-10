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
    if v_definition not ilike '%request_key%' or v_definition not ilike '%outstanding%'
       or v_definition not ilike '%already used for another payment%' then
        raise exception 'Payment recording must be idempotent and prevent overpayment';
    end if;

    select pg_get_functiondef('public.reverse_technician_payment(uuid,text,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%reversal_of%' then
        raise exception 'Payment reversal must append rather than delete';
    end if;

    select pg_get_functiondef('public.update_management_work_order_v188(uuid,bigint,date,text,text,text,text,text,integer,numeric,timestamp with time zone,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text,text,jsonb,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%sync_work_order_stage_assignment%'
       or v_definition not ilike '%set_stage_payment_status%'
       or v_definition not ilike '%v_model_changed%'
       or v_definition not ilike '%prepare_stage_reassignment%'
       or v_definition not ilike '%replace_work_order_items%' then
        raise exception 'V188 management edits must preserve assignment and payment history';
    end if;

    select pg_get_functiondef('public.update_management_work_order_stage_field(uuid,bigint,text,text,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%sync_work_order_stage_assignment%'
       or v_definition ilike '%set_stage_payment_status%' then
        raise exception 'Quick reassignment must close assignments without reversing historical payments';
    end if;

    select pg_get_functiondef('public.prepare_stage_reassignment(uuid,bigint,text,text,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%OUTSTANDING_ASSIGNMENT%'
       or v_definition not ilike '%keep_outstanding%'
       or v_definition not ilike '%pay_outstanding%' then
        raise exception 'Outstanding reassignment requires an explicit settlement choice';
    end if;
end $$;

rollback;

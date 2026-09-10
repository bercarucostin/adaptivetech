-- Run after db/schema/apply.sql against a disposable Supabase database.
-- Every assertion raises and aborts when the financial-history contract drifts.
begin;

do $$
declare
    v_missing text;
begin
    select string_agg(required.column_name, ', ' order by required.column_name)
      into v_missing
    from (values
        ('snapshot_unit_price'), ('snapshot_list_price'), ('snapshot_final_price'),
        ('price_source'), ('price_fixed_at'), ('price_migrated'), ('archived_at'),
        ('model_not_applicable'), ('modelare_not_applicable'), ('cer_fin_not_applicable')
    ) required(column_name)
    where not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'lab_work_orders'
          and c.column_name = required.column_name
    );

    if v_missing is not null then
        raise exception 'Missing lab_work_orders columns: %', v_missing;
    end if;
end $$;

select lab_organization_id, work_order_id, tooth_number, work_type, contract,
       unit_price, quantity, line_total, price_source, price_fixed_at, price_migrated
from public.lab_work_order_items limit 0;

select id, lab_organization_id, work_order_id, stage_key, technician_user_id,
       technician_name, unit_cost, quantity, agreed_amount, cost_source,
       fixed_at, started_at, ended_at, migrated
from public.lab_work_order_stage_assignments limit 0;

select id, lab_organization_id, assignment_id, amount, currency, paid_on,
       recorded_at, recorded_by_user_id, request_key, reversal_of, migration_balance
from public.technician_payments limit 0;

select id, lab_organization_id, work_order_id, entity_type, entity_id, action,
       before_value, after_value, changed_at, changed_by_user_id
from public.work_order_financial_audit limit 0;

do $$
begin
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'lab_work_order_stage_assignments_one_active_idx'
          and indexdef ilike '%where (ended_at is null)%'
    ) then
        raise exception 'Missing unique active-assignment index';
    end if;
end $$;

do $$
declare v_definition text;
begin
    if has_function_privilege('authenticated', 'public.resolve_work_order_price_snapshot(uuid,text,text,text,numeric,numeric)', 'EXECUTE') then
        raise exception 'Authenticated callers can execute the internal sale-price resolver directly';
    end if;
    if not has_function_privilege('authenticated', 'public.backfill_work_order_financial_history(uuid)', 'EXECUTE') then
        raise exception 'Authenticated Admin cannot invoke the guarded financial backfill';
    end if;
    select pg_get_functiondef('public.delete_management_work_order(uuid,bigint)'::regprocedure) into v_definition;
    if v_definition not ilike '%price_fixed_at is not null%' or v_definition not ilike '%lab_work_order_items%' then
        raise exception 'Deleting a priced Work Order must preserve its financial snapshots';
    end if;
    if has_table_privilege('authenticated','public.lab_work_orders','INSERT,UPDATE,DELETE')
       or has_any_column_privilege('authenticated','public.lab_work_orders','INSERT')
       or has_any_column_privilege('authenticated','public.lab_work_orders','UPDATE') then
        raise exception 'Authenticated callers can bypass Work Order RPCs';
    end if;
    if has_table_privilege('authenticated','public.lab_work_order_items','INSERT,UPDATE,DELETE')
       or has_any_column_privilege('authenticated','public.lab_work_order_items','INSERT')
       or has_any_column_privilege('authenticated','public.lab_work_order_items','UPDATE') then
        raise exception 'Authenticated callers can rewrite per-tooth snapshots';
    end if;
    if to_regprocedure('public.update_management_work_order_v188(uuid,bigint,date,text,text,text,text,text,integer,numeric,timestamp with time zone,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text,text,jsonb,text)') is null then
        raise exception 'Management V188 update RPC is missing';
    end if;
    if to_regprocedure('public.update_management_work_order_stage_field(uuid,bigint,text,text,text)') is null then
        raise exception 'Management quick-stage RPC is missing';
    end if;
    if not exists (
        select 1 from pg_trigger
        where tgrelid='public.lab_work_orders'::regclass
          and tgname in ('lab_work_orders_stage_rules_insert','lab_work_orders_stage_rules_update')
          and not tgisinternal
        group by tgrelid having count(*)=2
    ) then raise exception 'Work Order stage guard triggers are missing'; end if;
end $$;

rollback;

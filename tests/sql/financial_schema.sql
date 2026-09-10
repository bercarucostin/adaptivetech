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
        ('price_source'), ('price_fixed_at'), ('price_migrated'), ('archived_at')
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

rollback;

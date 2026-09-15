-- Run after db/schema/apply.sql against a disposable Supabase database.
begin;

do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.resolve_work_order_price_snapshot(uuid,text,text,text,numeric,numeric)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%price_source%' or v_definition not ilike '%''missing''%' then
        raise exception 'Price resolver does not preserve missing-price provenance';
    end if;

    select pg_get_functiondef('public.set_work_order_price_snapshot(uuid,bigint,numeric,numeric,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%work_order_financial_audit%' then
        raise exception 'Explicit price overrides are not audited';
    end if;
    if v_definition not ilike '%update public.lab_work_order_price_lines%'
       or v_definition not ilike '%price_source=''admin_override''%' then
        raise exception 'Explicit price overrides must persist on frozen price lines';
    end if;
    if v_definition ilike '%update public.lab_work_order_items%' then
        raise exception 'Clinical items cannot be the price authority';
    end if;
    if v_definition ilike '%p_unit_price*sum%'
       or v_definition not ilike '%sum(line.line_total)%' then
        raise exception 'Override aggregate must equal persisted rounded price lines';
    end if;
end $$;

select 1 / case when exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='lab_work_orders'
      and column_name='snapshot_list_price'
) then 1 else 0 end;

rollback;

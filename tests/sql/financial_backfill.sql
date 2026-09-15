-- Run after db/schema/apply.sql against a disposable Supabase database.
begin;

do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.backfill_work_order_financial_history(uuid)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%price_fixed_at is null%' then
        raise exception 'Backfill must not overwrite fixed prices';
    end if;
    if v_definition ilike '%resolve_work_order_price_snapshot%' or v_definition ilike '%insert into public.technician_payments%' then
        raise exception 'Backfill cannot infer historical money from current catalogs or rewrite payments';
    end if;
    if v_definition not ilike '%lab_work_order_items%'
       or v_definition not ilike '%lab_work_order_price_lines%'
       or v_definition not ilike '%on conflict do nothing%' then
        raise exception 'Saved per-tooth prices must idempotently populate frozen price lines';
    end if;
    if v_definition ilike '%lab_contract_work_prices%' then
        raise exception 'Historical price-line backfill cannot consult current catalogs';
    end if;
end $$;

rollback;

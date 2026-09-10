-- Run after db/schema/apply.sql against a disposable Supabase database.
begin;

do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.backfill_work_order_financial_history(uuid)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%snapshot_unit_price is null%' then
        raise exception 'Backfill must not overwrite fixed prices';
    end if;
    if v_definition not ilike '%migration_balance%' or v_definition not ilike '%on conflict%' then
        raise exception 'Backfill must preserve legacy paid state idempotently';
    end if;
    if v_definition not ilike '%lab_work_order_items%' then
        raise exception 'Saved per-tooth prices must take precedence';
    end if;
end $$;

rollback;

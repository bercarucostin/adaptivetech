begin;
do $$ declare v_definition text; begin
  select pg_get_functiondef('public.adjust_material_quantity(uuid,bigint,text,numeric,numeric,text)'::regprocedure) into v_definition;
  if v_definition not ilike '%for update%' then raise exception 'Material adjustment must lock the stock row'; end if;
  if v_definition not ilike '%expected_quantity%' then raise exception 'Absolute set must detect stale state'; end if;
  if v_definition not ilike '%Expected quantity is required%' then raise exception 'AI absolute set must provide the observed quantity'; end if;
  if v_definition not ilike '%request_key%' then raise exception 'Material adjustment must be idempotent'; end if;
end $$;
rollback;

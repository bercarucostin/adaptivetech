begin;
do $$ declare v_definition text; begin
  select pg_get_functiondef('public.ai_execute_operation(jsonb)'::regprocedure) into v_definition;
  if v_definition not ilike '%adjust_material_quantity%' or v_definition not ilike '%mutate_calendar_event%' then
    raise exception 'Typed dispatcher lacks material/calendar handlers';
  end if;
  if v_definition not ilike '%AI operation not allowed for Technician%' then
    raise exception 'Technician entity allowlist is missing';
  end if;
end $$;
rollback;

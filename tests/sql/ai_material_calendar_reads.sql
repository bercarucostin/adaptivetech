begin;
do $$ declare v_definition text; begin
  select pg_get_functiondef('public.ai_read_materials()'::regprocedure) into v_definition;
  if v_definition not ilike '%lab_organization_id=v_lab%' then raise exception 'Material AI reader is not lab-scoped'; end if;
  select pg_get_functiondef('public.ai_read_calendar(date,date)'::regprocedure) into v_definition;
  if v_definition not ilike '%owner_user_id=auth.uid()%' then raise exception 'Calendar AI reader does not filter personal events'; end if;
  select pg_get_functiondef('public.get_ai_bootstrap(text)'::regprocedure) into v_definition;
  if v_definition not ilike '%materials_inventory%' or v_definition not ilike '%calendar_events%' then raise exception 'Technician AI catalog lacks materials/calendar'; end if;
end $$;
rollback;

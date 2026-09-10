begin;
do $$ declare v_definition text; begin
  select pg_get_functiondef('public.mutate_calendar_event(text,bigint,jsonb,text)'::regprocedure) into v_definition;
  if v_definition not ilike '%calendar_scope%' or v_definition not ilike '%owner_user_id%' then
    raise exception 'Calendar mutation does not enforce scope ownership';
  end if;
  if v_definition not ilike '%for update%' then raise exception 'Calendar updates must lock the event'; end if;
  if v_definition not ilike '%v_event.owner_user_id=auth.uid()%' then raise exception 'A technician must be able to move their own event between calendars'; end if;
end $$;
rollback;

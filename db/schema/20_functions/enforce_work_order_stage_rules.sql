-- Flowrise Supabase function: public.enforce_work_order_stage_rules
-- Sourced from SUPABASE V18.8 Production Guardrails.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.enforce_work_order_stage_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.model_not_applicable := coalesce(new.model_not_applicable,false);
  new.modelare_not_applicable := coalesce(new.modelare_not_applicable,false);
  new.cer_fin_not_applicable := coalesce(new.cer_fin_not_applicable,false);

  if new.model_not_applicable then
    new.tehnician_model := null;
    new.status_model := 'Not Started';
    new.paid_model := 'Not Paid';
  end if;
  if new.modelare_not_applicable then
    new.tehnician1_modelare := null;
    new.status_modelare := 'Not Started';
    new.paid_modelare := 'Not Paid';
  end if;
  if new.cer_fin_not_applicable then
    new.tehnician2_cer_fin := null;
    new.status_cer_fin := 'Not Started';
    new.paid_cer_fin := 'Not Paid';
  end if;

  if coalesce(new.status,'') not in ('Not Started','Started','Finished','Shipped','List Sent','Paid') then
    raise exception 'Invalid Work Order status: %', new.status;
  end if;

  if (not new.model_not_applicable and coalesce(new.status_model,'Not Started') not in ('Not Started','Started','Finished'))
     or (not new.modelare_not_applicable and coalesce(new.status_modelare,'Not Started') not in ('Not Started','Started','Finished'))
     or (not new.cer_fin_not_applicable and coalesce(new.status_cer_fin,'Not Started') not in ('Not Started','Started','Finished')) then
    raise exception 'Invalid production stage status';
  end if;

  if new.status not in ('Not Started','Started')
     and (
       (not new.model_not_applicable and coalesce(new.status_model,'Not Started') <> 'Finished')
       or (not new.modelare_not_applicable and coalesce(new.status_modelare,'Not Started') <> 'Finished')
       or (not new.cer_fin_not_applicable and coalesce(new.status_cer_fin,'Not Started') <> 'Finished')
     ) then
    raise exception 'Lucrarea poate avea un status final doar după finalizarea tuturor etapelor aplicabile';
  end if;

  return new;
end;
$$;

-- Flowrise Supabase function: public.get_my_work_orders_v188
-- Sourced from SUPABASE V18.16 Per-Tooth Multi-Price.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.get_my_work_orders_v188(p_lab_organization_id uuid)
returns table (
  id bigint, deadline date, status text, nume_pacient text, nume_partener text,
  items jsonb, work_types text[], work_type_summary text, element_count numeric, data_receptie timestamptz, locked boolean,
  tehnician_model text, tehnician1_modelare text, tehnician2_cer_fin text,
  status_model text, status_modelare text, status_cer_fin text, contract text,
  discount numeric, paid_model text, paid_modelare text, paid_cer_fin text,
  created_by_user_id text, created_at timestamptz, updated_by_user_id text,
  updated_at timestamptz, list_price numeric, final_price numeric,
  model_not_applicable boolean, modelare_not_applicable boolean, cer_fin_not_applicable boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id,b.deadline,b.status,b.nume_pacient,b.nume_partener,
         b.items,b.work_types,b.work_type_summary,b.element_count,b.data_receptie,b.locked,
         b.tehnician_model,b.tehnician1_modelare,b.tehnician2_cer_fin,
         b.status_model,b.status_modelare,b.status_cer_fin,b.contract,
         b.discount,b.paid_model,b.paid_modelare,b.paid_cer_fin,
         b.created_by_user_id,b.created_at,b.updated_by_user_id,b.updated_at,
         b.list_price,b.final_price,
         wo.model_not_applicable,wo.modelare_not_applicable,wo.cer_fin_not_applicable
  from public.get_my_work_orders(p_lab_organization_id) b
  join public.lab_work_orders wo
    on wo.lab_organization_id=p_lab_organization_id and wo.id=b.id
  order by b.id desc
$$;

revoke all on function public.get_my_work_orders_v188(uuid) from public;
grant execute on function public.get_my_work_orders_v188(uuid) to authenticated;

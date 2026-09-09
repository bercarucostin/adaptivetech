-- Flowrise Supabase function: public.estimate_doctor_work_order_price
-- Sourced from SUPABASE V18.15 Doctor Live Price Estimate.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.estimate_doctor_work_order_price(
    p_lab_organization_id uuid,
    p_work_type text,
    p_elements integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_partner text;
    v_contract text := 'General';
    v_unit numeric := 0;
    v_elements integer := greatest(coalesce(p_elements,1),1);
    v_matched boolean := false;
begin
    if not public.is_connected_doctor_for_lab(p_lab_organization_id) then
        raise exception 'Doctor price estimate access denied';
    end if;

    select p.legacy_partner_name into v_partner
    from public.profiles p
    where p.id=auth.uid() and p.active=true;

    if trim(coalesce(v_partner,''))='' then
        raise exception 'Doctor partner mapping is missing';
    end if;

    if trim(coalesce(p_work_type,''))='' then
        return jsonb_build_object(
            'matched',false,'partner_name',v_partner,'contract','General',
            'unit_price',0,'list_price',0,'discount',0,'final_price',0
        );
    end if;

    -- Dedicated Partner contract has priority. General is considered only
    -- when the selected Work Type does not exist in the dedicated contract.
    select cp.contract,cp.pret,true
      into v_contract,v_unit,v_matched
    from public.lab_contract_work_prices cp
    where cp.lab_organization_id=p_lab_organization_id
      and lower(trim(cp.tip_lucrare))=lower(trim(p_work_type))
      and lower(trim(cp.contract)) in (lower(trim(v_partner)),'general')
    order by
      case when lower(trim(cp.contract))=lower(trim(v_partner)) then 0 else 1 end,
      cp.id
    limit 1;

    return jsonb_build_object(
        'matched',coalesce(v_matched,false),
        'partner_name',v_partner,
        'contract',coalesce(v_contract,'General'),
        'unit_price',coalesce(v_unit,0),
        'list_price',coalesce(v_unit,0)*v_elements,
        'discount',0,
        'final_price',coalesce(v_unit,0)*v_elements
    );
end;
$$;

revoke all on function public.estimate_doctor_work_order_price(uuid,text,integer) from public;
grant execute on function public.estimate_doctor_work_order_price(uuid,text,integer) to authenticated;

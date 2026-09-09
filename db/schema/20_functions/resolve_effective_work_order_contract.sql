-- Flowrise Supabase function: public.resolve_effective_work_order_contract
-- Sourced from SUPABASE V18.14 Doctor Contract Pricing.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.resolve_effective_work_order_contract(
    p_lab_organization_id uuid,
    p_partner_name text,
    p_work_type text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_contract text;
begin
    select cp.contract into v_contract
    from public.lab_contract_work_prices cp
    where cp.lab_organization_id=p_lab_organization_id
      and lower(trim(cp.contract))=lower(trim(coalesce(p_partner_name,'')))
      and lower(trim(cp.tip_lucrare))=lower(trim(coalesce(p_work_type,'')))
    order by cp.id
    limit 1;

    if v_contract is not null then return v_contract; end if;

    select cp.contract into v_contract
    from public.lab_contract_work_prices cp
    where cp.lab_organization_id=p_lab_organization_id
      and lower(trim(cp.contract))='general'
      and lower(trim(cp.tip_lucrare))=lower(trim(coalesce(p_work_type,'')))
    order by cp.id
    limit 1;

    return coalesce(v_contract,'General');
end;
$$;

revoke all on function public.resolve_effective_work_order_contract(uuid,text,text) from public;

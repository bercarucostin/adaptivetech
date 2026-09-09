-- Flowrise Supabase function: public.estimate_work_order_items
-- Sourced from SUPABASE V18.16 Per-Tooth Multi-Price.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.estimate_work_order_items(
    p_lab_organization_id uuid,
    p_partner_name text,
    p_requested_contract text,
    p_items jsonb,
    p_discount numeric default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_partner text := nullif(trim(coalesce(p_partner_name,'')),'');
    v_requested text := coalesce(nullif(trim(coalesce(p_requested_contract,'')),''),'General');
    v_discount numeric := greatest(0,least(100,coalesce(p_discount,0)));
    v_lines jsonb := '[]'::jsonb;
    v_count integer := 0;
    v_list numeric := 0;
    v_matched_all boolean := false;
begin
    if v_role not in ('admin','manager','doctor') then
        raise exception 'Price estimate access denied';
    end if;
    if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
        raise exception 'Items must be a JSON array';
    end if;

    if v_role='doctor' then
        select nullif(trim(p.legacy_partner_name),'') into v_partner
        from public.profiles p
        where p.id=auth.uid() and p.active=true;
        if v_partner is null then raise exception 'Doctor partner mapping is missing'; end if;
        v_requested := v_partner;
        v_discount := 0;
    elsif v_partner is null then
        raise exception 'Partner name is required';
    end if;

    with item_input as (
        select trim(item->>'work_type') as work_type, count(*)::integer as quantity
        from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
        where trim(coalesce(item->>'work_type','')) <> ''
        group by trim(item->>'work_type')
    ), resolved as (
        select i.work_type,i.quantity,
               coalesce(price.contract,'General') as contract,
               coalesce(price.pret,0)::numeric as unit_price,
               (price.contract is not null) as matched
        from item_input i
        left join lateral (
            select cp.contract,cp.pret
            from public.lab_contract_work_prices cp
            where cp.lab_organization_id=p_lab_organization_id
              and lower(trim(cp.tip_lucrare))=lower(i.work_type)
              and lower(trim(cp.contract)) in (
                  lower(coalesce(v_partner,'')),lower(v_requested),'general'
              )
            order by case
                when lower(trim(cp.contract))=lower(coalesce(v_partner,'')) then 0
                when lower(trim(cp.contract))=lower(v_requested) then 1
                else 2
            end, cp.id
            limit 1
        ) price on true
    )
    select
        coalesce(jsonb_agg(jsonb_build_object(
            'work_type',work_type,'quantity',quantity,'contract',contract,
            'unit_price',unit_price,'subtotal',round(unit_price*quantity,2),
            'matched',matched
        ) order by work_type),'[]'::jsonb),
        coalesce(sum(quantity),0)::integer,
        coalesce(sum(round(unit_price*quantity,2)),0),
        coalesce(bool_and(matched),false)
    into v_lines,v_count,v_list,v_matched_all
    from resolved;

    return jsonb_build_object(
        'lines',v_lines,
        'element_count',v_count,
        'list_price',round(v_list,2),
        'discount',v_discount,
        'final_price',round(v_list*(1-v_discount/100),2),
        'matched_all',v_matched_all,
        'partner_name',v_partner
    );
end;
$$;

revoke all on function public.estimate_work_order_items(uuid,text,text,jsonb,numeric) from public;
grant execute on function public.estimate_work_order_items(uuid,text,text,jsonb,numeric) to authenticated;

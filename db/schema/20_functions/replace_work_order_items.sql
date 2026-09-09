-- Flowrise Supabase function: public.replace_work_order_items
-- Sourced from SUPABASE V18.16 Per-Tooth Multi-Price.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.replace_work_order_items(
    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_items jsonb,
    p_requested_contract text default 'General'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_order public.lab_work_orders%rowtype;
    v_first_type text;
    v_first_contract text;
    v_count integer;
    v_result jsonb;
begin
    if v_role not in ('admin','manager','doctor') then
        raise exception 'Work Order item update denied';
    end if;
    if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
        raise exception 'Items must be a JSON array';
    end if;

    select * into v_order
    from public.lab_work_orders
    where lab_organization_id=p_lab_organization_id and id=p_work_order_id
    limit 1;
    if not found then raise exception 'Work Order not found'; end if;

    if v_role='doctor' then
        if not public.doctor_matches_partner(v_order.nume_partener) then raise exception 'Work Order access denied'; end if;
        if v_order.locked then raise exception 'Work Order is locked'; end if;
        if lower(trim(coalesce(v_order.status,''))) <> 'not started' then
            raise exception 'Doctor can edit only Not Started Work Orders';
        end if;
    elsif not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    select count(*),min(trim(item->>'work_type'))
      into v_count,v_first_type
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
    where trim(coalesce(item->>'work_type','')) <> '';
    if coalesce(v_count,0)=0 then raise exception 'At least one configured tooth is required'; end if;
    if v_count <> jsonb_array_length(p_items) then raise exception 'Every selected tooth requires a Work Type'; end if;
    if exists (
        select 1
        from jsonb_array_elements(p_items) item
        where coalesce((item->>'tooth_number')::integer,0) not between 11 and 48
           or not exists (
               select 1 from public.lab_work_types wt
               where wt.lab_organization_id=p_lab_organization_id and wt.active=true
                 and lower(trim(wt.tip_lucrare))=lower(trim(item->>'work_type'))
           )
    ) then raise exception 'Every tooth requires a valid active Work Type'; end if;
    if exists (
        select 1 from jsonb_array_elements(p_items) item
        group by (item->>'tooth_number')::integer having count(*)>1
    ) then raise exception 'Duplicate tooth number'; end if;

    delete from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id;

    insert into public.lab_work_order_items (
        lab_organization_id,work_order_id,tooth_number,work_type,contract,
        unit_price,quantity,line_total,created_by_user_id,updated_by_user_id
    )
    select p_lab_organization_id,p_work_order_id,(item->>'tooth_number')::integer,
           trim(item->>'work_type'),coalesce(price.contract,'General'),
           coalesce(price.pret,0),1,round(coalesce(price.pret,0),2),
           public.current_legacy_user_id(),public.current_legacy_user_id()
    from jsonb_array_elements(p_items) item
    left join lateral (
        select cp.contract,cp.pret
        from public.lab_contract_work_prices cp
        where cp.lab_organization_id=p_lab_organization_id
          and lower(trim(cp.tip_lucrare))=lower(trim(item->>'work_type'))
          and lower(trim(cp.contract)) in (
              lower(trim(v_order.nume_partener)),
              lower(coalesce(nullif(trim(p_requested_contract),''),'General')),
              'general'
          )
        order by case
            when lower(trim(cp.contract))=lower(trim(v_order.nume_partener)) then 0
            when lower(trim(cp.contract))=lower(coalesce(nullif(trim(p_requested_contract),''),'General')) then 1
            else 2
        end, cp.id
        limit 1
    ) price on true;

    select work_type,contract into v_first_type,v_first_contract
    from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id
    order by tooth_number
    limit 1;

    update public.lab_work_orders
    set tip_lucrare=v_first_type,nr_elemente=v_count,contract=coalesce(v_first_contract,'General'),
        discount=case when v_role='doctor' then 0 else discount end,
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    where lab_organization_id=p_lab_organization_id and id=p_work_order_id;

    update public.lab_patient_cases
    set tip_lucrare=v_first_type,updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id;

    v_result := public.estimate_work_order_items(
        p_lab_organization_id,v_order.nume_partener,p_requested_contract,p_items,
        case when v_role='doctor' then 0 else v_order.discount end
    );
    return v_result;
end;
$$;

revoke all on function public.replace_work_order_items(uuid,bigint,jsonb,text) from public;
grant execute on function public.replace_work_order_items(uuid,bigint,jsonb,text) to authenticated;

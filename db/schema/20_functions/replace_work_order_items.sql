-- Saves per-tooth price snapshots. Unchanged tooth/type pairs retain their
-- original price even when the contract catalog changes.
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
    v_first_contract text;
    v_count numeric;
    v_scope_before jsonb;
    v_scope_after jsonb;
    v_list numeric;
    v_final numeric;
    v_lines jsonb;
    v_before_lines jsonb;
    v_matched_all boolean;
    v_order_price_source text;
    v_order_price_fixed_at timestamptz;
begin
    if v_role not in ('admin','manager','doctor','technician') then
        raise exception 'Work Order item update denied';
    end if;
    if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
        raise exception 'Items must be a JSON array';
    end if;

    select * into v_order
    from public.lab_work_orders
    where lab_organization_id=p_lab_organization_id and id=p_work_order_id
    for update;
    if not found then raise exception 'Work Order not found'; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'tooth_number',tooth_number,'work_type',work_type,'quantity',quantity,
        'contract',contract,'unit_price',unit_price,'subtotal',line_total,
        'price_source',price_source
    ) order by tooth_number),'[]'::jsonb)
    into v_before_lines
    from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id;

    if v_role='doctor' then
        if not public.doctor_matches_partner(v_order.nume_partener) then raise exception 'Work Order access denied'; end if;
        if v_order.locked then raise exception 'Work Order is locked'; end if;
        if lower(trim(coalesce(v_order.status,''))) <> 'not started' then
            raise exception 'Doctor can edit only Not Started Work Orders';
        end if;
    elsif v_role='technician' then
        if not public.can_access_work_order(p_lab_organization_id,p_work_order_id) then raise exception 'Work Order access denied'; end if;
        if v_order.locked then raise exception 'Work Order is locked'; end if;
    elsif not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    select count(*) into v_count from jsonb_array_elements(coalesce(p_items,'[]'::jsonb));
    if coalesce(v_count,0)=0 then raise exception 'At least one configured tooth is required'; end if;
    if exists (
        select 1
        from jsonb_array_elements(p_items) item
        where trim(coalesce(item->>'work_type','')) = ''
           or coalesce((item->>'tooth_number')::integer,0) / 10 not between 1 and 4
           or coalesce((item->>'tooth_number')::integer,0) % 10 not between 1 and 8
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

    select coalesce(jsonb_agg(jsonb_build_object('work_type',work_type,'quantity',quantity) order by work_type),'[]'::jsonb)
    into v_scope_before from (select work_type,sum(quantity) quantity from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id group by work_type) scope;

    with incoming as (
        select (item->>'tooth_number')::integer as tooth_number,
               trim(item->>'work_type') as work_type
        from jsonb_array_elements(p_items) item
    ), resolved as (
        select i.tooth_number,coalesce(old.work_type,i.work_type) as work_type,
               coalesce(old.quantity,1) as quantity,
               case when old.tooth_number is not null then old.line_total else round(price.pret,2) end as line_total,
               case when old.tooth_number is not null then old.contract
                    else coalesce(price.contract,'General') end as contract,
               case when old.tooth_number is not null then old.unit_price
                    else price.pret end as unit_price,
               case when old.tooth_number is not null then old.price_source
                    when price.pret is null then 'missing' else 'catalog' end as price_source,
               case when old.tooth_number is not null then old.price_fixed_at else now() end as price_fixed_at,
               case when old.tooth_number is not null then old.price_migrated else false end as price_migrated
        from incoming i
        left join public.lab_work_order_items old
          on old.lab_organization_id=p_lab_organization_id
         and old.work_order_id=p_work_order_id
         and old.tooth_number=i.tooth_number
         and lower(trim(old.work_type))=lower(i.work_type)
        left join lateral (
            select cp.contract,cp.pret
            from public.lab_contract_work_prices cp
            where cp.lab_organization_id=p_lab_organization_id
              and lower(trim(cp.tip_lucrare))=lower(i.work_type)
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
        ) price on true
    )
    insert into public.lab_work_order_items (
        lab_organization_id,work_order_id,tooth_number,work_type,contract,
        unit_price,quantity,line_total,price_source,price_fixed_at,price_migrated,
        created_by_user_id,updated_by_user_id,updated_at
    )
    select p_lab_organization_id,p_work_order_id,tooth_number,work_type,contract,
           unit_price,quantity,line_total,
           price_source,price_fixed_at,price_migrated,
           public.current_legacy_user_id(),public.current_legacy_user_id(),now()
    from resolved
    on conflict (lab_organization_id,work_order_id,tooth_number)
    do update set
        work_type=excluded.work_type,contract=excluded.contract,
        unit_price=excluded.unit_price,quantity=excluded.quantity,
        line_total=excluded.line_total,price_source=excluded.price_source,
        price_fixed_at=excluded.price_fixed_at,price_migrated=excluded.price_migrated,
        updated_by_user_id=excluded.updated_by_user_id,updated_at=now();

    delete from public.lab_work_order_items existing
    where existing.lab_organization_id=p_lab_organization_id
      and existing.work_order_id=p_work_order_id
      and not exists (
          select 1 from jsonb_array_elements(p_items) item
          where (item->>'tooth_number')::integer=existing.tooth_number
      );

    select contract into v_first_contract
    from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id
    order by tooth_number limit 1;

    select sum(quantity),
           case when bool_and(line_total is not null) then round(sum(line_total),2) else null end,
           coalesce(bool_and(unit_price is not null),false),
           coalesce(jsonb_agg(jsonb_build_object(
               'tooth_number',tooth_number,'work_type',work_type,'quantity',quantity,
               'contract',contract,'unit_price',unit_price,'subtotal',line_total,
               'matched',unit_price is not null,'price_source',price_source
           ) order by tooth_number),'[]'::jsonb),
           case when bool_and(price_source='admin_override') then 'admin_override'
                else 'item_snapshots' end,
           max(price_fixed_at)
      into v_count,v_list,v_matched_all,v_lines,v_order_price_source,v_order_price_fixed_at
    from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id;

    v_final := case when v_list is null then null
        else round(v_list*(1-(case when v_role='doctor' then 0 else v_order.discount end)/100),2) end;

    update public.lab_work_orders
    set contract=coalesce(v_first_contract,'General'),
        discount=case when v_role='doctor' then 0 else discount end,
        snapshot_list_price=v_list,snapshot_final_price=v_final,
        price_source=v_order_price_source,price_fixed_at=coalesce(v_order_price_fixed_at,now()),price_migrated=false,
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    where lab_organization_id=p_lab_organization_id and id=p_work_order_id;

    if (v_order.snapshot_list_price,v_order.snapshot_final_price,v_before_lines)
       is distinct from (v_list,v_final,v_lines) then
        insert into public.work_order_financial_audit (
            lab_organization_id,work_order_id,entity_type,entity_id,action,
            before_value,after_value,changed_by_user_id
        ) values (
            p_lab_organization_id,p_work_order_id,'work_order_price',p_work_order_id::text,
            'item_change',
            jsonb_build_object(
                'list_price',v_order.snapshot_list_price,'final_price',v_order.snapshot_final_price,
                'items',v_before_lines
            ),
            jsonb_build_object(
                'list_price',v_list,'final_price',v_final,'quantity',v_count,'items',v_lines
            ),auth.uid()
        );
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('work_type',work_type,'quantity',quantity) order by work_type),'[]'::jsonb)
    into v_scope_after from (select work_type,sum(quantity) quantity from public.lab_work_order_items
    where lab_organization_id=p_lab_organization_id and work_order_id=p_work_order_id group by work_type) scope;
    if v_scope_before is distinct from v_scope_after then
        perform public.adjust_work_order_scope_costs(p_lab_organization_id,p_work_order_id,v_scope_before,v_scope_after);
        insert into public.work_order_financial_audit(lab_organization_id,work_order_id,entity_type,entity_id,action,before_value,after_value,changed_by_user_id)
        values(p_lab_organization_id,p_work_order_id,'work_order_scope',p_work_order_id::text,'scope_change',v_scope_before,v_scope_after,auth.uid());
    end if;

    if v_role='technician' then
        return (select to_jsonb(scope) from public.work_order_item_scope(p_lab_organization_id,p_work_order_id,false) scope);
    end if;
    return jsonb_build_object(
        'lines',v_lines,'element_count',v_count,'list_price',v_list,
        'discount',case when v_role='doctor' then 0 else v_order.discount end,
        'final_price',v_final,'matched_all',v_matched_all,
        'partner_name',v_order.nume_partener
    );
end;
$$;

revoke all on function public.replace_work_order_items(uuid,bigint,jsonb,text) from public;
grant execute on function public.replace_work_order_items(uuid,bigint,jsonb,text) to authenticated;

-- Flowrise Supabase function: public.ai_mutate_work_order_role_safe(p_action text, p_payload jsonb)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.ai_mutate_work_order_role_safe(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_role text := public.effective_lab_role(public.get_flowrise_lab_id());
    v_action text := lower(trim(coalesce(p_action,'')));
    v_fields jsonb := coalesce(p_payload->'fields',p_payload,'{}'::jsonb);
    v_created bigint;
    v_ids jsonb;
    v_id bigint;
    v_id_text text;
    v_items jsonb;
begin
    if v_role in ('admin','manager') then
        return public.ai_mutate_work_order(p_action,p_payload);
    end if;

    if coalesce(v_role,'') <> 'technician' then
        return jsonb_build_object(
            'ok',false,
            'error','AI mutations are not enabled for this role'
        );
    end if;

    if v_action='update' then
        if exists(select 1 from jsonb_object_keys(v_fields) field
            where field not in ('items','case','ID','Status_Model','Status_Modelare','Status_Cer_Fin')) then
            raise exception 'Technician may edit only tooth scope, clinical case and assigned stage status';
        end if;
        v_ids:=coalesce(p_payload->'ids',jsonb_build_array(coalesce(p_payload->'id',p_payload->'target_id',v_fields->'ID')));
        if jsonb_typeof(v_ids)<>'array' or jsonb_array_length(v_ids)=0 or jsonb_array_length(v_ids)>100 then
            raise exception 'Supply between 1 and 100 Work Order IDs';
        end if;
        if jsonb_array_length(v_ids)>1 and not coalesce((p_payload->>'bulk_explicit')::boolean,false) then
            raise exception 'Multiple Work Orders require bulk_explicit=true';
        end if;
        for v_id_text in select jsonb_array_elements_text(v_ids) loop
            v_id:=v_id_text::bigint;
            if not public.can_access_work_order(v_lab,v_id) then raise exception 'Work Order access denied'; end if;
            -- Lock before reading unchanged scope so a metadata-only edit cannot restore stale items.
            perform 1 from public.lab_work_orders where lab_organization_id=v_lab and id=v_id for update;
            if not found then raise exception 'Work Order not found'; end if;
            if v_fields ? 'items' then v_items:=v_fields->'items';
            else select scope.items into v_items from public.work_order_item_scope(v_lab,v_id,false) scope; end if;
            perform public.save_my_work_order_case(v_lab,v_id,
                v_fields->>'Status_Model',v_fields->>'Status_Modelare',v_fields->>'Status_Cer_Fin',
                v_items,coalesce(v_fields->'case','{}'::jsonb));
        end loop;
        return jsonb_build_object('ok',true,'type','update_work_order','ids',v_ids,'count',jsonb_array_length(v_ids));
    end if;

    if v_action not in ('create') then
        return jsonb_build_object(
            'ok',false,
            'error','Technician AI may create or update accessible Work Orders, but may not delete them'
        );
    end if;

    -- Technician-supplied commercial fields are ignored deliberately.
    -- Contract / Status / Discount / payment fields are controlled server-side.
    begin
        v_created := public.create_technician_work_order(
            v_lab,
            nullif(v_fields->>'Deadline','')::date,
            coalesce(v_fields->>'Nume_Pacient',''),
            coalesce(v_fields->>'Nume_Partener',''),
            v_fields->'items',
            nullif(v_fields->>'Data_Receptie','')::timestamptz,
            coalesce(
                nullif(v_fields->>'My_Stage',''),
                nullif(p_payload->>'my_stage',''),
                'Model'
            ),
            coalesce(v_fields->'case','{}'::jsonb)
        );
    exception
        when others then
            return jsonb_build_object(
                'ok',false,
                'error',sqlerrm
            );
    end;

    return jsonb_build_object(
        'ok',true,
        'type','create_work_order',
        'ids',jsonb_build_array(v_created)
    );
exception when others then
    -- A failed bulk row rolls back every earlier row in the same operation.
    return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_action text, p_payload jsonb
REVOKE ALL ON FUNCTION public.ai_mutate_work_order_role_safe(text,jsonb) FROM public,authenticated;

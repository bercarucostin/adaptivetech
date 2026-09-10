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
begin
    if v_role in ('admin','manager') then
        return public.ai_mutate_work_order(p_action,p_payload);
    end if;

    if v_role <> 'technician' then
        return jsonb_build_object(
            'ok',false,
            'error','AI mutations are not enabled for this role'
        );
    end if;

    if v_action <> 'create' then
        return jsonb_build_object(
            'ok',false,
            'error','Technician AI may create Work Orders but may not update or delete them'
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
            coalesce(v_fields->>'Tip_Lucrare',''),
            coalesce(nullif(v_fields->>'Nr_Elemente','')::integer,1),
            nullif(v_fields->>'Data_Receptie','')::timestamptz,
            coalesce(
                nullif(v_fields->>'My_Stage',''),
                nullif(p_payload->>'my_stage',''),
                'Model'
            )
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
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_action text, p_payload jsonb
REVOKE ALL ON FUNCTION public.ai_mutate_work_order_role_safe(text,jsonb) FROM public,authenticated;

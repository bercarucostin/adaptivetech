-- Flowrise Supabase function: public.ai_read_datasets(p_datasets text[], p_limit integer)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.ai_read_datasets(p_datasets text[], p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_dataset text;
    v_result jsonb := '{}'::jsonb;
    v_role text := public.effective_lab_role(public.get_flowrise_lab_id());
    v_max_datasets integer;
begin
    if p_datasets is null or cardinality(p_datasets)=0 then
        return jsonb_build_object(
            'role',v_role,
            'datasets','{}'::jsonb
        );
    end if;

    v_max_datasets := case
        when v_role in ('admin','manager') then 20
        when v_role='technician' then 3
        else 0
    end;

    if cardinality(p_datasets) > v_max_datasets then
        raise exception 'Too many datasets requested for role';
    end if;

    foreach v_dataset in array p_datasets
    loop
        v_result := v_result || jsonb_build_object(
            lower(trim(v_dataset)),
            public.ai_read_dataset(v_dataset,p_limit,0)
        );
    end loop;

    return jsonb_build_object(
        'role',v_role,
        'datasets',v_result
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_datasets text[], p_limit integer

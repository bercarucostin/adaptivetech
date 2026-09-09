-- Flowrise Supabase function: public.ai_technician_work_types()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.ai_technician_work_types()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
begin
    if public.effective_lab_role(v_lab) <> 'technician' then
        raise exception 'Technician access required';
    end if;

    return (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'Tip_Lucrare',wt.tip_lucrare
                )
                order by wt.tip_lucrare
            ),
            '[]'::jsonb
        )
        from public.lab_work_types wt
        where wt.lab_organization_id = v_lab
          and wt.active = true
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: 

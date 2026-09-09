-- Flowrise Supabase function: public.is_connected_doctor_for_lab(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.is_connected_doctor_for_lab(p_lab_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select public.connected_clinic_for_lab(p_lab_organization_id) is not null;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid

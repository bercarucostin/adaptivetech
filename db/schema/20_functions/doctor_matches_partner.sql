-- Flowrise Supabase function: public.doctor_matches_partner(p_partner_name text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.doctor_matches_partner(p_partner_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.active = true
          and (
              lower(trim(coalesce(p.legacy_partner_name,''))) =
                  lower(trim(coalesce(p_partner_name,'')))
              or lower(trim(coalesce(p.display_name,''))) =
                  lower(trim(coalesce(p_partner_name,'')))
              or lower(trim(coalesce(p.legacy_user_id,''))) =
                  lower(trim(coalesce(p_partner_name,'')))
          )
    );
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_partner_name text

-- Flowrise Supabase function: public.may_edit_public_prices()
-- Whether the caller may edit the public price list. A convenience for the admin
-- panel, which needs the answer before it renders an editor; it introduces no new
-- permission concept and role_permissions is untouched.

CREATE OR REPLACE FUNCTION public.may_edit_public_prices()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(public.is_lab_management(public.get_flowrise_lab_id()), false);
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments:

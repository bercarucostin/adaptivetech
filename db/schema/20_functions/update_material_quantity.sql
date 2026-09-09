-- Flowrise Supabase function: public.update_material_quantity(p_lab_organization_id uuid, p_material_id bigint, p_quantity numeric)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.update_material_quantity(p_lab_organization_id uuid, p_material_id bigint, p_quantity numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_quantity numeric(14,3);
begin
    if not (
        public.is_lab_management(p_lab_organization_id)
        or public.is_lab_technician(p_lab_organization_id)
    ) then
        raise exception 'Material quantity update denied';
    end if;

    if p_quantity is null or p_quantity < 0 then
        raise exception 'Quantity must be zero or greater';
    end if;

    update public.lab_materials_inventory
    set
        cantitate = round(p_quantity::numeric,3),
        ultima_actualizare = now(),
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and id = p_material_id
    returning cantitate into v_quantity;

    if not found then
        raise exception 'Material not found';
    end if;

    return v_quantity;
end;
$function$
;

-- Security definer: True
-- Return type: numeric
-- Identity arguments: p_lab_organization_id uuid, p_material_id bigint, p_quantity numeric

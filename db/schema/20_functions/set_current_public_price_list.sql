-- Flowrise Supabase function: public.set_current_public_price_list(p_version_id uuid)
-- Restores an earlier published version by making it current again. It does not
-- copy or rewrite the version -- history stays exactly as it was published.

CREATE OR REPLACE FUNCTION public.set_current_public_price_list(p_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_exists boolean;
begin
    if v_lab is null then
        raise exception 'Laboratorul nu este configurat.';
    end if;

    if not public.is_lab_management(v_lab) then
        raise exception 'Doar administratorii sau managerii pot modifica prețurile publice.';
    end if;

    -- Serialize every publish and restore for this lab; see publish_public_price_list
    -- for why a raw row lock alone is not enough to make concurrent writers safe.
    perform pg_advisory_xact_lock(hashtextextended('public_price_lists:' || v_lab::text, 0));

    select true
      into v_exists
      from public.public_price_lists
     where id = p_version_id
       and lab_organization_id = v_lab
       for update;

    if not coalesce(v_exists, false) then
        raise exception 'Versiunea cerută nu există.';
    end if;

    update public.public_price_lists
       set is_current = false
     where lab_organization_id = v_lab
       and is_current
       and id <> p_version_id;

    update public.public_price_lists
       set is_current = true
     where id = p_version_id
       and lab_organization_id = v_lab;

    return p_version_id;
end;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_version_id uuid

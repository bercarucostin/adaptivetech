-- Flowrise Supabase function: public.publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid)
-- Publishes a new version of the public price list and makes it the current one,
-- in one transaction, so a visitor can never read a half-updated list.
--
-- p_expected_current is the version the editor had loaded. When it no longer
-- matches, the publish raises instead of overwriting: two managers editing at the
-- same time must not lose each other's work silently. The SELECT ... FOR UPDATE
-- is what makes that check race-free -- a concurrent publish blocks there, and
-- when it proceeds the row it waited for no longer qualifies as current.

CREATE OR REPLACE FUNCTION public.publish_public_price_list(p_document jsonb, p_note text DEFAULT NULL::text, p_expected_current uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_current uuid;
    v_id uuid;
begin
    if v_lab is null then
        raise exception 'Laboratorul nu este configurat.';
    end if;

    if not public.is_lab_management(v_lab) then
        raise exception 'Doar administratorii sau managerii pot publica prețurile publice.';
    end if;

    if not public.public_price_document_is_valid(p_document) then
        raise exception 'Lista de prețuri nu are un format valid.';
    end if;

    -- Known race, accepted: when no current row exists yet (first-ever publish
    -- for this lab), this locks nothing, so two concurrent first publishes can
    -- both see v_current as NULL, both pass the expected-version check below,
    -- and both attempt an insert with is_current = true. The partial unique
    -- index public_price_lists_one_current rejects the second insert, so data
    -- integrity holds either way -- the loser just gets a raw unique-violation
    -- error instead of the friendly one below. Acceptable for a first publish,
    -- which happens once per lab.
    select id
      into v_current
      from public.public_price_lists
     where lab_organization_id = v_lab
       and is_current
       for update;

    if coalesce(v_current::text, '') <> coalesce(p_expected_current::text, '') then
        raise exception 'Lista a fost modificată de altcineva. Reîncarcă pagina înainte de a publica.';
    end if;

    update public.public_price_lists
       set is_current = false
     where lab_organization_id = v_lab
       and is_current;

    insert into public.public_price_lists (lab_organization_id, document, is_current, note, created_by)
    values (v_lab, p_document, true, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;

    return v_id;
end;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_document jsonb, p_note text, p_expected_current uuid

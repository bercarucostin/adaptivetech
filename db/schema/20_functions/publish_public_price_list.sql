-- Flowrise Supabase function: public.publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid)
-- Publishes a new version of the public price list and makes it the current one,
-- in one transaction, so a visitor can never read a half-updated list.
--
-- p_expected_current is the version the editor had loaded. When it no longer
-- matches, the publish raises instead of overwriting: two managers editing at the
-- same time must not lose each other's work silently. A per-lab advisory
-- transaction lock (taken right after the management gate, before either the
-- current row or the document is looked at) is what makes that check race-free:
-- it fully serializes publishes and restores for a lab, so a waiter is never
-- left mid-race with a stale, NULL-defaulting view of "current". The
-- SELECT ... FOR UPDATE that follows is then just the ordinary read of the row
-- to compare against p_expected_current.

CREATE OR REPLACE FUNCTION public.publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid)
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

    -- Serialize every publish and restore for this lab. Without it, a waiter that
    -- acquires the row lock after a concurrent publish commits sees neither the
    -- demoted row nor the new one, and a null expectation then passes a check that
    -- exists precisely to stop one manager overwriting another. With the lock in
    -- place, every race for this lab resolves into the friendly stale-version
    -- message below rather than a raw unique-violation on the one-current index.
    perform pg_advisory_xact_lock(hashtextextended('public_price_lists:' || v_lab::text, 0));

    if not public.public_price_document_is_valid(p_document) then
        raise exception 'Lista de prețuri nu are un format valid.';
    end if;

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

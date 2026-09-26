-- Flowrise Supabase function: public.get_public_price_list_history()
-- The published version history of the public price list, newest first, with the
-- publisher's name resolved.
--
-- It exists because the name cannot be read from the browser. The only policy on
-- public.profiles is `for select to authenticated using (id = auth.uid())`, so a
-- PostgREST embed of profiles:created_by returns a row only when the signed-in
-- manager is the publisher. Every version somebody else published came back with
-- a null profile and lost its attribution silently -- the exact case the history
-- exists for, and one that looks correct in testing, because a tester sees their
-- own publishes.
--
-- SECURITY DEFINER rather than a wider profiles policy: the whole application
-- authorizes on profiles, and widening it to serve one admin panel is the larger
-- blast radius. This reads two columns of it, for management of one lab only.

CREATE OR REPLACE FUNCTION public.get_public_price_list_history()
 RETURNS TABLE(id uuid, document jsonb, is_current boolean, note text, created_at timestamp with time zone, published_by text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
begin
    if v_lab is null then
        raise exception 'Laboratorul nu este configurat.';
    end if;

    if not public.is_lab_management(v_lab) then
        raise exception 'Doar administratorii sau managerii pot vedea istoricul prețurilor publice.';
    end if;

    -- Every column is alias-qualified: with RETURNS TABLE the output names are
    -- plpgsql variables, so a bare `id` or `note` here would be ambiguous.
    return query
        select l.id,
               l.document,
               l.is_current,
               l.note,
               l.created_at,
               -- display_name first, username as the fallback, null when nobody is
               -- recorded. nullif on each so a blank display_name falls through to
               -- the username instead of rendering as an empty author.
               -- username is citext; cast it explicitly rather than leaning on the
               -- implicit citext->text cast to resolve btrim().
               coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username::text), ''))::text
          from public.public_price_lists l
          left join public.profiles p on p.id = l.created_by
         where l.lab_organization_id = v_lab
         order by l.created_at desc, l.id desc;
end;
$function$
;

-- Security definer: True
-- Return type: TABLE(id uuid, document jsonb, is_current boolean, note text, created_at timestamp with time zone, published_by text)
-- Identity arguments:

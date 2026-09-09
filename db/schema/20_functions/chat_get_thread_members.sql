-- Flowrise Supabase function: public.chat_get_thread_members(p_thread_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_get_thread_members(p_thread_id uuid)
 RETURNS TABLE(user_id uuid, username text, display_name text, role text, organization_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        p.id,
        p.username::text,
        coalesce(p.display_name,p.username)::text,
        coalesce(meta.role,'')::text,
        coalesce(meta.organization_name,'')::text
    from public.chat_thread_participants tp
    join public.profiles p on p.id=tp.user_id
    left join lateral (
        select
            initcap(m.role)::text as role,
            o.name::text as organization_name
        from public.organization_memberships m
        join public.organizations o on o.id=m.organization_id
        where m.user_id=p.id
          and m.status='active'
          and lower(m.role) in ('admin','manager','technician','doctor')
        order by
            case lower(m.role)
                when 'admin' then 1
                when 'manager' then 2
                when 'technician' then 3
                when 'doctor' then 4
                else 9
            end,
            o.name
        limit 1
    ) meta on true
    where tp.thread_id=p_thread_id
      and public.chat_is_thread_participant(p_thread_id)
    order by coalesce(p.display_name,p.username::text);
$function$
;

-- Security definer: True
-- Return type: TABLE(user_id uuid, username text, display_name text, role text, organization_name text)
-- Identity arguments: p_thread_id uuid

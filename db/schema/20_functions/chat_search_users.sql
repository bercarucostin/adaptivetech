-- Flowrise Supabase function: public.chat_search_users(p_query text, p_limit integer)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_search_users(p_query text DEFAULT ''::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, username text, display_name text, role text, organization_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with candidates as (
        select
            p.id as user_id,
            p.username::text,
            coalesce(p.display_name,p.username)::text as display_name
        from public.profiles p
        where p.active = true
          and p.id <> auth.uid()
          and public.chat_can_message(p.id)
          and (
              trim(coalesce(p_query,'')) = ''
              or lower(coalesce(p.display_name,'')) like '%'||lower(trim(p_query))||'%'
              or lower(coalesce(p.username::text,'')) like '%'||lower(trim(p_query))||'%'
              or lower(coalesce(p.legacy_user_id,'')) like '%'||lower(trim(p_query))||'%'
          )
        order by coalesce(p.display_name,p.username::text)
        limit greatest(1,least(coalesce(p_limit,30),100))
    )
    select
        c.user_id,
        c.username,
        c.display_name,
        coalesce(meta.role,'')::text,
        coalesce(meta.organization_name,'')::text
    from candidates c
    left join lateral (
        select
            initcap(m.role)::text as role,
            o.name::text as organization_name
        from public.organization_memberships m
        join public.organizations o on o.id=m.organization_id
        where m.user_id=c.user_id
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
    order by c.display_name;
$function$
;

-- Security definer: True
-- Return type: TABLE(user_id uuid, username text, display_name text, role text, organization_name text)
-- Identity arguments: p_query text, p_limit integer

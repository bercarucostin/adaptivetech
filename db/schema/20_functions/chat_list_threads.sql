-- Flowrise Supabase function: public.chat_list_threads()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_list_threads()
 RETURNS TABLE(thread_id uuid, thread_type text, title text, other_user_id uuid, username text, display_name text, role text, organization_name text, member_count integer, last_message text, last_message_at timestamp with time zone, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        t.id as thread_id,
        t.thread_type,
        t.title,
        case when t.thread_type='direct' then other_p.user_id else null end as other_user_id,
        case when t.thread_type='direct' then other_profile.username::text else null end as username,
        case
            when t.thread_type='group' then t.title::text
            else coalesce(other_profile.display_name,other_profile.username)::text
        end as display_name,
        case when t.thread_type='group' then 'Grup'::text else coalesce(meta.role,'')::text end as role,
        case
            when t.thread_type='group' then (participant_stats.member_count::text || ' membri')::text
            else coalesce(meta.organization_name,'')::text
        end as organization_name,
        participant_stats.member_count,
        coalesce(
            last_m.body,
            case when exists (
                select 1 from public.chat_attachments a where a.message_id=last_m.id
            ) then '📎 Fișier' else '' end
        )::text as last_message,
        t.last_message_at,
        (
            select count(*)
            from public.chat_messages um
            where um.thread_id=t.id
              and um.sender_id<>auth.uid()
              and um.created_at > coalesce(me_p.last_read_at,'1970-01-01'::timestamptz)
        )::bigint as unread_count
    from public.chat_threads t
    join public.chat_thread_participants me_p
      on me_p.thread_id=t.id
     and me_p.user_id=auth.uid()
    left join lateral (
        select p.user_id
        from public.chat_thread_participants p
        where p.thread_id=t.id
          and p.user_id<>auth.uid()
        order by p.joined_at,p.user_id
        limit 1
    ) other_p on true
    left join public.profiles other_profile
      on other_profile.id=other_p.user_id
    left join lateral (
        select
            initcap(m.role)::text as role,
            o.name::text as organization_name
        from public.organization_memberships m
        join public.organizations o on o.id=m.organization_id
        where m.user_id=other_p.user_id
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
    left join lateral (
        select m.id,m.body,m.created_at
        from public.chat_messages m
        where m.thread_id=t.id
        order by m.created_at desc,m.id desc
        limit 1
    ) last_m on true
    join lateral (
        select count(*)::integer as member_count
        from public.chat_thread_participants p
        where p.thread_id=t.id
    ) participant_stats on true
    order by t.last_message_at desc nulls last,t.created_at desc;
$function$
;

-- Security definer: True
-- Return type: TABLE(thread_id uuid, thread_type text, title text, other_user_id uuid, username text, display_name text, role text, organization_name text, member_count integer, last_message text, last_message_at timestamp with time zone, unread_count bigint)
-- Identity arguments: 

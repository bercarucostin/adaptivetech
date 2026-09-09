-- Flowrise Supabase function: public.chat_create_group(p_title text, p_participant_ids uuid[])
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_create_group(p_title text, p_participant_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_me uuid := auth.uid();
    v_title text := trim(coalesce(p_title,''));
    v_members uuid[];
    v_thread uuid;
    v_member uuid;
    v_i integer;
    v_j integer;
    v_n integer;
begin
    if v_me is null then
        raise exception 'Authentication required';
    end if;

    if char_length(v_title) < 2 or char_length(v_title) > 80 then
        raise exception 'Group name must have 2-80 characters';
    end if;

    select array_agg(distinct x)
      into v_members
    from unnest(array_append(coalesce(p_participant_ids,'{}'::uuid[]),v_me)) x
    where x is not null;

    v_n := coalesce(array_length(v_members,1),0);

    if v_n < 2 then
        raise exception 'Select at least one other participant';
    end if;

    if v_n > 25 then
        raise exception 'Maximum 25 participants per group';
    end if;

    -- Every member must be an active, non-dashboard human account.
    foreach v_member in array v_members
    loop
        if not exists (
            select 1
            from public.profiles p
            where p.id=v_member and p.active=true
        ) then
            raise exception 'One selected account is inactive';
        end if;

        if not exists (
            select 1
            from public.organization_memberships m
            where m.user_id=v_member
              and m.status='active'
              and lower(m.role) in ('admin','manager','technician','doctor')
        ) then
            raise exception 'One selected account is not eligible for chat';
        end if;
    end loop;

    -- Important: the group must not create a route between two users who could
    -- not have a direct conversation under their role rules.
    if v_n > 1 then
        for v_i in 1..v_n loop
            if v_i < v_n then
                for v_j in (v_i+1)..v_n loop
                    if not public.chat_users_can_share_thread(v_members[v_i],v_members[v_j]) then
                        raise exception 'The selected people cannot all share the same group under the current communication rules';
                    end if;
                end loop;
            end if;
        end loop;
    end if;

    insert into public.chat_threads(
        thread_type,direct_key,title,created_by,created_at,last_message_at
    )
    values (
        'group',null,v_title,v_me,now(),null
    )
    returning id into v_thread;

    foreach v_member in array v_members
    loop
        insert into public.chat_thread_participants(
            thread_id,user_id,joined_at,last_read_at
        )
        values (
            v_thread,
            v_member,
            now(),
            case when v_member=v_me then now() else null end
        );
    end loop;

    return v_thread;
end;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_title text, p_participant_ids uuid[]

-- Apply after 20261001_lab_partner_orders.sql. Run inside a transaction.
-- Partner edits are allowed before production, and always require reapproval.
UPDATE public.role_permissions SET can_view_production=true
WHERE lower(trim(role)) IN ('lab partner','lab_partner');

ALTER TABLE public.lab_work_orders ADD COLUMN IF NOT EXISTS submission_revision bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.lab_partner_identity(p_lab uuid)
RETURNS TABLE(partner_id uuid, partner_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF coalesce(public.effective_lab_role(p_lab),'') NOT IN ('lab partner','lab_partner') THEN
   RAISE EXCEPTION 'Lab Partner access denied';
 END IF;
 RETURN QUERY SELECT p.id,p.name FROM public.lab_partner_user_links l
 JOIN public.lab_partners p ON p.id=l.partner_id AND p.lab_organization_id=l.lab_organization_id AND p.active
 WHERE l.lab_organization_id=p_lab AND l.user_id=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.lab_partner_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lab_partner_identity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lab_partner_can_access_order(p_lab uuid,p_order bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(public.effective_lab_role(p_lab) IN ('lab partner','lab_partner')
 AND EXISTS (SELECT 1 FROM public.lab_work_orders o
 JOIN public.lab_partner_user_links l ON l.lab_organization_id=o.lab_organization_id AND l.partner_id=o.partner_id
 JOIN public.lab_partners p ON p.id=l.partner_id AND p.lab_organization_id=l.lab_organization_id AND p.active
 WHERE o.lab_organization_id=p_lab AND o.id=p_order AND l.user_id=auth.uid()),false);
$$;
REVOKE ALL ON FUNCTION public.lab_partner_can_access_order(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lab_partner_can_access_order(uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.lab_partner_order_is_editable(p_lab uuid,p_order bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.lab_partner_can_access_order(p_lab,p_order) AND EXISTS (
  SELECT 1 FROM public.lab_work_orders o WHERE o.lab_organization_id=p_lab AND o.id=p_order
   AND o.order_origin='lab_partner' AND o.archived_at IS NULL AND NOT o.locked
   AND o.status='Not Started'
   AND coalesce(o.status_model,'Not Started')='Not Started'
   AND coalesce(o.status_modelare,'Not Started')='Not Started'
   AND coalesce(o.status_cer_fin,'Not Started')='Not Started'
 );
$$;
REVOKE ALL ON FUNCTION public.lab_partner_order_is_editable(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lab_partner_order_is_editable(uuid,bigint) TO authenticated;

-- Management may lock pending orders. Existing technician assignments survive
-- reapproval, but no unapproved order may start production or acquire assignments.
CREATE OR REPLACE FUNCTION public.guard_external_order_production()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.order_origin IN ('doctor','lab_partner') AND NEW.approval_state<>'approved' THEN
  IF NEW.status<>'Not Started' OR
     coalesce(NEW.status_model,'Not Started')<>'Not Started' OR
     coalesce(NEW.status_modelare,'Not Started')<>'Not Started' OR
     coalesce(NEW.status_cer_fin,'Not Started')<>'Not Started' OR NEW.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'Order must be approved before production';
  END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.tehnician_model IS NOT NULL OR NEW.tehnician1_modelare IS NOT NULL OR NEW.tehnician2_cer_fin IS NOT NULL THEN
    RAISE EXCEPTION 'Order must be approved before assigning technicians';
   END IF;
  ELSIF (NEW.tehnician_model IS DISTINCT FROM OLD.tehnician_model AND NEW.tehnician_model IS NOT NULL)
     OR (NEW.tehnician1_modelare IS DISTINCT FROM OLD.tehnician1_modelare AND NEW.tehnician1_modelare IS NOT NULL)
     OR (NEW.tehnician2_cer_fin IS DISTINCT FROM OLD.tehnician2_cer_fin AND NEW.tehnician2_cer_fin IS NOT NULL) THEN
   RAISE EXCEPTION 'Order must be approved before assigning technicians';
  END IF;
 END IF;
 RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION public.resubmit_lab_partner_work_order
(p_lab uuid,p_order bigint,p_deadline_at timestamptz,p_items jsonb,p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.lab_work_orders%rowtype; v_quote jsonb;
BEGIN
 SELECT * INTO v_order FROM public.lab_work_orders
 WHERE lab_organization_id=p_lab AND id=p_order FOR UPDATE;
 IF NOT FOUND OR public.lab_partner_order_is_editable(p_lab,p_order) IS NOT TRUE THEN
   RAISE EXCEPTION 'Order cannot be edited';
 END IF;
 v_quote:=public.lab_partner_quote(p_lab,p_items,p_deadline_at);
 UPDATE public.lab_work_orders SET
   deadline=(p_deadline_at AT TIME ZONE 'Europe/Bucharest')::date,deadline_at=p_deadline_at,
   approval_state='pending',submission_revision=submission_revision+1,approval_reason=NULL,approval_reviewed_at=NULL,
   approval_reviewed_by_user_id=NULL,snapshot_list_price=(v_quote->>'final_price')::numeric,
   snapshot_final_price=(v_quote->>'final_price')::numeric,price_fixed_at=now(),
   updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
 WHERE lab_organization_id=p_lab AND id=p_order;
 PERFORM public.save_lab_partner_lines(p_lab,p_order,v_quote,p_note);
 INSERT INTO public.lab_work_order_approval_events(lab_organization_id,work_order_id,state,actor_user_id)
 VALUES(p_lab,p_order,'pending',auth.uid());
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.resubmit_lab_partner_work_order(uuid,bigint,timestamptz,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resubmit_lab_partner_work_order(uuid,bigint,timestamptz,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_lab_partner_work_orders(p_lab uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_partner uuid; v_rows jsonb;
BEGIN
 SELECT partner_id INTO v_partner FROM public.lab_partner_identity(p_lab);
 IF v_partner IS NULL THEN RAISE EXCEPTION 'Lab Partner mapping is missing'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'deadline',o.deadline,'deadline_at',o.deadline_at,
  'status',o.status,'locked',o.locked,
  'can_edit',public.lab_partner_order_is_editable(p_lab,o.id),'submission_revision',o.submission_revision,'partner',o.nume_partener,'approval_state',o.approval_state,
  'approval_reason',o.approval_reason,'approval_reviewed_at',o.approval_reviewed_at,
  'final_price',o.snapshot_final_price,'created_at',o.created_at,
  'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no)
    FROM public.lab_partner_work_order_items i WHERE i.lab_organization_id=p_lab AND i.work_order_id=o.id),'[]'::jsonb)
 ) ORDER BY o.id DESC),'[]'::jsonb) INTO v_rows
 FROM public.lab_work_orders o WHERE o.lab_organization_id=p_lab AND o.partner_id=v_partner
   AND o.order_origin='lab_partner' AND o.archived_at IS NULL;
 RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.list_lab_partner_work_orders(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_lab_partner_work_orders(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_lab_partner_work_order(p_lab uuid,p_order bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 IF public.lab_partner_can_access_order(p_lab,p_order) IS NOT TRUE AND public.is_lab_management(p_lab) IS NOT TRUE THEN
   RAISE EXCEPTION 'Order access denied';
 END IF;
 SELECT jsonb_build_object('id',o.id,'deadline_at',o.deadline_at,'status',o.status,'locked',o.locked,
  'can_edit',public.lab_partner_order_is_editable(p_lab,o.id),'submission_revision',o.submission_revision,
  'approval_state',o.approval_state,'approval_reason',o.approval_reason,
  'approval_reviewed_at',o.approval_reviewed_at,'final_price',o.snapshot_final_price,
  'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no)
      FROM public.lab_partner_work_order_items i WHERE i.lab_organization_id=p_lab AND i.work_order_id=p_order),'[]'::jsonb),
  'price_lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no)
      FROM public.lab_partner_work_order_price_lines l WHERE l.lab_organization_id=p_lab AND l.work_order_id=p_order),'[]'::jsonb))
 INTO v_result FROM public.lab_work_orders o WHERE o.lab_organization_id=p_lab AND o.id=p_order
  AND o.order_origin='lab_partner';
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_lab_partner_work_order(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lab_partner_work_order(uuid,bigint) TO authenticated;

-- Flowrise Supabase function: public.chat_can_message_as(p_from_user uuid, p_other_user uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_can_message_as(p_from_user uuid, p_other_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if p_from_user is null
       or p_other_user is null
       or p_from_user = p_other_user then
        return false;
    end if;

    if not exists (
        select 1 from public.profiles p
        where p.id=p_from_user and p.active=true
    ) or not exists (
        select 1 from public.profiles p
        where p.id=p_other_user and p.active=true
    ) then
        return false;
    end if;

    -- Lab Partner: only active management of the laboratory that owns its link.
    if exists (
        select 1 from public.organization_memberships m
        where m.user_id=p_from_user and m.status='active'
          and lower(trim(m.role)) in ('lab partner','lab_partner')
    ) then
        return exists (
            select 1 from public.organization_memberships me
            join public.lab_partner_user_links link
              on link.lab_organization_id=me.organization_id and link.user_id=me.user_id
            join public.lab_partners partner
              on partner.id=link.partner_id and partner.lab_organization_id=link.lab_organization_id and partner.active
            join public.organization_memberships other_m
              on other_m.organization_id=me.organization_id and other_m.user_id=p_other_user
            where me.user_id=p_from_user and me.status='active'
              and lower(trim(me.role)) in ('lab partner','lab_partner')
              and other_m.status='active' and lower(trim(other_m.role)) in ('admin','manager')
        );
    end if;

    -- Admin / Manager can initiate broadly. Pairwise compatibility below still
    -- protects the stricter rules of the recipient.
    if exists (
        select 1
        from public.organization_memberships m
        where m.user_id=p_from_user
          and m.status='active'
          and lower(m.role) in ('admin','manager')
    ) then
        return exists (
            select 1
            from public.organization_memberships m
            where m.user_id=p_other_user
              and m.status='active'
              and lower(m.role) in ('admin','manager','technician','doctor','lab partner','lab_partner')
        );
    end if;

    -- Technician: same laboratory only, and only lab staff.
    if exists (
        select 1
        from public.organization_memberships m
        join public.organizations o on o.id=m.organization_id
        where m.user_id=p_from_user
          and m.status='active'
          and lower(m.role)='technician'
          and o.organization_type='lab'
    ) then
        return exists (
            select 1
            from public.organization_memberships me
            join public.organizations lab on lab.id=me.organization_id
            join public.organization_memberships other_m
              on other_m.organization_id=me.organization_id
            where me.user_id=p_from_user
              and me.status='active'
              and lower(me.role)='technician'
              and lab.organization_type='lab'
              and other_m.user_id=p_other_user
              and other_m.status='active'
              and lower(other_m.role) in ('admin','manager','technician')
        );
    end if;

    -- Doctor: only Admin / Manager of an actively connected laboratory.
    if exists (
        select 1
        from public.organization_memberships m
        where m.user_id=p_from_user
          and m.status='active'
          and lower(m.role)='doctor'
    ) then
        return exists (
            select 1
            from public.organization_memberships doctor_m
            join public.organizations clinic
              on clinic.id=doctor_m.organization_id
             and clinic.organization_type='clinic'
            join public.organization_relationships r
              on r.clinic_organization_id=clinic.id
             and lower(r.status::text)='active'
            join public.organization_memberships lab_m
              on lab_m.organization_id=r.lab_organization_id
             and lab_m.user_id=p_other_user
             and lab_m.status='active'
             and lower(lab_m.role) in ('admin','manager')
            where doctor_m.user_id=p_from_user
              and doctor_m.status='active'
              and lower(doctor_m.role)='doctor'
        );
    end if;

    return false;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_from_user uuid, p_other_user uuid


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
              and lower(m.role) in ('admin','manager','technician','doctor','lab partner','lab_partner')
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
          and lower(m.role) in ('admin','manager','technician','doctor','lab partner','lab_partner')
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
          and lower(m.role) in ('admin','manager','technician','doctor','lab partner','lab_partner')
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
          and lower(m.role) in ('admin','manager','technician','doctor','lab partner','lab_partner')
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


CREATE OR REPLACE FUNCTION public.get_work_order_approval_summary(p_lab uuid,p_orders bigint[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR coalesce(array_length(p_orders,1),0)>200 THEN RAISE EXCEPTION 'Invalid request'; END IF;
 SELECT coalesce(jsonb_object_agg(o.id::text,jsonb_build_object(
  'state',o.approval_state,'origin',o.order_origin,'submission_revision',o.submission_revision,'reason',o.approval_reason,
  'reviewed_at',o.approval_reviewed_at,'reviewed_by',o.approval_reviewed_by_user_id,
  'deadline_at',o.deadline_at)),'{}'::jsonb)
 INTO v_result FROM public.lab_work_orders o WHERE o.lab_organization_id=p_lab
 AND o.id=ANY(p_orders) AND public.can_access_work_order(p_lab,o.id);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_work_order_approval_summary(uuid,bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_work_order_approval_summary(uuid,bigint[]) TO authenticated;

DROP FUNCTION IF EXISTS public.review_external_work_order(uuid,bigint,text,text);
CREATE OR REPLACE FUNCTION public.review_external_work_order
(p_lab uuid,p_order bigint,p_decision text,p_reason text DEFAULT NULL,p_expected_revision bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state text:=lower(trim(p_decision)); v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
BEGIN
 IF public.is_lab_management(p_lab) IS NOT TRUE THEN RAISE EXCEPTION 'Management access denied'; END IF;
 IF v_state IS NULL OR v_state NOT IN ('approve','reject') OR length(coalesce(v_reason,''))>1000 THEN
   RAISE EXCEPTION 'Invalid review decision or reason';
 END IF;
 UPDATE public.lab_work_orders SET
   approval_state=CASE WHEN v_state='approve' THEN 'approved' ELSE 'rejected' END,
   approval_reviewed_at=now(),approval_reviewed_by_user_id=auth.uid(),approval_reason=v_reason,
   updated_at=now()
 WHERE lab_organization_id=p_lab AND id=p_order AND order_origin IN ('doctor','lab_partner')
   AND approval_state='pending'
   AND (submission_revision=p_expected_revision OR (p_expected_revision IS NULL AND order_origin<>'lab_partner'));
 IF NOT FOUND THEN RAISE EXCEPTION 'Order changed or is not awaiting approval. Refresh it before reviewing'; END IF;
 INSERT INTO public.lab_work_order_approval_events
 (lab_organization_id,work_order_id,state,reason,actor_user_id)
 VALUES(p_lab,p_order,CASE WHEN v_state='approve' THEN 'approved' ELSE 'rejected' END,v_reason,auth.uid());
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.review_external_work_order(uuid,bigint,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_external_work_order(uuid,bigint,text,text,bigint) TO authenticated;


-- Revalidate communication rules when sending, including established threads.
CREATE OR REPLACE FUNCTION public.chat_can_send_in_thread(p_thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND public.chat_is_thread_participant(p_thread_id)
  AND EXISTS (SELECT 1 FROM public.chat_thread_participants p
              WHERE p.thread_id=p_thread_id AND p.user_id<>auth.uid())
  AND NOT EXISTS (SELECT 1 FROM public.chat_thread_participants p
                  WHERE p.thread_id=p_thread_id AND p.user_id<>auth.uid()
                    AND public.chat_users_can_share_thread(auth.uid(),p.user_id) IS NOT TRUE);
$$;
REVOKE ALL ON FUNCTION public.chat_can_send_in_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_can_send_in_thread(uuid) TO authenticated;


-- Flowrise Supabase function: public.chat_send_message(p_thread_id uuid, p_body text, p_attachments jsonb)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_send_message(p_thread_id uuid, p_body text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_me uuid := auth.uid();
    v_message_id bigint;
    v_attachment jsonb;
    v_path text;
    v_name text;
    v_mime text;
    v_size bigint;
begin
    if not public.chat_is_thread_participant(p_thread_id) then
        raise exception 'Conversation access denied';
    end if;

    if not public.chat_can_send_in_thread(p_thread_id) then
        raise exception 'Conversation is no longer permitted under the current communication rules';
    end if;

    if jsonb_typeof(coalesce(p_attachments,'[]'::jsonb)) <> 'array' then
        raise exception 'Invalid attachments payload';
    end if;

    if nullif(trim(coalesce(p_body,'')),'') is null
       and jsonb_array_length(coalesce(p_attachments,'[]'::jsonb)) = 0 then
        raise exception 'Message is empty';
    end if;

    if jsonb_array_length(coalesce(p_attachments,'[]'::jsonb)) > 10 then
        raise exception 'Maximum 10 files per message';
    end if;

    insert into public.chat_messages(thread_id,sender_id,body,created_at)
    values (
        p_thread_id,
        v_me,
        nullif(trim(coalesce(p_body,'')),''),
        now()
    )
    returning id into v_message_id;

    for v_attachment in
        select * from jsonb_array_elements(coalesce(p_attachments,'[]'::jsonb))
    loop
        v_path := trim(coalesce(v_attachment->>'storage_path',''));
        v_name := trim(coalesce(v_attachment->>'file_name',''));
        v_mime := nullif(trim(coalesce(v_attachment->>'mime_type','')),'');
        v_size := coalesce(nullif(v_attachment->>'size_bytes','')::bigint,0);

        if v_path = ''
           or v_name = ''
           or v_size < 0
           or v_size > 26214400 then
            raise exception 'Invalid attachment';
        end if;

        -- Expected private object path:
        -- <thread_uuid>/<sender_uuid>/<random>_<filename>
        if split_part(v_path,'/',1) <> p_thread_id::text
           or split_part(v_path,'/',2) <> v_me::text then
            raise exception 'Invalid attachment path';
        end if;

        insert into public.chat_attachments(
            message_id,
            thread_id,
            uploaded_by,
            storage_path,
            file_name,
            mime_type,
            size_bytes,
            created_at
        )
        values (
            v_message_id,
            p_thread_id,
            v_me,
            v_path,
            v_name,
            v_mime,
            v_size,
            now()
        );
    end loop;

    update public.chat_threads
    set last_message_at=now()
    where id=p_thread_id;

    update public.chat_thread_participants
    set last_read_at=now()
    where thread_id=p_thread_id
      and user_id=v_me;

    return v_message_id;
end;
$function$
;

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_thread_id uuid, p_body text, p_attachments jsonb


-- Preserve the existing permissive Storage policies; add current-role checks
-- for new chat files and updates. Other buckets and history reads are unchanged.
DROP POLICY IF EXISTS chat_files_current_conversation_insert ON storage.objects;
CREATE POLICY chat_files_current_conversation_insert ON storage.objects
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
 CASE WHEN bucket_id='chat-files' THEN
  split_part(name,'/',2)=auth.uid()::text
  AND public.chat_can_send_in_thread(split_part(name,'/',1)::uuid)
 ELSE true END
);
DROP POLICY IF EXISTS chat_files_current_conversation_update ON storage.objects;
CREATE POLICY chat_files_current_conversation_update ON storage.objects
AS RESTRICTIVE FOR UPDATE TO authenticated USING (
 CASE WHEN bucket_id='chat-files' THEN
  split_part(name,'/',2)=auth.uid()::text
  AND public.chat_can_send_in_thread(split_part(name,'/',1)::uuid)
 ELSE true END
) WITH CHECK (
 CASE WHEN bucket_id='chat-files' THEN
  split_part(name,'/',2)=auth.uid()::text
  AND public.chat_can_send_in_thread(split_part(name,'/',1)::uuid)
 ELSE true END
);

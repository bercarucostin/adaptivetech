CREATE OR REPLACE FUNCTION public.mutate_calendar_event(
    p_action text,p_event_id bigint DEFAULT NULL,p_fields jsonb DEFAULT '{}'::jsonb,p_request_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_role text:=public.effective_lab_role(v_lab); v_action text:=lower(trim(p_action));
    v_event public.lab_calendar_events%rowtype; v_id bigint; v_scope text; v_start date; v_end date; v_result jsonb;
    v_hash text; v_request public.ai_operation_requests%rowtype;
BEGIN
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'Calendar access denied'; END IF;
    IF v_action NOT IN ('create','update','delete') THEN RAISE EXCEPTION 'Unsupported calendar action'; END IF;
    IF nullif(trim(coalesce(p_request_key,'')),'') IS NOT NULL THEN
        v_hash:=md5(jsonb_build_object('action',v_action,'event_id',p_event_id,'fields',p_fields)::text);
        INSERT INTO public.ai_operation_requests(lab_organization_id,request_key,requested_by_user_id,envelope_hash)
        VALUES(v_lab,p_request_key,auth.uid(),v_hash) ON CONFLICT DO NOTHING;
        SELECT * INTO v_request FROM public.ai_operation_requests WHERE lab_organization_id=v_lab AND request_key=p_request_key FOR UPDATE;
        IF v_request.requested_by_user_id<>auth.uid() THEN RAISE EXCEPTION 'Request key belongs to another user'; END IF;
        IF v_request.envelope_hash<>v_hash THEN RAISE EXCEPTION 'Request key was already used for another operation'; END IF;
        IF v_request.state='completed' THEN RETURN v_request.result; END IF;
    END IF;

    IF v_action='create' THEN
        IF trim(coalesce(p_fields->>'title',''))='' OR nullif(p_fields->>'start_date','') IS NULL THEN RAISE EXCEPTION 'Calendar title and start date are required'; END IF;
        v_scope:=lower(trim(coalesce(p_fields->>'calendar_scope','')));
        IF v_scope NOT IN ('personal','shared') THEN RAISE EXCEPTION 'Calendar scope must be personal or shared'; END IF;
        v_start:=(p_fields->>'start_date')::date; v_end:=coalesce(nullif(p_fields->>'end_date','')::date,v_start);
        IF v_end<v_start THEN RAISE EXCEPTION 'End date cannot be before start date'; END IF;
        INSERT INTO public.lab_calendar_events(lab_organization_id,title,event_type,description,status,created_by_user_id,
            updated_by_user_id,start_date,end_date,start_time,created_at,updated_at,calendar_scope,owner_user_id)
        VALUES(v_lab,trim(p_fields->>'title'),nullif(trim(p_fields->>'event_type'),''),nullif(trim(p_fields->>'description'),''),
            coalesce(nullif(trim(p_fields->>'status'),''),'Planificat'),public.current_legacy_user_id(),public.current_legacy_user_id(),
            v_start,v_end,nullif(p_fields->>'start_time','')::time,now(),now(),v_scope,auth.uid()) RETURNING id INTO v_id;
    ELSE
        SELECT * INTO v_event FROM public.lab_calendar_events WHERE lab_organization_id=v_lab AND id=p_event_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Calendar event not found'; END IF;
        IF v_event.calendar_scope='personal' AND v_event.owner_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Personal calendar event access denied'; END IF;
        IF v_action='delete' THEN
            IF v_role='technician' AND v_event.owner_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Technician cannot delete another user event'; END IF;
            DELETE FROM public.lab_calendar_events WHERE lab_organization_id=v_lab AND id=p_event_id; v_id:=p_event_id;
        ELSE
            v_start:=coalesce(nullif(p_fields->>'start_date','')::date,v_event.start_date);
            v_end:=coalesce(nullif(p_fields->>'end_date','')::date,v_event.end_date,v_start);
            IF v_end<v_start THEN RAISE EXCEPTION 'End date cannot be before start date'; END IF;
            IF v_role='technician' AND p_fields?'owner_user_id' THEN RAISE EXCEPTION 'Technician cannot change event owner'; END IF;
            IF v_role='technician' AND v_event.owner_user_id IS DISTINCT FROM auth.uid()
               AND p_fields?'calendar_scope' AND lower(p_fields->>'calendar_scope')<>v_event.calendar_scope THEN
                RAISE EXCEPTION 'Technician cannot change another user event scope';
            END IF;
            IF p_fields?'calendar_scope' AND lower(trim(p_fields->>'calendar_scope')) NOT IN ('personal','shared') THEN
                RAISE EXCEPTION 'Calendar scope must be personal or shared';
            END IF;
            IF p_fields?'calendar_scope' AND lower(trim(p_fields->>'calendar_scope'))='personal'
               AND v_event.owner_user_id IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Only the owner can move an event to a personal calendar';
            END IF;
            UPDATE public.lab_calendar_events SET title=coalesce(nullif(trim(p_fields->>'title'),''),title),
                event_type=case when p_fields?'event_type' then nullif(trim(p_fields->>'event_type'),'') else event_type end,
                description=case when p_fields?'description' then nullif(trim(p_fields->>'description'),'') else description end,
                status=coalesce(nullif(trim(p_fields->>'status'),''),status),start_date=v_start,end_date=v_end,
                start_time=case when p_fields?'start_time' then nullif(p_fields->>'start_time','')::time else start_time end,
                calendar_scope=case when p_fields?'calendar_scope'
                    and (v_role in ('admin','manager') or v_event.owner_user_id=auth.uid())
                    then lower(trim(p_fields->>'calendar_scope')) else calendar_scope end,
                updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
            WHERE lab_organization_id=v_lab AND id=p_event_id; v_id:=p_event_id;
        END IF;
    END IF;
    SELECT jsonb_build_object('ok',true,'entity','calendar_event','operation',v_action,'id',v_id,'event',to_jsonb(e)) INTO v_result
    FROM public.lab_calendar_events e WHERE e.lab_organization_id=v_lab AND e.id=v_id;
    IF v_action='delete' THEN v_result:=jsonb_build_object('ok',true,'entity','calendar_event','operation','delete','id',v_id); END IF;
    IF nullif(trim(coalesce(p_request_key,'')),'') IS NOT NULL THEN UPDATE public.ai_operation_requests SET state='completed',result=v_result,completed_at=now() WHERE lab_organization_id=v_lab AND request_key=p_request_key; END IF;
    RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.mutate_calendar_event(text,bigint,jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.mutate_calendar_event(text,bigint,jsonb,text) TO authenticated;

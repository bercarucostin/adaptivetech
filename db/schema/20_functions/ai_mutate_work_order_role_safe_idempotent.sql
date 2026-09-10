-- Retry-safe adapter for legacy create/update/delete AI intents.
CREATE OR REPLACE FUNCTION public.ai_mutate_work_order_role_safe_idempotent(
    p_action text,
    p_payload jsonb,
    p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id();
    v_key text:='legacy:'||trim(coalesce(p_request_key,''));
    v_hash text:=md5(jsonb_build_object(
        'action',lower(trim(coalesce(p_action,''))),
        'payload',coalesce(p_payload,'{}'::jsonb)
    )::text);
    v_request public.ai_operation_requests%rowtype;
    v_result jsonb;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    IF trim(coalesce(p_request_key,''))='' THEN RAISE EXCEPTION 'Request key is required'; END IF;

    INSERT INTO public.ai_operation_requests(
        lab_organization_id,request_key,requested_by_user_id,envelope_hash
    ) VALUES (v_lab,v_key,auth.uid(),v_hash)
    ON CONFLICT DO NOTHING;

    SELECT * INTO v_request FROM public.ai_operation_requests
    WHERE lab_organization_id=v_lab AND request_key=v_key FOR UPDATE;
    IF v_request.requested_by_user_id<>auth.uid() THEN RAISE EXCEPTION 'Request key belongs to another user'; END IF;
    IF v_request.envelope_hash<>v_hash THEN RAISE EXCEPTION 'Request key was already used for another operation'; END IF;
    IF v_request.state='completed' THEN RETURN v_request.result; END IF;

    v_result:=public.ai_mutate_work_order_role_safe(p_action,coalesce(p_payload,'{}'::jsonb));
    v_result:=coalesce(v_result,'{}'::jsonb)||jsonb_build_object('request_key',p_request_key);
    UPDATE public.ai_operation_requests
    SET state='completed',result=v_result,completed_at=now()
    WHERE lab_organization_id=v_lab AND request_key=v_key;
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'error',sqlerrm,'request_key',p_request_key);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_mutate_work_order_role_safe_idempotent(text,jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.ai_mutate_work_order_role_safe_idempotent(text,jsonb,text) TO authenticated;

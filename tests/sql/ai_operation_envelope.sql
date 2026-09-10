begin;

select id, lab_organization_id, requested_by_user_id, envelope, checksum, expires_at, consumed_at
from public.ai_operation_previews limit 0;
select lab_organization_id, request_key, envelope_hash, state, result
from public.ai_operation_requests limit 0;

do $$
declare v_definition text;
begin
    select pg_get_functiondef('public.ai_execute_operation(jsonb)'::regprocedure) into v_definition;
    if v_definition not ilike '%request_key%' or v_definition not ilike '%envelope_hash%' then
        raise exception 'AI execution is not idempotent';
    end if;
    if v_definition ilike '%execute %' or v_definition ilike '%format(%i%' then
        raise exception 'AI dispatcher must not execute model-provided SQL identifiers';
    end if;
    if v_definition not ilike '%for update%' or v_definition not ilike '%requested_by_user_id<>auth.uid()%' then
        raise exception 'AI execution must lock preview targets and bind idempotency keys to the caller';
    end if;
    if strpos(lower(v_definition),'insert into public.ai_operation_requests')
       > strpos(lower(v_definition),'confirmed preview is required') then
        raise exception 'Idempotency must be acquired before a preview is consumed';
    end if;
    select pg_get_functiondef('public.ai_preview_operation(jsonb)'::regprocedure) into v_definition;
    if v_definition not ilike '%interval ''5 minutes''%' then
        raise exception 'AI previews must expire after five minutes';
    end if;
    if v_definition not ilike '%Unsupported field for AI entity%' or v_definition not ilike '%Request key is required%' then
        raise exception 'AI preview does not validate the typed envelope';
    end if;
    select pg_get_functiondef('public.ai_mutate_work_order_role_safe_idempotent(text,jsonb,text)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%ai_operation_requests%'
       or v_definition not ilike '%envelope_hash%'
       or v_definition not ilike '%for update%' then
        raise exception 'Legacy AI Work Order mutations are not retry-safe';
    end if;
end $$;

rollback;

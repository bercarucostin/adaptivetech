-- Flowrise Supabase function: public.admin_clear_ai_history_older_than_30_days
-- Sourced from Flowrise-Dental-V18.24-Cleanup-RPC.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.admin_clear_ai_history_older_than_30_days(
    p_lab_organization_id uuid,
    p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted bigint := 0;
    v_days integer := greatest(coalesce(p_days,30),30);
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    with deleted as (
        delete from public.lab_chat_history
        where lab_organization_id = p_lab_organization_id
          and created_at < now() - make_interval(days => v_days)
        returning 1
    )
    select count(*) into v_deleted from deleted;

    return jsonb_build_object(
        'ok', true,
        'deleted_messages', v_deleted,
        'cutoff_days', v_days
    );
end;
$$;

revoke all on function public.admin_clear_ai_history_older_than_30_days(uuid,integer) from public;
grant execute on function public.admin_clear_ai_history_older_than_30_days(uuid,integer) to authenticated;

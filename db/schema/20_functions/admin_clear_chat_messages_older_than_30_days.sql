-- Flowrise Supabase function: public.admin_clear_chat_messages_older_than_30_days
-- Sourced from Flowrise-Dental-V18.24-Cleanup-RPC.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.admin_clear_chat_messages_older_than_30_days(
    p_lab_organization_id uuid,
    p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted_messages bigint := 0;
    v_deleted_files bigint := 0;
    v_days integer := greatest(coalesce(p_days,30),30);
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    -- The internal chat is shared by authenticated lab users and does not carry
    -- a lab id on each thread. The management role check scopes this operation
    -- to the currently configured Flowrise lab while cleaning all old chat rows.
    select count(*)
      into v_deleted_files
    from public.chat_attachments a
    join public.chat_messages m on m.id = a.message_id
    where m.created_at < now() - make_interval(days => v_days)
      and exists (
          select 1
          from public.chat_thread_participants tp
          join public.organization_memberships om on om.user_id = tp.user_id
          where tp.thread_id = m.thread_id
            and om.organization_id = p_lab_organization_id
            and om.status = 'active'::public.membership_status
      );

    -- Remove the matching Storage objects as part of the same server-side action.
    delete from storage.objects o
    using public.chat_attachments a
    join public.chat_messages m on m.id = a.message_id
    where o.bucket_id = 'chat-files'
      and o.name = a.storage_path
      and m.created_at < now() - make_interval(days => v_days)
      and exists (
          select 1
          from public.chat_thread_participants tp
          join public.organization_memberships om on om.user_id = tp.user_id
          where tp.thread_id = m.thread_id
            and om.organization_id = p_lab_organization_id
            and om.status = 'active'::public.membership_status
      );

    -- Remove metadata first, then the old messages.
    delete from public.chat_attachments a
    using public.chat_messages m
    where m.id = a.message_id
      and m.created_at < now() - make_interval(days => v_days)
      and exists (
          select 1
          from public.chat_thread_participants tp
          join public.organization_memberships om on om.user_id = tp.user_id
          where tp.thread_id = m.thread_id
            and om.organization_id = p_lab_organization_id
            and om.status = 'active'::public.membership_status
      );

    with deleted as (
        delete from public.chat_messages cm
        where cm.created_at < now() - make_interval(days => v_days)
          and exists (
              select 1
              from public.chat_thread_participants tp
              join public.organization_memberships om on om.user_id = tp.user_id
              where tp.thread_id = cm.thread_id
                and om.organization_id = p_lab_organization_id
                and om.status = 'active'::public.membership_status
          )
        returning 1
    )
    select count(*) into v_deleted_messages from deleted;

    update public.chat_threads t
    set last_message_at = (
        select max(m.created_at)
        from public.chat_messages m
        where m.thread_id = t.id
    );

    return jsonb_build_object(
        'ok', true,
        'deleted_messages', v_deleted_messages,
        'deleted_files', v_deleted_files,
        'cutoff_days', v_days
    );
end;
$$;

revoke all on function public.admin_clear_chat_messages_older_than_30_days(uuid,integer) from public;
grant execute on function public.admin_clear_chat_messages_older_than_30_days(uuid,integer) to authenticated;

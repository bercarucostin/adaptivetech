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

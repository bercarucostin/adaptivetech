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

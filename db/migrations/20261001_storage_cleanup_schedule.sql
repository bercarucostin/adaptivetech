-- Apply after core migration, Edge deployment and Vault secret setup.
-- Separate from the canonical schema: extension availability is project-specific.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ DECLARE n text;v_url text;BEGIN
 FOREACH n IN ARRAY ARRAY['flowrise_cleanup_url','flowrise_cleanup_scheduler_secret','flowrise_cleanup_publishable_key'] LOOP
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name=n AND length(decrypted_secret)>0)<>1 THEN
   RAISE EXCEPTION 'Configure exactly one Vault secret named % before applying the schedule.',n;
  END IF;
 END LOOP;
 SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='flowrise_cleanup_url';
 IF v_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/admin-storage-cleanup$' THEN RAISE EXCEPTION 'Invalid cleanup URL in Vault';END IF;
 IF (SELECT length(decrypted_secret) FROM vault.decrypted_secrets WHERE name='flowrise_cleanup_scheduler_secret')<32 THEN RAISE EXCEPTION 'Scheduler secret must contain at least 32 characters';END IF;
 PERFORM cron.schedule('flowrise-storage-cleanup','* * * * *',$cron$
 SELECT net.http_post(
  url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='flowrise_cleanup_url'),
  headers:=jsonb_build_object('Content-Type','application/json',
   'apikey',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='flowrise_cleanup_publishable_key'),
   'X-Cleanup-Scheduler-Secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='flowrise_cleanup_scheduler_secret')),
  body:='{"operation":"scheduled"}'::jsonb,timeout_milliseconds:=25000
 );
 $cron$);
END; $$;
COMMIT;

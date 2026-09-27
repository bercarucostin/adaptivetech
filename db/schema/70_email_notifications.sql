-- Opt-in email notifications. No historical backfill and no network I/O in triggers.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_new_work_order boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_stage_status boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.email_notification_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 work_order_id bigint NOT NULL,
 recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 event_kind text NOT NULL CHECK(event_kind IN ('new_work_order','stage_status','assignment')),
 stage_key text CHECK(stage_key IN ('model','modelare','cer_fin')),
 old_status text,new_status text,
 event_transaction bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','uncertain','suppressed')),
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,leased_at timestamptz,sent_at timestamptz,provider_message_id text,
 FOREIGN KEY(lab_organization_id,work_order_id) REFERENCES public.lab_work_orders(lab_organization_id,id) ON DELETE CASCADE
);
-- New order plus assignment in the same transaction is one notification per recipient.
CREATE UNIQUE INDEX IF NOT EXISTS email_notification_event_idx ON public.email_notification_queue
 (lab_organization_id,work_order_id,recipient_id,event_transaction,
 (CASE WHEN event_kind='assignment' THEN 'new_work_order' ELSE event_kind END),
 (CASE WHEN event_kind='stage_status' THEN stage_key ELSE '' END));
CREATE INDEX IF NOT EXISTS email_notification_pending_idx ON public.email_notification_queue(available_at,created_at) WHERE state='pending';
ALTER TABLE public.email_notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_notification_queue FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_my_email_preferences()
RETURNS TABLE(notify_new_work_order boolean,notify_stage_status boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.notify_new_work_order,p.notify_stage_status FROM public.profiles p WHERE p.id=auth.uid() AND p.active;
$$;
CREATE OR REPLACE FUNCTION public.set_my_email_preferences(p_new boolean,p_stage boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_new IS NULL OR p_stage IS NULL THEN RAISE EXCEPTION 'Preferences must be boolean'; END IF;
 UPDATE public.profiles SET notify_new_work_order=p_new,notify_stage_status=p_stage WHERE id=auth.uid() AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active user required'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_email_preferences() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_my_email_preferences(boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_email_preferences(),public.set_my_email_preferences(boolean,boolean) TO authenticated;

-- Explicit recipient argument: never impersonate a user or modify JWT settings.
CREATE OR REPLACE FUNCTION public.email_notification_recipient_allowed(p_user uuid,p_lab uuid,p_order bigint,p_kind text,p_stage text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
 SELECT 1 FROM public.profiles p JOIN public.lab_work_orders w ON w.lab_organization_id=p_lab AND w.id=p_order
 WHERE p.id=p_user AND p.active AND w.archived_at IS NULL
 AND CASE WHEN p_kind='stage_status' THEN p.notify_stage_status ELSE p.notify_new_work_order END
 AND (
  (p_kind<>'assignment' AND EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_lab AND m.user_id=p.id AND m.status='active' AND lower(m.role) IN ('admin','manager')))
  OR (
   EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_lab AND m.user_id=p.id AND m.status='active' AND lower(m.role)='technician')
   AND nullif(trim(p.technician_name),'') IS NOT NULL
   -- Ambiguous names must not route a private notification to multiple accounts.
   AND 1=(SELECT count(*) FROM public.profiles p2 JOIN public.organization_memberships m2 ON m2.user_id=p2.id AND m2.organization_id=p_lab AND m2.status='active' AND lower(m2.role)='technician' WHERE p2.active AND lower(trim(p2.technician_name))=lower(trim(p.technician_name)))
   AND EXISTS(SELECT 1 FROM (VALUES
    ('model',w.tehnician_model,w.model_not_applicable),('modelare',w.tehnician1_modelare,w.modelare_not_applicable),('cer_fin',w.tehnician2_cer_fin,w.cer_fin_not_applicable)
   ) s(stage,technician,not_applicable) WHERE NOT coalesce(s.not_applicable,false) AND (p_stage IS NULL OR s.stage=p_stage) AND lower(trim(s.technician))=lower(trim(p.technician_name)))
  )
  OR (p_kind<>'assignment' AND nullif(trim(w.nume_partener),'') IS NOT NULL
   AND lower(trim(w.nume_partener)) IN (lower(trim(p.legacy_partner_name)),lower(trim(p.display_name)),lower(trim(p.legacy_user_id)))
   AND EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.organizations clinic ON clinic.id=m.organization_id AND clinic.organization_type='clinic'
    JOIN public.organization_relationships r ON r.clinic_organization_id=m.organization_id AND r.lab_organization_id=p_lab AND r.status='active'
    WHERE m.user_id=p.id AND m.status='active' AND lower(m.role)='doctor')
  )
 ));
$$;
REVOKE ALL ON FUNCTION public.email_notification_recipient_allowed(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enqueue_work_order_email_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record; previous jsonb; current_row jsonb:=to_jsonb(NEW);
BEGIN
 IF NEW.archived_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  INSERT INTO public.email_notification_queue(lab_organization_id,work_order_id,recipient_id,event_kind)
   SELECT NEW.lab_organization_id,NEW.id,p.id,'new_work_order' FROM public.profiles p
   WHERE p.notify_new_work_order AND public.email_notification_recipient_allowed(p.id,NEW.lab_organization_id,NEW.id,'new_work_order',null)
   ON CONFLICT DO NOTHING;
  RETURN NEW;
 END IF;
 previous:=to_jsonb(OLD);
 FOR s IN SELECT * FROM (VALUES ('model','status_model','tehnician_model','model_not_applicable'),('modelare','status_modelare','tehnician1_modelare','modelare_not_applicable'),('cer_fin','status_cer_fin','tehnician2_cer_fin','cer_fin_not_applicable')) x(stage,status_field,technician_field,disabled_field) LOOP
  IF coalesce((current_row->>s.disabled_field)::boolean,false) THEN CONTINUE; END IF;
  IF nullif(trim(current_row->>s.technician_field),'') IS NOT NULL AND lower(trim(current_row->>s.technician_field)) IS DISTINCT FROM lower(trim(previous->>s.technician_field)) THEN
   INSERT INTO public.email_notification_queue(lab_organization_id,work_order_id,recipient_id,event_kind,stage_key)
    SELECT NEW.lab_organization_id,NEW.id,p.id,'assignment',s.stage FROM public.profiles p
    WHERE p.notify_new_work_order AND public.email_notification_recipient_allowed(p.id,NEW.lab_organization_id,NEW.id,'assignment',s.stage)
    ON CONFLICT DO NOTHING;
  END IF;
  IF current_row->>s.status_field IS DISTINCT FROM previous->>s.status_field THEN
   INSERT INTO public.email_notification_queue(lab_organization_id,work_order_id,recipient_id,event_kind,stage_key,old_status,new_status)
    SELECT NEW.lab_organization_id,NEW.id,p.id,'stage_status',s.stage,previous->>s.status_field,current_row->>s.status_field FROM public.profiles p
    WHERE p.notify_stage_status AND public.email_notification_recipient_allowed(p.id,NEW.lab_organization_id,NEW.id,'stage_status',s.stage)
    ON CONFLICT(lab_organization_id,work_order_id,recipient_id,event_transaction,
      (CASE WHEN event_kind='assignment' THEN 'new_work_order' ELSE event_kind END),
      (CASE WHEN event_kind='stage_status' THEN stage_key ELSE '' END))
    DO UPDATE SET new_status=EXCLUDED.new_status;
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_work_order_email_notifications() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS work_order_email_notifications ON public.lab_work_orders;
CREATE TRIGGER work_order_email_notifications AFTER INSERT OR UPDATE ON public.lab_work_orders FOR EACH ROW EXECUTE FUNCTION public.enqueue_work_order_email_notifications();

CREATE OR REPLACE FUNCTION public.claim_email_notifications(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,lease_token uuid,recipient_id uuid,recipient_email text,work_order_id bigint,event_kind text,stage_key text,old_status text,new_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.email_notification_queue%rowtype; email text; token uuid; emitted integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 THEN RAISE EXCEPTION 'Invalid batch limit'; END IF;
 -- A crashed worker may already have sent the message. Never automatically resend.
 UPDATE public.email_notification_queue SET state='uncertain' WHERE state='sending' AND leased_at<now()-interval '15 minutes';
 FOR q IN SELECT e.* FROM public.email_notification_queue e WHERE e.state='pending' AND e.available_at<=now() ORDER BY e.created_at,e.id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  email:=NULL;
  SELECT u.email INTO email FROM auth.users u WHERE u.id=q.recipient_id AND u.email_confirmed_at IS NOT NULL AND nullif(trim(u.email),'') IS NOT NULL;
  IF email IS NULL OR NOT public.email_notification_recipient_allowed(q.recipient_id,q.lab_organization_id,q.work_order_id,q.event_kind,q.stage_key)
    OR (q.event_kind='stage_status' AND q.old_status IS NOT DISTINCT FROM q.new_status) THEN
   UPDATE public.email_notification_queue e SET state='suppressed' WHERE e.id=q.id;
   CONTINUE;
  END IF;
  token:=gen_random_uuid();
  UPDATE public.email_notification_queue e SET state='sending',lease_token=token,leased_at=now(),attempts=e.attempts+1 WHERE e.id=q.id;
  RETURN QUERY SELECT q.id,token,q.recipient_id,email,q.work_order_id,q.event_kind,q.stage_key,q.old_status,q.new_status;
  emitted:=emitted+1;
  EXIT WHEN emitted>=least(p_limit,10);
 END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION public.finish_email_notification(p_id uuid,p_lease uuid,p_outcome text,p_message_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.email_notification_queue%rowtype;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('sent','retry','failed','uncertain') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
 IF p_outcome='sent' AND nullif(trim(p_message_id),'') IS NULL THEN RAISE EXCEPTION 'Provider message id required'; END IF;
 SELECT * INTO q FROM public.email_notification_queue WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR q.state<>'sending' OR q.lease_token IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'Invalid or expired delivery lease'; END IF;
 UPDATE public.email_notification_queue SET
  state=CASE WHEN p_outcome='retry' AND q.attempts<5 THEN 'pending' WHEN p_outcome='retry' THEN 'failed' ELSE p_outcome END,
  available_at=now()+interval '15 minutes',
  sent_at=CASE WHEN p_outcome='sent' THEN now() END,
  provider_message_id=CASE WHEN p_outcome='sent' THEN p_message_id END,
  lease_token=NULL,leased_at=NULL
 WHERE email_notification_queue.id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_email_notifications(integer),public.finish_email_notification(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_notifications(integer),public.finish_email_notification(uuid,uuid,text,text) TO service_role;

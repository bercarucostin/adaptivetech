-- Public reads are scoped to the active Flowrise Admin; worker RPCs are service-only.
CREATE OR REPLACE FUNCTION public.cleanup_admin_lab(p_user uuid DEFAULT auth.uid()) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid:=public.get_flowrise_lab_id();
BEGIN
 IF p_user IS NULL OR v_lab IS NULL OR NOT EXISTS(
  SELECT 1 FROM organization_memberships m JOIN profiles p ON p.id=m.user_id
  WHERE m.organization_id=v_lab AND m.user_id=p_user AND lower(m.role)='admin' AND m.status='active' AND p.active
 ) THEN RAISE EXCEPTION 'Access denied'; END IF;
 RETURN v_lab;
END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_size(p_metadata jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE s text:=p_metadata->>'size';
BEGIN
 IF s IS NULL OR s !~ '^\d{1,19}$' THEN RETURN NULL; END IF;
 IF s::numeric>9223372036854775807 THEN RETURN NULL; END IF;
 RETURN s::bigint;
END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_path_matches(p_path text,p_order bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT p_path ~ ('^work-orders/'||p_order::text||'/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_[^/]+$');
$$;

CREATE OR REPLACE FUNCTION public.cleanup_order_available(p_lab uuid,p_order bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM admin_cleanup_items i JOIN admin_cleanup_jobs j ON j.id=i.job_id
 WHERE j.lab_organization_id=p_lab AND i.order_id=p_order AND i.state='processing');
$$;

CREATE OR REPLACE FUNCTION public.cleanup_internal_item(p_lab uuid,p_order bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(auth.role()='service_role',false) AND EXISTS(
 SELECT 1 FROM admin_cleanup_items i JOIN admin_cleanup_jobs j ON j.id=i.job_id
 WHERE j.lab_organization_id=p_lab AND i.order_id=p_order AND i.state='processing'
 AND i.id::text=current_setting('flowrise.cleanup_item',true));
$$;

CREATE OR REPLACE FUNCTION public.cleanup_touch_order(p_lab uuid,p_order bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_lab IS NULL THEN
  IF (SELECT count(*) FROM lab_work_orders WHERE id=p_order)<>1 THEN RETURN; END IF;
  SELECT lab_organization_id INTO p_lab FROM lab_work_orders WHERE id=p_order;
 END IF;
 PERFORM 1 FROM lab_work_orders WHERE lab_organization_id=p_lab AND id=p_order FOR UPDATE;
 IF NOT public.cleanup_order_available(p_lab,p_order) AND NOT public.cleanup_internal_item(p_lab,p_order) THEN
  RAISE EXCEPTION 'Lucrarea este în curs de curățare.';
 END IF;
 UPDATE lab_work_orders SET cleanup_revision=cleanup_revision+1 WHERE lab_organization_id=p_lab AND id=p_order;
END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_mutation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;v_lab uuid;v_order bigint;old_r jsonb;new_r jsonb;target record;
BEGIN
 IF TG_TABLE_NAME='lab_work_orders' THEN
  IF TG_OP='INSERT' THEN
   -- Numeric IDs share the Storage path namespace across labs. Serialize new
   -- attribution against existing parent locks and invalidate their previews.
   FOR target IN SELECT lab_organization_id lab,id ord FROM lab_work_orders
    WHERE id=NEW.id ORDER BY lab_organization_id
   LOOP PERFORM public.cleanup_touch_order(target.lab,target.ord);END LOOP;
   INSERT INTO lab_work_order_id_watermarks VALUES(NEW.lab_organization_id,NEW.id)
   ON CONFLICT(lab_organization_id) DO UPDATE SET maximum_id=greatest(lab_work_order_id_watermarks.maximum_id,excluded.maximum_id);
   RETURN NEW;
  END IF;
  IF NOT public.cleanup_order_available(OLD.lab_organization_id,OLD.id) AND NOT public.cleanup_internal_item(OLD.lab_organization_id,OLD.id) THEN
   RAISE EXCEPTION 'Lucrarea este în curs de curățare.';
  END IF;
  IF TG_OP='UPDATE' THEN
   IF NEW.lab_organization_id IS DISTINCT FROM OLD.lab_organization_id OR NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Work Order identity is immutable'; END IF;
   NEW.cleanup_revision:=greatest(NEW.cleanup_revision,OLD.cleanup_revision+1);RETURN NEW;
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP<>'INSERT' THEN old_r:=to_jsonb(OLD);END IF;
 IF TG_OP<>'DELETE' THEN new_r:=to_jsonb(NEW);END IF;
 -- Resolve both parents before locking, so a moved child invalidates both selections.
 FOR target IN
  SELECT DISTINCT x.lab,x.ord FROM (
   SELECT CASE WHEN v ? 'assignment_id' THEN a.lab_organization_id ELSE nullif(v->>'lab_organization_id','')::uuid END lab,
          CASE WHEN v ? 'assignment_id' THEN a.work_order_id ELSE coalesce(v->>'work_order_id',v->>'legacy_work_order_id')::bigint END ord
   FROM (SELECT old_r v UNION ALL SELECT new_r) vals
   LEFT JOIN lab_work_order_stage_assignments a ON a.id=nullif(v->>'assignment_id','')::uuid
   WHERE v IS NOT NULL
   UNION ALL
   -- A file assigned to a different order can still conflict with a selected
   -- Storage path. Lock that path's existing numeric-ID parents as well.
   SELECT o.lab_organization_id,o.id FROM lab_work_orders o
   JOIN (SELECT old_r v UNION ALL SELECT new_r) vals
    ON TG_TABLE_NAME='work_order_files' AND public.cleanup_path_matches(v->>'object_path',o.id)
  ) x WHERE x.ord IS NOT NULL ORDER BY x.lab NULLS LAST,x.ord
 LOOP PERFORM public.cleanup_touch_order(target.lab,target.ord);END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_storage_usage() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cleanup_admin_lab();
 SELECT jsonb_build_object('used_bytes',coalesce(sum(bytes),0)::text,'unknown_size_count',coalesce(sum(unknowns),0),
 'measured_at',now(),'buckets',coalesce(jsonb_agg(jsonb_build_object('name',bucket_id,'used_bytes',bytes::text,'unknown_size_count',unknowns) ORDER BY bucket_id),'[]'))
 INTO result FROM (SELECT bucket_id,coalesce(sum(public.cleanup_size(metadata)),0) bytes,count(*) FILTER(WHERE public.cleanup_size(metadata) IS NULL) unknowns FROM storage.objects GROUP BY bucket_id) b;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_job_json(p_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',j.id,'action',j.action,'state',j.state,'from',j.date_from,'to',j.date_to,'expires_at',j.expires_at,
 'reconcile_after',j.reconcile_after,'missing_dates_count',j.missing_dates_count,
 'bytes',(SELECT coalesce(sum(i.bytes),0)::text FROM admin_cleanup_items i WHERE i.job_id=j.id),
 'counts',coalesce((SELECT jsonb_object_agg(key,total) FROM (SELECT c.key,sum(c.value::numeric) total FROM admin_cleanup_items i CROSS JOIN LATERAL jsonb_each_text(i.counts) c WHERE i.job_id=j.id GROUP BY c.key) s),'{}'),
 'progress',(SELECT jsonb_build_object('total',count(*),'completed',count(*) FILTER(WHERE state='completed'),'skipped',count(*) FILTER(WHERE state='skipped'),'failed',count(*) FILTER(WHERE state='failed')) FROM admin_cleanup_items WHERE job_id=j.id),
 'errors',coalesce((SELECT jsonb_agg(jsonb_build_object('order_id',order_id::text,'code',error_code,'message',error_message)) FROM admin_cleanup_items WHERE job_id=j.id AND error_code IS NOT NULL),'[]'))
 FROM admin_cleanup_jobs j WHERE j.id=p_job;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_owned_job(p_job uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid:=public.cleanup_admin_lab();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_cleanup_jobs WHERE id=p_job AND lab_organization_id=v_lab AND created_by=auth.uid()) THEN RAISE EXCEPTION 'Access denied';END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_status(p_job_id uuid,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cleanup_owned_job(p_job_id);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>200 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Invalid pagination';END IF;
 SELECT jsonb_build_object('job',public.cleanup_job_json(p_job_id),'offset',p_offset,'limit',p_limit,
 'total',(SELECT count(*) FROM admin_cleanup_items WHERE job_id=p_job_id),
 'orders',coalesce(jsonb_agg(jsonb_build_object('order_id',i.order_id::text,'state',i.state,'counts',i.counts,'bytes',i.bytes::text) ORDER BY i.order_id),'[]'))
 INTO result FROM (SELECT * FROM admin_cleanup_items WHERE job_id=p_job_id ORDER BY order_id LIMIT p_limit OFFSET p_offset) i;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_jobs(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid:=public.cleanup_admin_lab();result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid pagination';END IF;
 SELECT coalesce(jsonb_agg(public.cleanup_job_json(id) ORDER BY created_at DESC),'[]') INTO result FROM
 (SELECT id,created_at FROM admin_cleanup_jobs WHERE lab_organization_id=v_lab AND created_by=auth.uid() ORDER BY created_at DESC LIMIT p_limit) j;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_preview(p_action text,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid:=public.cleanup_admin_lab();v_job uuid;v_item uuid;o record;v_ambiguous boolean;v_counts jsonb;v_bytes bigint;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('files','clinical','all') OR p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'Invalid action or date range';END IF;
 INSERT INTO admin_cleanup_jobs(lab_organization_id,created_by,action,date_from,date_to,missing_dates_count)
 VALUES(v_lab,auth.uid(),p_action,p_from,p_to,(SELECT count(*) FROM lab_work_orders WHERE lab_organization_id=v_lab AND coalesce(data_receptie,created_at) IS NULL)) RETURNING id INTO v_job;
 FOR o IN SELECT * FROM lab_work_orders WHERE lab_organization_id=v_lab
 AND coalesce(data_receptie,created_at)>=(p_from::timestamp AT TIME ZONE 'Europe/Bucharest')
 AND coalesce(data_receptie,created_at)<((p_to+1)::timestamp AT TIME ZONE 'Europe/Bucharest') ORDER BY id FOR SHARE
 LOOP
  v_ambiguous:=p_action<>'clinical' AND (
   EXISTS(SELECT 1 FROM work_order_files f WHERE f.legacy_work_order_id=o.id AND
    (f.lab_organization_id=v_lab OR f.lab_organization_id IS NULL) AND
    (f.bucket_name<>'work-order-files' OR NOT public.cleanup_path_matches(f.object_path,o.id) OR
     (f.lab_organization_id IS NULL AND (SELECT count(*) FROM lab_work_orders WHERE id=o.id)<>1))) OR
   EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='work-order-files' AND public.cleanup_path_matches(s.name,o.id) AND
    (EXISTS(SELECT 1 FROM work_order_files f WHERE f.object_path=s.name AND (f.legacy_work_order_id<>o.id OR (f.lab_organization_id IS NOT NULL AND f.lab_organization_id<>v_lab))) OR
     (NOT EXISTS(SELECT 1 FROM work_order_files f WHERE f.object_path=s.name AND f.lab_organization_id=v_lab) AND (SELECT count(*) FROM lab_work_orders WHERE id=o.id)<>1)))
  );
  INSERT INTO admin_cleanup_items(job_id,order_id,revision,state,error_code,error_message)
  VALUES(v_job,o.id,o.cleanup_revision,CASE WHEN v_ambiguous THEN 'skipped' ELSE 'pending' END,
   CASE WHEN v_ambiguous THEN 'ambiguous_files' END,CASE WHEN v_ambiguous THEN 'Asocierea fișierelor este ambiguă sau traseul nu este valid.' END) RETURNING id INTO v_item;
  IF p_action<>'clinical' AND NOT v_ambiguous THEN
   INSERT INTO admin_cleanup_files(item_id,bucket,object_path,metadata_id,size_bytes,object_version)
   SELECT v_item,'work-order-files',paths.path,f.id,public.cleanup_size(s.metadata),CASE WHEN s.name IS NOT NULL THEN md5(coalesce(s.metadata::text,'null')) END
   FROM (
    SELECT object_path path FROM work_order_files WHERE legacy_work_order_id=o.id AND (lab_organization_id=v_lab OR lab_organization_id IS NULL) AND bucket_name='work-order-files'
    UNION SELECT name FROM storage.objects WHERE bucket_id='work-order-files' AND public.cleanup_path_matches(name,o.id)
   ) paths LEFT JOIN work_order_files f ON f.object_path=paths.path LEFT JOIN storage.objects s ON s.bucket_id='work-order-files' AND s.name=paths.path;
  END IF;
  SELECT jsonb_build_object(
   'files',(SELECT count(*) FROM admin_cleanup_files WHERE item_id=v_item),
   'unknown_file_sizes',(SELECT count(*) FROM admin_cleanup_files WHERE item_id=v_item AND size_bytes IS NULL),
   'clinical_cases',(SELECT count(*) FROM lab_patient_cases WHERE lab_organization_id=v_lab AND work_order_id=o.id),
   'items',(SELECT count(*) FROM lab_work_order_items WHERE lab_organization_id=v_lab AND work_order_id=o.id),
   'price_lines',(SELECT count(*) FROM lab_work_order_price_lines WHERE lab_organization_id=v_lab AND work_order_id=o.id),
   'assignments',(SELECT count(*) FROM lab_work_order_stage_assignments WHERE lab_organization_id=v_lab AND work_order_id=o.id),
   'payments',(SELECT count(*) FROM technician_payments p JOIN lab_work_order_stage_assignments a ON a.id=p.assignment_id WHERE a.lab_organization_id=v_lab AND a.work_order_id=o.id),
   'cost_lines',(SELECT count(*) FROM lab_work_order_assignment_cost_lines c JOIN lab_work_order_stage_assignments a ON a.id=c.assignment_id WHERE a.lab_organization_id=v_lab AND a.work_order_id=o.id),
   'adjustments',(SELECT count(*) FROM lab_work_order_assignment_adjustments c JOIN lab_work_order_stage_assignments a ON a.id=c.assignment_id WHERE a.lab_organization_id=v_lab AND a.work_order_id=o.id),
   'financial_audit',(SELECT count(*) FROM work_order_financial_audit WHERE lab_organization_id=v_lab AND work_order_id=o.id)) INTO v_counts;
  UPDATE admin_cleanup_items SET counts=v_counts,bytes=(SELECT coalesce(sum(size_bytes),0) FROM admin_cleanup_files WHERE item_id=v_item) WHERE id=v_item;
 END LOOP;
 RETURN public.cleanup_job_json(v_job);
END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_require_service() RETURNS void
LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Access denied';END IF;END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_refresh_job(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state text;
BEGIN
 SELECT CASE WHEN count(*) FILTER(WHERE state IN ('pending','processing'))>0 THEN 'running'
 WHEN count(*) FILTER(WHERE state='awaiting_uploads')>0 THEN 'awaiting_uploads'
 WHEN count(*) FILTER(WHERE state IN ('skipped','failed'))>0 THEN CASE WHEN count(*) FILTER(WHERE state IN ('completed','skipped'))=0 THEN 'failed' ELSE 'partial' END
 ELSE 'completed' END INTO v_state FROM admin_cleanup_items WHERE job_id=p_job;
 UPDATE admin_cleanup_jobs SET state=v_state,updated_at=now() WHERE id=p_job;
 RETURN public.cleanup_job_json(p_job);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_confirm(p_job_id uuid,p_confirmation text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j admin_cleanup_jobs%rowtype;
BEGIN
 PERFORM public.cleanup_owned_job(p_job_id);
 SELECT * INTO j FROM admin_cleanup_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.action='all' AND p_confirmation IS DISTINCT FROM 'ȘTERGE' THEN RAISE EXCEPTION 'Invalid confirmation';END IF;
 IF j.state<>'preview' THEN RETURN public.cleanup_job_json(j.id);END IF;
 IF now()>=j.expires_at THEN RAISE EXCEPTION 'Preview expired';END IF;
 UPDATE admin_cleanup_jobs SET state='running',confirmed_at=now(),reconcile_after=CASE WHEN action<>'clinical' THEN now()+interval '2 hours 5 minutes' END WHERE id=j.id;
 RETURN public.cleanup_refresh_job(j.id);
END; $$;

CREATE OR REPLACE FUNCTION public.cleanup_lease(p_job uuid,p_order bigint,p_worker uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i admin_cleanup_items%rowtype;j admin_cleanup_jobs%rowtype;
BEGIN
 PERFORM public.cleanup_require_service();
 SELECT * INTO j FROM admin_cleanup_jobs WHERE id=p_job;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found';END IF;
 PERFORM public.cleanup_admin_lab(j.created_by);
 SELECT * INTO i FROM admin_cleanup_items WHERE job_id=p_job AND order_id=p_order FOR UPDATE;
 IF NOT FOUND OR i.state<>'processing' OR i.worker_id IS DISTINCT FROM p_worker OR i.lease_until<=now() THEN RAISE EXCEPTION 'Invalid worker lease';END IF;
 RETURN i.id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_claim(p_job_id uuid,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j admin_cleanup_jobs%rowtype;i admin_cleanup_items%rowtype;v_rev bigint;
BEGIN
 PERFORM public.cleanup_require_service();
 IF p_worker_id IS NULL THEN RAISE EXCEPTION 'Invalid worker';END IF;
 SELECT * INTO j FROM admin_cleanup_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR j.confirmed_at IS NULL THEN RAISE EXCEPTION 'Job not confirmed';END IF;
 PERFORM public.cleanup_admin_lab(j.created_by);
 FOR i IN SELECT * FROM admin_cleanup_items WHERE job_id=j.id AND
 (state IN ('pending','failed') OR (state='processing' AND lease_until<now()) OR (state='awaiting_uploads' AND j.reconcile_after<=now())) ORDER BY CASE WHEN state='failed' THEN 1 ELSE 0 END,order_id FOR UPDATE SKIP LOCKED
 LOOP
  IF NOT i.initial_finished THEN
   SELECT cleanup_revision INTO v_rev FROM lab_work_orders WHERE lab_organization_id=j.lab_organization_id AND id=i.order_id FOR UPDATE;
   IF NOT FOUND OR v_rev<>i.revision THEN
    UPDATE admin_cleanup_items SET state='skipped',error_code='stale_order',error_message='Lucrarea s-a modificat după previzualizare.' WHERE id=i.id;CONTINUE;
   END IF;
   IF j.action<>'clinical' AND (
    EXISTS(SELECT 1 FROM admin_cleanup_files f LEFT JOIN storage.objects s ON s.bucket_id=f.bucket AND s.name=f.object_path
     WHERE f.item_id=i.id AND NOT f.initial_done AND f.object_version IS DISTINCT FROM CASE WHEN s.name IS NOT NULL THEN md5(coalesce(s.metadata::text,'null')) END
     AND NOT (s.name IS NULL AND i.state IN ('failed','processing'))) OR
    EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='work-order-files' AND public.cleanup_path_matches(s.name,i.order_id) AND
     NOT EXISTS(SELECT 1 FROM admin_cleanup_files f WHERE f.item_id=i.id AND f.object_path=s.name))
   ) THEN
    UPDATE admin_cleanup_items SET state='skipped',error_code='stale_files',error_message='Fișierele s-au modificat după previzualizare.' WHERE id=i.id;CONTINUE;
   END IF;
   IF j.action='all' AND EXISTS(
    SELECT 1 FROM technician_payments p JOIN technician_payments orig ON orig.id=p.reversal_of
    JOIN lab_work_order_stage_assignments a ON a.id=p.assignment_id JOIN lab_work_order_stage_assignments b ON b.id=orig.assignment_id
    WHERE ((a.lab_organization_id=j.lab_organization_id AND a.work_order_id=i.order_id)<>(b.lab_organization_id=j.lab_organization_id AND b.work_order_id=i.order_id))
   ) THEN
    UPDATE admin_cleanup_items SET state='skipped',error_code='external_reversal',error_message='O reversare este legată de altă lucrare.' WHERE id=i.id;CONTINUE;
   END IF;
  END IF;
  -- An item already processing elsewhere must never permit a second job on the same order.
  IF EXISTS(SELECT 1 FROM admin_cleanup_items x JOIN admin_cleanup_jobs y ON y.id=x.job_id WHERE x.id<>i.id AND x.order_id=i.order_id AND y.lab_organization_id=j.lab_organization_id AND x.state='processing') THEN CONTINUE;END IF;
  UPDATE admin_cleanup_items SET state='processing',worker_id=p_worker_id,lease_until=now()+interval '120 seconds',error_code=NULL,error_message=NULL WHERE id=i.id;
  RETURN jsonb_build_object('order_id',i.order_id::text,'action',j.action,'reconciliation',i.initial_finished,'file_count',(SELECT count(*) FROM admin_cleanup_files WHERE item_id=i.id));
 END LOOP;
 PERFORM public.cleanup_refresh_job(j.id);RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_files(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item uuid;result jsonb;
BEGIN
 v_item:=public.cleanup_lease(p_job_id,p_order_id,p_worker_id);
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid pagination';END IF;
 SELECT jsonb_build_object('files',coalesce(jsonb_agg(jsonb_build_object('path',object_path,'bucket',bucket,'initial_done',initial_done,'reconciled',reconciled) ORDER BY id),'[]'),
 'total',(SELECT count(*) FROM admin_cleanup_files WHERE item_id=v_item)) INTO result FROM
 (SELECT * FROM admin_cleanup_files WHERE item_id=v_item ORDER BY id OFFSET p_offset LIMIT p_limit) f;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_checkpoint(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_paths text[],p_reconciliation boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item uuid;v_initial boolean;
BEGIN
 v_item:=public.cleanup_lease(p_job_id,p_order_id,p_worker_id);
 SELECT initial_finished INTO v_initial FROM admin_cleanup_items WHERE id=v_item;
 IF p_reconciliation IS DISTINCT FROM v_initial OR p_paths IS NULL OR cardinality(p_paths)>100 OR
 EXISTS(SELECT 1 FROM unnest(p_paths) path WHERE NOT EXISTS(SELECT 1 FROM admin_cleanup_files WHERE item_id=v_item AND object_path=path)) THEN RAISE EXCEPTION 'Invalid checkpoint';END IF;
 UPDATE admin_cleanup_files SET initial_done=CASE WHEN NOT p_reconciliation THEN true ELSE initial_done END,reconciled=CASE WHEN p_reconciliation THEN true ELSE reconciled END WHERE item_id=v_item AND object_path=ANY(p_paths);
 UPDATE admin_cleanup_items SET lease_until=now()+interval '120 seconds' WHERE id=v_item;
 RETURN public.cleanup_job_json(p_job_id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_finish(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_storage_success boolean,p_error_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item uuid;j admin_cleanup_jobs%rowtype;v_assignments uuid[];v_state text;
BEGIN
 v_item:=public.cleanup_lease(p_job_id,p_order_id,p_worker_id);
 SELECT * INTO j FROM admin_cleanup_jobs WHERE id=p_job_id;
 IF (SELECT initial_finished FROM admin_cleanup_items WHERE id=v_item) THEN RAISE EXCEPTION 'Use reconciliation finish';END IF;
 IF NOT coalesce(p_storage_success,false) THEN
  UPDATE admin_cleanup_items SET state='failed',worker_id=NULL,lease_until=NULL,error_code=CASE WHEN p_error_code='database_failed' THEN 'database_failed' ELSE 'storage_failed' END,error_message=CASE WHEN p_error_code='database_failed' THEN 'Ștergerea datelor a eșuat. Operația poate fi reluată.' ELSE 'Fișierele nu au fost eliminate complet. Operația poate fi reluată.' END WHERE id=v_item;
  RETURN public.cleanup_refresh_job(j.id);
 END IF;
 IF EXISTS(SELECT 1 FROM admin_cleanup_files WHERE item_id=v_item AND NOT initial_done) THEN RAISE EXCEPTION 'Storage checkpoint incomplete';END IF;
 PERFORM set_config('flowrise.cleanup_item',v_item::text,true);
 IF j.action IN ('files','all') THEN
  DELETE FROM work_order_files f USING admin_cleanup_files m WHERE m.item_id=v_item AND f.id=m.metadata_id;
 END IF;
 IF j.action IN ('clinical','all') THEN
  DELETE FROM lab_patient_cases WHERE lab_organization_id=j.lab_organization_id AND work_order_id=p_order_id;
 END IF;
 IF j.action='clinical' THEN
  UPDATE lab_work_orders SET nume_pacient=NULL,clinical_cleared_at=now(),clinical_cleanup_generation=clinical_cleanup_generation+1,updated_at=now() WHERE lab_organization_id=j.lab_organization_id AND id=p_order_id;
 END IF;
 IF j.action='all' THEN
  SELECT coalesce(array_agg(id),'{}') INTO v_assignments FROM lab_work_order_stage_assignments WHERE lab_organization_id=j.lab_organization_id AND work_order_id=p_order_id;
  DELETE FROM technician_payments WHERE assignment_id=ANY(v_assignments);
  DELETE FROM lab_work_order_assignment_adjustments WHERE assignment_id=ANY(v_assignments);
  DELETE FROM lab_work_order_assignment_cost_lines WHERE assignment_id=ANY(v_assignments);
  DELETE FROM lab_work_order_stage_assignments WHERE id=ANY(v_assignments);
  DELETE FROM lab_work_order_items WHERE lab_organization_id=j.lab_organization_id AND work_order_id=p_order_id;
  DELETE FROM lab_work_order_price_lines WHERE lab_organization_id=j.lab_organization_id AND work_order_id=p_order_id;
  DELETE FROM work_order_financial_audit WHERE lab_organization_id=j.lab_organization_id AND work_order_id=p_order_id;
  DELETE FROM lab_work_orders WHERE lab_organization_id=j.lab_organization_id AND id=p_order_id;
 END IF;
 v_state:=CASE WHEN j.action<>'clinical' AND EXISTS(SELECT 1 FROM admin_cleanup_files WHERE item_id=v_item) THEN 'awaiting_uploads' ELSE 'completed' END;
 UPDATE admin_cleanup_items SET state=v_state,initial_finished=true,worker_id=NULL,lease_until=NULL WHERE id=v_item;
 RETURN public.cleanup_refresh_job(j.id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_reconcile_finish(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_storage_success boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item uuid;j admin_cleanup_jobs%rowtype;
BEGIN
 v_item:=public.cleanup_lease(p_job_id,p_order_id,p_worker_id);SELECT * INTO j FROM admin_cleanup_jobs WHERE id=p_job_id;
 IF NOT (SELECT initial_finished FROM admin_cleanup_items WHERE id=v_item) OR j.reconcile_after IS NULL OR now()<j.reconcile_after THEN RAISE EXCEPTION 'Reconciliation not due';END IF;
 IF coalesce(p_storage_success,false) AND EXISTS(SELECT 1 FROM admin_cleanup_files WHERE item_id=v_item AND NOT reconciled) THEN RAISE EXCEPTION 'Reconciliation checkpoint incomplete';END IF;
 UPDATE admin_cleanup_items SET state=CASE WHEN coalesce(p_storage_success,false) THEN 'completed' ELSE 'failed' END,worker_id=NULL,lease_until=NULL,
 error_code=CASE WHEN NOT coalesce(p_storage_success,false) THEN 'reconciliation_failed' END,
 error_message=CASE WHEN NOT coalesce(p_storage_success,false) THEN 'Verificarea încărcărilor întârziate a eșuat.' END WHERE id=v_item;
 RETURN public.cleanup_refresh_job(j.id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_cleanup_due(p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cleanup_require_service();
 IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN RAISE EXCEPTION 'Invalid limit';END IF;
 SELECT coalesce(jsonb_agg(id),'[]') INTO result FROM (SELECT j.id FROM admin_cleanup_jobs j WHERE j.confirmed_at IS NOT NULL AND
 EXISTS(SELECT 1 FROM admin_cleanup_items i WHERE i.job_id=j.id AND (i.state IN ('pending','failed') OR (i.state='processing' AND i.lease_until<now()) OR (i.state='awaiting_uploads' AND j.reconcile_after<=now())))
 AND EXISTS(SELECT 1 FROM organization_memberships m JOIN profiles p ON p.id=m.user_id WHERE m.organization_id=j.lab_organization_id AND m.user_id=j.created_by AND m.status='active' AND lower(m.role)='admin' AND p.active)
 ORDER BY j.updated_at LIMIT p_limit) j;
 RETURN result;
END; $$;


CREATE OR REPLACE FUNCTION public.get_work_order_cleanup_state(p_lab_organization_id uuid,p_work_order_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.can_access_work_order(p_lab_organization_id,p_work_order_id),false) OR
 NOT (public.has_org_role(p_lab_organization_id,ARRAY['Admin','Manager','Technician']) OR public.is_connected_doctor_for_lab(p_lab_organization_id)) THEN RAISE EXCEPTION 'Access denied';END IF;
 SELECT jsonb_build_object('cleanup_revision',cleanup_revision::text,'clinical_cleanup_generation',clinical_cleanup_generation::text,'clinical_cleared_at',clinical_cleared_at)
 INTO result FROM lab_work_orders WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
 IF result IS NULL THEN RAISE EXCEPTION 'Work Order not found';END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_work_order_cleanup_state(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_work_order_cleanup_state(uuid,bigint) TO authenticated;

-- Both readers are STABLE and share this request's PostgreSQL snapshot.
-- Never attach a post-cleanup generation to pre-cleanup clinical content.
CREATE OR REPLACE FUNCTION public.get_work_order_clinical_snapshot(p_lab_organization_id uuid,p_work_order_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cleanup jsonb;v_case jsonb;
BEGIN
 v_cleanup:=public.get_work_order_cleanup_state(p_lab_organization_id,p_work_order_id);
 SELECT to_jsonb(c) INTO v_case FROM public.get_patient_case(p_lab_organization_id,p_work_order_id) c;
 RETURN jsonb_build_object('cleanup',v_cleanup,'case',v_case);
END; $$;
REVOKE ALL ON FUNCTION public.get_work_order_clinical_snapshot(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_work_order_clinical_snapshot(uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cleanup_worker_status(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_owner uuid;
BEGIN
 PERFORM public.cleanup_require_service();SELECT created_by INTO v_owner FROM admin_cleanup_jobs WHERE id=p_job_id;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Job not found';END IF;PERFORM public.cleanup_admin_lab(v_owner);RETURN public.cleanup_job_json(p_job_id);
END; $$;
CREATE OR REPLACE FUNCTION public.admin_cleanup_yield(p_job_id uuid,p_order_id bigint,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item uuid;
BEGIN
 v_item:=public.cleanup_lease(p_job_id,p_order_id,p_worker_id);
 UPDATE admin_cleanup_items SET state=CASE WHEN initial_finished THEN 'awaiting_uploads' ELSE 'pending' END,worker_id=NULL,lease_until=NULL WHERE id=v_item;
 RETURN public.cleanup_refresh_job(p_job_id);
END; $$;

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
   INSERT INTO admin_cleanup_files(item_id,bucket,object_path,metadata_id,size_bytes)
   SELECT v_item,'work-order-files',paths.path,f.id,public.cleanup_size(s.metadata)
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

-- All reads/mutations use checked RPCs; tables have no browser policies.
REVOKE ALL ON public.admin_cleanup_jobs,public.admin_cleanup_items,public.admin_cleanup_files,public.lab_work_order_id_watermarks FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['lab_work_orders','lab_patient_cases','work_order_files','lab_work_order_items','lab_work_order_price_lines','lab_work_order_stage_assignments','lab_work_order_assignment_cost_lines','lab_work_order_assignment_adjustments','technician_payments','work_order_financial_audit'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS cleanup_mutation_guard ON public.%I',t);
  EXECUTE format('CREATE TRIGGER cleanup_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cleanup_mutation_guard()',t);
 END LOOP;
END; $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'cleanup_%' OR p.proname LIKE 'admin_cleanup_%' OR p.proname='admin_storage_usage') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_storage_usage(),public.admin_cleanup_preview(text,date,date),public.admin_cleanup_status(uuid,integer,integer),public.admin_cleanup_jobs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_confirm(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_claim(uuid,uuid),public.admin_cleanup_files(uuid,bigint,uuid,integer,integer),public.admin_cleanup_checkpoint(uuid,bigint,uuid,text[],boolean),public.admin_cleanup_finish(uuid,bigint,uuid,boolean,text),public.admin_cleanup_due(integer),public.admin_cleanup_reconcile_finish(uuid,bigint,uuid,boolean) TO service_role;

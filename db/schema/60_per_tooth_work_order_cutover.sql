-- Authorized destructive cutover: no-item orders have no supported clinical scope.
-- apply.sql wraps this and the new API definitions in one transaction.
LOCK TABLE public.lab_work_orders,public.lab_work_order_items IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE per_tooth_removed_orders ON COMMIT DROP AS
SELECT wo.lab_organization_id,wo.id FROM public.lab_work_orders wo
WHERE NOT EXISTS(SELECT 1 FROM public.lab_work_order_items i
    WHERE i.lab_organization_id=wo.lab_organization_id AND i.work_order_id=wo.id);

-- Storage metadata can be deleted transactionally only on installations that permit it.
DO $$
BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
        BEGIN
            DELETE FROM storage.objects o USING public.work_order_files f,per_tooth_removed_orders d
            WHERE f.lab_organization_id=d.lab_organization_id AND f.legacy_work_order_id=d.id
              AND o.bucket_id=f.bucket_name AND o.name=f.object_path
              AND NOT EXISTS(SELECT 1 FROM public.work_order_files retained
                  WHERE retained.bucket_name=f.bucket_name AND retained.object_path=f.object_path
                    AND NOT EXISTS(SELECT 1 FROM per_tooth_removed_orders r
                        WHERE r.lab_organization_id=retained.lab_organization_id AND r.id=retained.legacy_work_order_id));
        EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
            RAISE NOTICE 'Storage service prevents transactional deletion; remove orphaned objects through Storage API: %',SQLERRM;
        END;
    END IF;
END $$;
DELETE FROM public.work_order_files f USING per_tooth_removed_orders d
WHERE f.lab_organization_id=d.lab_organization_id AND f.legacy_work_order_id=d.id;
DELETE FROM public.lab_patient_cases pc USING per_tooth_removed_orders d
WHERE pc.lab_organization_id=d.lab_organization_id AND pc.work_order_id=d.id;
DELETE FROM public.work_order_financial_audit a USING per_tooth_removed_orders d
WHERE a.lab_organization_id=d.lab_organization_id AND a.work_order_id=d.id;
DELETE FROM public.technician_payments p USING public.lab_work_order_stage_assignments a,per_tooth_removed_orders d
WHERE p.assignment_id=a.id AND a.lab_organization_id=d.lab_organization_id AND a.work_order_id=d.id;
DELETE FROM public.lab_work_order_assignment_adjustments l USING public.lab_work_order_stage_assignments a,per_tooth_removed_orders d
WHERE l.assignment_id=a.id AND a.lab_organization_id=d.lab_organization_id AND a.work_order_id=d.id;
DELETE FROM public.lab_work_order_assignment_cost_lines l USING public.lab_work_order_stage_assignments a,per_tooth_removed_orders d
WHERE l.assignment_id=a.id AND a.lab_organization_id=d.lab_organization_id AND a.work_order_id=d.id;
DELETE FROM public.lab_work_order_stage_assignments a USING per_tooth_removed_orders d
WHERE a.lab_organization_id=d.lab_organization_id AND a.work_order_id=d.id;
DELETE FROM public.lab_work_orders wo USING per_tooth_removed_orders d
WHERE wo.lab_organization_id=d.lab_organization_id AND wo.id=d.id;

-- Sanitize retained clinical JSON, including __case.material and tooth material.
DO $$
DECLARE c record; cleaned text;
BEGIN
    FOR c IN SELECT lab_organization_id,id,tooth_details_json FROM public.lab_patient_cases
        WHERE nullif(tooth_details_json,'') IS NOT NULL
    LOOP
        BEGIN cleaned:=public.sanitize_tooth_details(c.tooth_details_json::jsonb)::text;
        EXCEPTION WHEN invalid_text_representation THEN cleaned:='{}'; END;
        UPDATE public.lab_patient_cases SET tooth_details_json=cleaned
        WHERE lab_organization_id=c.lab_organization_id AND id=c.id AND tooth_details_json IS DISTINCT FROM cleaned;
    END LOOP;
END $$;

-- Obsolete overloads were removed in 20_functions/00_per_tooth_rpc_cutover.sql.
ALTER TABLE public.lab_work_orders DROP COLUMN IF EXISTS tip_lucrare,
    DROP COLUMN IF EXISTS nr_elemente,DROP COLUMN IF EXISTS snapshot_unit_price;
ALTER TABLE public.lab_patient_cases DROP COLUMN IF EXISTS tip_lucrare,DROP COLUMN IF EXISTS material;
ALTER TABLE public.lab_work_orders DROP CONSTRAINT IF EXISTS lab_work_orders_snapshot_prices_nonnegative;
ALTER TABLE public.lab_work_orders ADD CONSTRAINT lab_work_orders_snapshot_prices_nonnegative
    CHECK((snapshot_list_price IS NULL OR snapshot_list_price>=0) AND (snapshot_final_price IS NULL OR snapshot_final_price>=0));

CREATE OR REPLACE FUNCTION public.enforce_work_order_has_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid; v_id bigint;
BEGIN
    IF TG_TABLE_NAME='lab_work_orders' THEN v_lab:=NEW.lab_organization_id; v_id:=NEW.id;
    ELSE v_lab:=OLD.lab_organization_id; v_id:=OLD.work_order_id; END IF;
    -- Serialize deletion/replacement against the owning order, including concurrent transactions.
    PERFORM 1 FROM public.lab_work_orders WHERE lab_organization_id=v_lab AND id=v_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.lab_work_orders WHERE lab_organization_id=v_lab AND id=v_id AND archived_at IS NULL)
       AND NOT EXISTS(SELECT 1 FROM public.lab_work_order_items WHERE lab_organization_id=v_lab AND work_order_id=v_id) THEN
        RAISE EXCEPTION 'Active Work Order requires at least one configured tooth';
    END IF;
    RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_work_order_has_items() FROM public,authenticated;
DROP TRIGGER IF EXISTS work_order_has_items ON public.lab_work_orders;
CREATE CONSTRAINT TRIGGER work_order_has_items AFTER INSERT OR UPDATE ON public.lab_work_orders
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_has_items();
DROP TRIGGER IF EXISTS work_order_retains_items ON public.lab_work_order_items;
CREATE CONSTRAINT TRIGGER work_order_retains_items AFTER DELETE OR UPDATE ON public.lab_work_order_items
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_has_items();

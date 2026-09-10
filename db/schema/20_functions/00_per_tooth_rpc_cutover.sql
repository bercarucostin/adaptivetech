-- Changed return records cannot be replaced in place. Remove only known obsolete
-- contracts; the definitions and grants below recreate the current API.
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND (
            (p.proname IN ('get_my_work_orders','get_my_work_orders_v188','get_my_production','get_patient_case')
             AND pg_get_function_result(p.oid) ~ '\m(tip_lucrare|nr_elemente|material)\M')
            OR (p.proname IN ('create_work_order','create_technician_work_order','update_doctor_work_order',
                'update_management_work_order','update_management_work_order_v188','save_my_work_order_case','upsert_patient_case')
                AND p.proargnames && ARRAY['p_tip_lucrare','p_nr_elemente','p_material'])
            OR (p.proname='estimate_doctor_work_order_price' AND p.proargnames @> ARRAY['p_elements'])
        ) ORDER BY CASE WHEN p.proname='get_my_work_orders_v188' THEN 0 ELSE 1 END
    LOOP EXECUTE format('DROP FUNCTION %s',f.signature); END LOOP;
END $$;

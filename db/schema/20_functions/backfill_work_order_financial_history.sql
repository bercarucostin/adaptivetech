-- Backfill only stored item snapshots. Current catalogs cannot reconstruct history.
CREATE OR REPLACE FUNCTION public.backfill_work_order_financial_history(p_lab uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
    IF lower(coalesce(public.current_org_role(p_lab),''))<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
    UPDATE public.lab_work_orders wo SET
        snapshot_list_price=totals.list_price,
        snapshot_final_price=round(totals.list_price*(1-wo.discount/100),2),
        price_source='migration_items',price_fixed_at=now(),price_migrated=true
    FROM (SELECT work_order_id,CASE WHEN bool_and(line_total IS NOT NULL) THEN sum(line_total) END list_price
        FROM public.lab_work_order_items WHERE lab_organization_id=p_lab GROUP BY work_order_id) totals
    WHERE wo.lab_organization_id=p_lab AND wo.id=totals.work_order_id AND wo.price_fixed_at IS NULL
      AND wo.snapshot_list_price IS NULL AND wo.snapshot_final_price IS NULL;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    RETURN jsonb_build_object('prices',v_count,'assignments',0,'migration_balances',0);
END; $$;
REVOKE ALL ON FUNCTION public.backfill_work_order_financial_history(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_work_order_financial_history(uuid) TO authenticated;

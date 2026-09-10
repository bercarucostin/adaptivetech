-- Focused RPC for the management table's quick stage controls. Keeping this
-- path server-side also creates/ends immutable technician-cost assignments.
CREATE OR REPLACE FUNCTION public.update_management_work_order_stage_field(
    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_field text,
    p_value text,
    p_settlement text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.lab_work_orders%rowtype;
    v_field text := lower(trim(coalesce(p_field,'')));
    v_value text := nullif(trim(coalesce(p_value,'')),'');
    v_old_technician text;
    v_saved_technician text;
    v_changed boolean;
BEGIN
    IF NOT public.is_lab_management(p_lab_organization_id) THEN
        RAISE EXCEPTION 'Management access denied';
    END IF;

    SELECT * INTO v_order
    FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;

    IF v_field='status_model' THEN
        UPDATE public.lab_work_orders SET status_model=coalesce(v_value,'Not Started'),
            updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
    ELSIF v_field='status_modelare' THEN
        UPDATE public.lab_work_orders SET status_modelare=coalesce(v_value,'Not Started'),
            updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
    ELSIF v_field='status_cer_fin' THEN
        UPDATE public.lab_work_orders SET status_cer_fin=coalesce(v_value,'Not Started'),
            updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
    ELSIF v_field='tehnician_model' THEN
        v_old_technician:=v_order.tehnician_model;
        v_changed:=lower(trim(coalesce(v_old_technician,'')))
            IS DISTINCT FROM lower(trim(coalesce(v_value,'')));
        IF v_changed THEN
            PERFORM public.prepare_stage_reassignment(
                p_lab_organization_id,p_work_order_id,'model',v_value,p_settlement);
        END IF;
        UPDATE public.lab_work_orders SET tehnician_model=v_value,
            paid_model=CASE WHEN v_changed THEN 'Not Paid' ELSE paid_model END,
            status_model=CASE WHEN v_changed THEN 'Not Started' ELSE status_model END,
            status=CASE WHEN v_changed AND status NOT IN ('Not Started','Started') THEN 'Started' ELSE status END,
            updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
        RETURNING tehnician_model INTO v_saved_technician;
        PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'model',v_saved_technician);
    ELSIF v_field='tehnician1_modelare' THEN
        v_old_technician:=v_order.tehnician1_modelare;
        v_changed:=lower(trim(coalesce(v_old_technician,'')))
            IS DISTINCT FROM lower(trim(coalesce(v_value,'')));
        IF v_changed THEN
            PERFORM public.prepare_stage_reassignment(
                p_lab_organization_id,p_work_order_id,'modelare',v_value,p_settlement);
        END IF;
        UPDATE public.lab_work_orders SET tehnician1_modelare=v_value,
            paid_modelare=CASE WHEN v_changed THEN 'Not Paid' ELSE paid_modelare END,
            status_modelare=CASE WHEN v_changed THEN 'Not Started' ELSE status_modelare END,
            status=CASE WHEN v_changed AND status NOT IN ('Not Started','Started') THEN 'Started' ELSE status END,
            updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
        RETURNING tehnician1_modelare INTO v_saved_technician;
        PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'modelare',v_saved_technician);
    ELSIF v_field='tehnician2_cer_fin' THEN
        v_old_technician:=v_order.tehnician2_cer_fin;
        v_changed:=lower(trim(coalesce(v_old_technician,'')))
            IS DISTINCT FROM lower(trim(coalesce(v_value,'')));
        IF v_changed THEN
            PERFORM public.prepare_stage_reassignment(
                p_lab_organization_id,p_work_order_id,'cer_fin',v_value,p_settlement);
        END IF;
        UPDATE public.lab_work_orders SET tehnician2_cer_fin=v_value,
            paid_cer_fin=CASE WHEN v_changed THEN 'Not Paid' ELSE paid_cer_fin END,
            status_cer_fin=CASE WHEN v_changed THEN 'Not Started' ELSE status_cer_fin END,
            status=CASE WHEN v_changed AND status NOT IN ('Not Started','Started') THEN 'Started' ELSE status END,
            updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
        RETURNING tehnician2_cer_fin INTO v_saved_technician;
        PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'cer_fin',v_saved_technician);
    ELSE
        RAISE EXCEPTION 'Unsupported management stage field';
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_management_work_order_stage_field(uuid,bigint,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_management_work_order_stage_field(uuid,bigint,text,text,text) TO authenticated;

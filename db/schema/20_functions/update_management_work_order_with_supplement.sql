CREATE OR REPLACE FUNCTION public.update_management_work_order_with_supplement(

    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_deadline date,
    p_status text,
    p_nume_pacient text,
    p_nume_partener text,
    p_contract text,
    p_discount numeric,
    p_data_receptie timestamptz,
    p_tehnician_model text,
    p_tehnician1_modelare text,
    p_tehnician2_cer_fin text,
    p_status_model text,
    p_status_modelare text,
    p_status_cer_fin text,
    p_paid_model text,
    p_paid_modelare text,
    p_paid_cer_fin text,
    p_model_not_applicable boolean,
    p_modelare_not_applicable boolean,
    p_cer_fin_not_applicable boolean,
    p_locked boolean,
    p_model_settlement text DEFAULT NULL,
    p_modelare_settlement text DEFAULT NULL,
    p_cer_fin_settlement text DEFAULT NULL,
    p_items jsonb DEFAULT NULL,
    p_requested_contract text DEFAULT 'General',
    p_case jsonb DEFAULT '{}'::jsonb
,
    p_manual_supplement numeric DEFAULT NULL,
    p_manual_supplement_reason text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF public.is_lab_management(p_lab_organization_id) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required'; END IF;
    PERFORM public.update_management_work_order_v188(
        p_lab_organization_id=>p_lab_organization_id,
        p_work_order_id=>p_work_order_id,
        p_deadline=>p_deadline,
        p_status=>p_status,
        p_nume_pacient=>p_nume_pacient,
        p_nume_partener=>p_nume_partener,
        p_contract=>p_contract,
        p_discount=>p_discount,
        p_data_receptie=>p_data_receptie,
        p_tehnician_model=>p_tehnician_model,
        p_tehnician1_modelare=>p_tehnician1_modelare,
        p_tehnician2_cer_fin=>p_tehnician2_cer_fin,
        p_status_model=>p_status_model,
        p_status_modelare=>p_status_modelare,
        p_status_cer_fin=>p_status_cer_fin,
        p_paid_model=>p_paid_model,
        p_paid_modelare=>p_paid_modelare,
        p_paid_cer_fin=>p_paid_cer_fin,
        p_model_not_applicable=>p_model_not_applicable,
        p_modelare_not_applicable=>p_modelare_not_applicable,
        p_cer_fin_not_applicable=>p_cer_fin_not_applicable,
        p_locked=>p_locked,
        p_model_settlement=>p_model_settlement,
        p_modelare_settlement=>p_modelare_settlement,
        p_cer_fin_settlement=>p_cer_fin_settlement,
        p_items=>p_items,
        p_requested_contract=>p_requested_contract,
        p_case=>p_case
    );
    IF p_manual_supplement IS NOT NULL THEN
      PERFORM public.set_work_order_manual_supplement(p_lab_organization_id,p_work_order_id,p_manual_supplement,p_manual_supplement_reason);
    END IF;
    RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.update_management_work_order_with_supplement(uuid,bigint,date,text,text,text,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text,text,jsonb,text,jsonb,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_management_work_order_with_supplement(uuid,bigint,date,text,text,text,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text,text,jsonb,text,jsonb,numeric,text) TO authenticated;

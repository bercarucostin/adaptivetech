CREATE OR REPLACE FUNCTION public.ai_read_calendar(p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid:=public.get_flowrise_lab_id(); v_role text:=public.effective_lab_role(v_lab); v_rows jsonb;
BEGIN
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'Calendar access denied'; END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN RAISE EXCEPTION 'Calendar range must be between 0 and 366 days'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'ID',id,'Title',title,'Event_Type',event_type,'Description',description,'Status',status,
        'Start_Date',start_date,'End_Date',end_date,'Start_Time',start_time,
        'Calendar_Scope',calendar_scope,'Owner_User_ID',owner_user_id,'Updated_At',updated_at
    ) order by start_date,start_time,id),'[]'::jsonb) INTO v_rows
    FROM public.lab_calendar_events
    WHERE lab_organization_id=v_lab
      AND start_date<=p_to AND coalesce(end_date,start_date)>=p_from
      AND (v_role IN ('admin','manager') OR calendar_scope='shared' OR owner_user_id=auth.uid());
    RETURN v_rows;
END; $$;
REVOKE ALL ON FUNCTION public.ai_read_calendar(date,date) FROM public;
GRANT EXECUTE ON FUNCTION public.ai_read_calendar(date,date) TO authenticated;

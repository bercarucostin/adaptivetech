CREATE OR REPLACE FUNCTION public.enforce_calendar_event_edit_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
    IF public.effective_lab_role(old.lab_organization_id)='technician' THEN
        IF new.lab_organization_id<>old.lab_organization_id OR new.owner_user_id IS DISTINCT FROM old.owner_user_id THEN
            RAISE EXCEPTION 'Technician cannot change event owner';
        END IF;
        IF old.owner_user_id IS DISTINCT FROM auth.uid() AND new.calendar_scope IS DISTINCT FROM old.calendar_scope THEN
            RAISE EXCEPTION 'Technician cannot change another user event scope';
        END IF;
    END IF;
    RETURN new;
END; $$;

-- ---------------------------------------------------------------------
-- Phase 40 — privileges.
--
-- This phase did not exist before: the snapshot exported no GRANT or REVOKE
-- metadata at all. That matters more here than in most schemas, because the
-- browser talks to PostgREST directly with a publishable key. Table and
-- function privileges are part of the security boundary, not paperwork.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 1. profiles must not be self-writable.  [APPLIED IN PRODUCTION 2026-09-09]
--
-- The schema previously carried:
--
--   create policy "profiles self update" on public.profiles
--     for update to authenticated
--     using (id = auth.uid()) with check (id = auth.uid());
--
-- That restricts WHICH ROW you may write, not WHICH COLUMNS. Every column
-- except id was therefore writable by its owner -- including the four the
-- authorization model reads:
--
--   display_name, legacy_partner_name, legacy_user_id
--       doctor_matches_partner() matches a work order's nume_partener
--       against all three, so a doctor could rename themselves onto another
--       partner's cases.
--   technician_name
--       current_technician_name() decides which work orders a technician is
--       assigned to.
--   active
--       the disable switch, checked by login-with-identifier and by
--       doctor_matches_partner. A deactivated user holding a live session
--       could set it back to true.
--
-- Sixteen functions decide access this way -- get_my_work_orders,
-- get_my_production, get_my_salary, update_doctor_work_order,
-- delete_doctor_work_order, upsert_patient_case, can_access_work_order and
-- ai_mutate_work_order among them -- so the reachable data included patient
-- names and other technicians' pay.
--
-- What bounded it: organization_memberships has no write policy at all, so
-- nobody could grant themselves a role. The escalation was within a role,
-- never up to Admin.
--
-- The policy is dropped in 30_policies/01_profiles.sql, where the DROP is
-- kept and the CREATE is not. That alone is sufficient: with RLS enabled and
-- no UPDATE policy, Postgres denies the write. The REVOKE below is a second,
-- independent layer, because Supabase's defaults include
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated -- so if RLS were
-- ever disabled on this table, the grant would be all that remained.
--
-- Nothing legitimate used the policy: the frontend never touches profiles
-- (zero references in app.js), no SQL function writes it, and all three Edge
-- Functions write it through service_role, which bypasses both RLS and this
-- grant. Profile edits go through admin-users, which checks for an active
-- Admin membership first.
--
-- If self-service editing is ever wanted, do NOT restore the policy. Grant
-- named columns that nothing authorizes on:
--     grant update (some_safe_column) on public.profiles to authenticated;
-- ---------------------------------------------------------------------

revoke update on public.profiles from authenticated;


-- ---------------------------------------------------------------------
-- 2. Function execution — STILL TO BE VERIFIED against production.
--
-- In PostgreSQL a newly created function is executable by PUBLIC by default,
-- and Supabase grants anon and authenticated usage on the public schema. So
-- unless something revoked it, every function in 20_functions/ is callable
-- with nothing but the publishable key, which is public by design.
--
-- Most are harmless anonymously: they resolve the caller through auth.uid(),
-- which is null for anon, and return nothing or raise. These three succeed
-- for an anonymous caller and leak small facts:
--
--   get_flowrise_lab_id()      the lab's UUID
--   organization_is_type()     probes an organization's type
--   next_lab_work_order_id()   reveals the live work-order count
--
-- List what anon can actually execute:
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--   order by 2 desc, 1;
--
-- Then revoke what anon does not need, per function:
--
--   revoke execute on function public.get_flowrise_lab_id() from anon;
--
-- Deliberately NOT applied blind here: revoking execute on a function the
-- frontend does call would break the application at runtime, and the call
-- sites cannot be confirmed from the schema alone.
-- ---------------------------------------------------------------------

-- Financial history is append-only from the browser. SECURITY DEFINER RPCs
-- own every write so callers cannot rewrite payments or their audit trail.
revoke insert, update, delete on table public.lab_work_order_stage_assignments from authenticated;
revoke insert, update, delete on table public.lab_work_order_assignment_cost_lines from authenticated;
revoke insert, update, delete on table public.technician_payments from authenticated;
revoke insert, update, delete on table public.work_order_financial_audit from authenticated;
revoke insert, update, delete on table public.ai_operation_previews from authenticated;
revoke insert, update, delete on table public.ai_operation_requests from authenticated;
revoke insert, update, delete on table public.lab_work_order_items from anon, authenticated;
revoke insert, update, delete on table public.lab_work_order_price_lines from anon, authenticated;
revoke insert, update, delete on table public.lab_work_orders from anon, authenticated;
revoke insert (
    lab_organization_id,work_order_id,tooth_number,work_type,contract,unit_price,
    quantity,line_total,price_source,price_fixed_at,price_migrated,
    created_by_user_id,updated_by_user_id,created_at,updated_at
) on public.lab_work_order_items from anon, authenticated;
revoke update (
    lab_organization_id,work_order_id,tooth_number,work_type,contract,unit_price,
    quantity,line_total,price_source,price_fixed_at,price_migrated,
    created_by_user_id,updated_by_user_id,created_at,updated_at
) on public.lab_work_order_items from anon, authenticated;
revoke insert (
    lab_organization_id,id,deadline,status,nume_pacient,nume_partener,contract,
    tehnician_model,tehnician1_modelare,tehnician2_cer_fin,
    status_model,status_modelare,status_cer_fin,paid_model,paid_modelare,
    paid_cer_fin,created_by_user_id,created_at,updated_by_user_id,updated_at,
    discount,data_receptie,locked,model_not_applicable,
    modelare_not_applicable,cer_fin_not_applicable,migrated_at,
    snapshot_list_price,snapshot_final_price,price_source,
    price_fixed_at,price_migrated,archived_at
) on public.lab_work_orders from anon, authenticated;
revoke update (
    lab_organization_id,id,deadline,status,nume_pacient,nume_partener,contract,
    tehnician_model,tehnician1_modelare,tehnician2_cer_fin,
    status_model,status_modelare,status_cer_fin,paid_model,paid_modelare,
    paid_cer_fin,created_by_user_id,created_at,updated_by_user_id,updated_at,
    discount,data_receptie,locked,model_not_applicable,
    modelare_not_applicable,cer_fin_not_applicable,migrated_at,
    snapshot_list_price,snapshot_final_price,price_source,
    price_fixed_at,price_migrated,archived_at
) on public.lab_work_orders from anon, authenticated;

-- Public per-tooth RPC contracts. Internal writers/resolvers stay inaccessible.
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('create_work_order','create_management_work_order','create_technician_work_order',
        'update_doctor_work_order','update_management_work_order_v188','upsert_patient_case',
        'save_my_work_order_case','get_patient_case','get_my_work_orders','get_my_work_orders_v188','get_my_production')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public,anon',f.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
    END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.lab_patient_cases FROM anon,authenticated;
REVOKE ALL ON public.lab_work_order_assignment_adjustments FROM anon,authenticated;

-- Authenticated commercial reads are bounded by restrictive role/row policies.
REVOKE SELECT ON public.lab_work_order_items FROM public, anon;
GRANT SELECT ON public.lab_work_order_items TO authenticated;
REVOKE SELECT ON public.lab_work_order_price_lines FROM public, anon;
GRANT SELECT ON public.lab_work_order_price_lines TO authenticated;

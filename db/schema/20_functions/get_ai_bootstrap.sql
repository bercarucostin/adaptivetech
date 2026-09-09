-- Flowrise Supabase function: public.get_ai_bootstrap(p_session_id text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_ai_bootstrap(p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_role text := public.effective_lab_role(public.get_flowrise_lab_id());
    v_history jsonb := '[]'::jsonb;
    v_catalog jsonb := '[]'::jsonb;
begin
    if v_role is null then
        return jsonb_build_object(
            'allowed', false,
            'message', 'No active Flowrise role'
        );
    end if;

    if v_role in ('doctor','dashboard') then
        return jsonb_build_object(
            'allowed', false,
            'role', v_role,
            'message', 'AI is disabled for this role'
        );
    end if;

    select coalesce(jsonb_agg(x.obj order by x.created_at),'[]'::jsonb)
      into v_history
    from (
        select
            ch.created_at,
            jsonb_build_object(
                'role', ch.role,
                'message', ch.message,
                'created_at', ch.created_at
            ) as obj
        from public.lab_chat_history ch
        where ch.lab_organization_id = v_lab
          and lower(coalesce(ch.user_id,'')) =
              lower(coalesce(public.current_legacy_user_id(),''))
          and ch.session_id = p_session_id
          and ch.message is not null
          and ch.role in ('user','assistant')
        order by ch.created_at desc nulls last, ch.id desc
        limit 14
    ) x;

    if v_role in ('admin','manager') then
        v_catalog := jsonb_build_array(
            jsonb_build_object('dataset','users','description','Sanitized users/profiles/memberships, including email. No passwords, hashes, tokens or credentials.'),
            jsonb_build_object('dataset','organizations','description','Clinics and laboratories.'),
            jsonb_build_object('dataset','organization_memberships','description','User membership and role per organization.'),
            jsonb_build_object('dataset','organization_relationships','description','Clinic-Lab relationships and status.'),
            jsonb_build_object('dataset','lab_profiles','description','Laboratory profile/discovery configuration.'),
            jsonb_build_object('dataset','lab_public_offers','description','Public laboratory offers.'),
            jsonb_build_object('dataset','relationship_terms','description','Clinic-Lab commercial terms.'),
            jsonb_build_object('dataset','relationship_prices','description','Optional negotiated prices attached to new organization relationships. This table may be empty; do not use it for legacy Work Order financial summaries.'),
            jsonb_build_object('dataset','work_orders','description','All operational Work Orders and stage/payment fields. Rows also include matched contract unit_price, list_price, final_price and price_matched for financial summaries by partner.'),
            jsonb_build_object('dataset','patient_cases','description','All dental prescription / patient case rows.'),
            jsonb_build_object('dataset','work_types','description','Configured work types.'),
            jsonb_build_object('dataset','contract_prices','description','Authoritative legacy Contract + work-type client price list. Use with work_orders for management financial summaries; do not substitute relationship_prices.'),
            jsonb_build_object('dataset','technician_costs','description','Technician cost configuration for all technicians.'),
            jsonb_build_object('dataset','calendar_events','description','Laboratory calendar events.'),
            jsonb_build_object('dataset','materials_inventory','description','Materials stock and reorder thresholds.'),
            jsonb_build_object('dataset','chat_history','description','Application AI chat history stored in Supabase.'),
            jsonb_build_object('dataset','work_order_files','description','Work Order file metadata; does not contain file binary contents.'),
            jsonb_build_object('dataset','role_permissions','description','Application permission matrix.'),
            jsonb_build_object('dataset','legacy_user_directory','description','Non-secret legacy user mapping retained for migration compatibility.')
        );

    elsif v_role = 'technician' then
        v_catalog := jsonb_build_array(
            jsonb_build_object(
                'dataset','my_work_orders',
                'description','Only Work Orders where this technician is assigned. Contains order/global status, own assigned stages, own stage status, own payment status and own compensation.'
            ),
            jsonb_build_object(
                'dataset','my_receivables',
                'description','Only this technician own compensation: accrued, paid and outstanding amounts, including a ready-to-use By_Partner summary. Use this for Technician financial summaries by partner; no client sale prices are needed.'
            ),
            jsonb_build_object(
                'dataset','work_types',
                'description','Active work type names only. No client price, contract or partner commercial information.'
            )
        );

    else
        return jsonb_build_object(
            'allowed', false,
            'role', v_role,
            'message', 'AI is not enabled for this role'
        );
    end if;

    return jsonb_build_object(
        'allowed', true,
        'role', v_role,
        'history', v_history,
        'catalog', v_catalog
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_session_id text

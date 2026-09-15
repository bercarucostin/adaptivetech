"""Cross-layer contracts; runtime financial/ACL scenarios live in per_tooth_work_orders.sql."""
import pathlib
import re
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[2]
def read(name): return (ROOT / name).read_text()
def sql(name): return read('db/schema/20_functions/' + name + '.sql')
class IntegrationRegressions(unittest.TestCase):
    def test_technician_salary_is_resolved_from_canonical_billing_scope(self):
        self.assertTrue((ROOT / 'db/schema/20_functions/resolve_work_order_technician_costs.sql').is_file())
        resolver = sql('resolve_work_order_technician_costs')
        self.assertIn('FROM public.work_order_billing_scope', resolver)
        self.assertNotIn('FROM public.lab_work_order_items', resolver)
        self.assertIn('billing_mode', resolver)
        self.assertIn('public.lab_technician_costs', resolver)
        self.assertRegex(resolver, r'round\(tc\.cost\s*\*\s*scope\.quantity,\s*2\)')

        sync = sql('sync_work_order_stage_assignment')
        self.assertIn('public.resolve_work_order_technician_costs', sync)
        self.assertIn('repair_incomplete', sync)
        self.assertIn('repair_aggregate', sync)
        self.assertIn('WITH effective_saved AS', sync)
        self.assertIn('saved.billing_mode', sync)
        self.assertIn('quantity_delta', sync)
        self.assertIn('EXISTS (SELECT 1 FROM public.lab_work_order_assignment_cost_lines base', sync)
        self.assertIn('Missing technician cost configuration', sync)
        self.assertIn('v_current.agreed_amount IS DISTINCT FROM v_saved_amount', sync)
        self.assertNotIn('DELETE FROM public.lab_work_order_assignment_cost_lines', sync)

    def test_salary_reconciliation_repairs_existing_assignments(self):
        backfill = sql('backfill_work_order_financial_history')
        self.assertIn('public.sync_work_order_stage_assignment', backfill)
        self.assertNotIn("'assignments',0", backfill.replace(' ', ''))
        self.assertIn("'missing_costs'", backfill)
        self.assertIn("'unresolved_assignments'", backfill)
        self.assertIn("action='repair_incomplete'", backfill)
        self.assertNotIn('archived_at IS NULL', backfill)

        reader = sql('get_my_work_orders')
        costs = reader[reader.index('from (select a.stage_key'):]
        self.assertIn('a.ended_at is null', costs.lower())

    def test_missing_salary_is_not_coerced_to_zero_in_the_app(self):
        app = read('website/app/app.js')
        start = app.index('function mapSupabaseOrder(')
        mapper = app[start:start + 18000]
        self.assertIn('nullableMoney(r.cost_model)', mapper)
        self.assertIn('nullableMoney(row.amount)', mapper)
        self.assertIn('Cost neconfigurat', app)

    def test_management_create_is_one_transactional_rpc(self):
        source = sql('create_work_order')
        self.assertIn('FUNCTION public.create_management_work_order(', source)
        body = source.split('FUNCTION public.create_management_work_order(')[1]
        self.assertIn('public.is_lab_management', body)
        self.assertIn('p_items jsonb', body)
        self.assertIn('p_case jsonb', body)
        self.assertLess(body.index('public.create_work_order('), body.index('sync_work_order_stage_assignment'))
        self.assertIn('p_status_model', body)
        self.assertIn('p_locked', body)
        self.assertIn('create_management_work_order', sql('ai_mutate_work_order'))
        app = read('website/app/app.js')
        submit = app[app.index('async function handleSupabaseOrderSubmit('):]
        self.assertNotIn('await saveManagementWorkOrderSupabase(savedId', submit)
        self.assertIn('create_management_work_order', app)
    def test_payment_status_reads_and_actions_use_actual_balance(self):
        helper = sql('assignment_agreed_amount')
        self.assertIn('FUNCTION public.work_order_stage_payment_status(', helper)
        self.assertIn('public.technician_payments', helper)
        for reader in ['get_my_work_orders', 'get_ai_context']:
            self.assertNotRegex(sql(reader), r'wo\.paid_(model|modelare|cer_fin)')
            self.assertIn('public.work_order_stage_payment_status', sql(reader))
        self.assertNotRegex(sql('update_management_work_order_v188'), r'coalesce\(v_saved\.paid_')
        self.assertNotRegex(sql('set_stage_payment_status'), r'v_order\.paid_')
        self.assertNotRegex(sql('ai_mutate_work_order'), r"coalesce\(v_fields->>'Paid_\w+',v_order\.paid_")
    def test_case_contract_has_explicit_keys_and_object_details(self):
        case = sql('save_work_order_clinical_case')
        self.assertIn('jsonb_object_keys(p_case)', case)
        self.assertIn('Unsupported clinical case field', case)
        for field in ['tooth_details','tooth_details_json','clinic_note','shade','method','production_notes']:
            self.assertIn("'" + field + "'", case)
        app = read('website/app/app.js')
        payload = app[app.index('function caseDraftPayload('):app.index('function hasMeaningfulCaseData(')]
        self.assertNotIn('selected_teeth:', payload)
    def test_raw_item_rls_blocks_technician_commercial_access(self):
        policy = read('db/schema/30_policies/24_work_order_items.sql').lower()
        self.assertIn('as restrictive', policy)
        self.assertIn('public.is_lab_management', policy)
        self.assertIn('public.is_connected_doctor_for_lab', policy)
        self.assertIn('public.can_access_work_order', policy)
        self.assertRegex(read('db/schema/40_grants.sql').lower(), r'revoke select on (?:table )?public.lab_work_order_items from public,\s*anon')
if __name__ == '__main__': unittest.main()

"""Cross-layer contracts; runtime financial/ACL scenarios live in per_tooth_work_orders.sql."""
import pathlib
import re
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[2]
def read(name): return (ROOT / name).read_text()
def sql(name): return read('db/schema/20_functions/' + name + '.sql')
class IntegrationRegressions(unittest.TestCase):
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

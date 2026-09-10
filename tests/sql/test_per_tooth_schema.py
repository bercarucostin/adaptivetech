import pathlib
import re
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[2] / 'db/schema'
def read(name): return (ROOT / name).read_text()
class PerToothSchema(unittest.TestCase):
    def test_function_definition_headers(self):
        for p in (ROOT / '20_functions').glob('*.sql'):
            self.assertNotRegex(p.read_text(),r'(?m)^CREATE OR REPLACE FUNCTION definition|^-- The complete CREATE OR REPLACE FUNCTION public\.',str(p))
    def test_removed_scalar_columns(self):
        self.assertNotRegex(read('10_tables/15_lab_work_orders.sql'), r'\b(tip_lucrare|nr_elemente|snapshot_unit_price)\b')
        self.assertNotRegex(read('10_tables/11_lab_patient_cases.sql'), r'\b(tip_lucrare|material)\b')
    def test_atomic_role_writers(self):
        for name in ['create_work_order','create_technician_work_order','update_doctor_work_order','save_my_work_order_case','update_management_work_order_v188']:
            sql = read('20_functions/' + name + '.sql')
            self.assertRegex(sql, r'p_items jsonb')
            self.assertNotRegex(sql, r'\bp_(tip_lucrare|nr_elemente|material)\b')
            self.assertIn('replace_work_order_items', sql)
        sql = read('20_functions/create_technician_work_order.sql')
        self.assertLess(sql.index('replace_work_order_items'),sql.index('sync_work_order_stage_assignment'))
    def test_item_read_models(self):
        for name in ['get_my_work_orders','get_my_work_orders_v188','get_my_production']:
            sql = read('20_functions/' + name + '.sql')
            for field in ['items','work_types','work_type_summary','element_count']: self.assertIn(field,sql)
            self.assertNotRegex(sql,r'\b(tip_lucrare|nr_elemente|snapshot_unit_price)\b')
    def test_cost_history(self):
        self.assertNotRegex(read('20_functions/sync_work_order_stage_assignment.sql'), r'v_order\.(nr_elemente|tip_lucrare)')
        self.assertIn('scope_change',read('20_functions/replace_work_order_items.sql'))
    def test_cutover(self):
        self.assertTrue((ROOT / '60_per_tooth_work_order_cutover.sql').exists(), 'cutover migration missing')
        sql = read('60_per_tooth_work_order_cutover.sql').lower()
        for token in ['delete from public.technician_payments','delete from public.lab_work_order_assignment_cost_lines','deferrable initially deferred']: self.assertIn(token,sql)
        self.assertIn('60_per_tooth_work_order_cutover.sql',read('apply.sql'))
if __name__ == '__main__': unittest.main()

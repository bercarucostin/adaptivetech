import pathlib
import re
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]/'db/schema'
def read(name):return (ROOT/name).read_text()
class ReviewRegressions(unittest.TestCase):
    def test_management_cost_totals_use_frozen_assignments(self):
        for name in ['get_my_work_orders','get_my_work_orders_v188']:
            sql=read('20_functions/'+name+'.sql')
            for field in ['cost_model','cost_modelare','cost_cer_fin']:self.assertIn(field,sql)
        self.assertIn('public.assignment_agreed_amount',read('20_functions/get_my_work_orders.sql'))
    def test_scope_audit_constraint_upgrade(self):
        sql=read('10_tables/27_work_order_financial_audit.sql')
        self.assertIn("'work_order_scope'",sql)
        self.assertRegex(sql,r'(?i)drop constraint')
    def test_technician_contract_is_server_controlled(self):
        sql=read('20_functions/replace_work_order_items.sql')
        self.assertRegex(sql,r"(?is)if v_role='technician' then\s+p_requested_contract\s*:=\s*coalesce\(.*?v_order.contract")
    def test_raw_item_writer_is_private(self):
        sql=read('20_functions/replace_work_order_items.sql').lower()
        self.assertIn('from public,anon,authenticated',sql)
        self.assertNotRegex(sql,r'grant execute.*?to authenticated')
    def test_fdi_constraint_is_migrated_after_cleanup(self):
        sql=read('60_per_tooth_work_order_cutover.sql').lower()
        self.assertIn('or exists(select 1 from public.lab_work_order_items invalid',sql)
        self.assertIn('lab_work_order_items_fdi_check',sql)
        self.assertIn('validate constraint lab_work_order_items_fdi_check',sql)
        self.assertLess(sql.index('delete from public.lab_work_orders'),sql.index('validate constraint lab_work_order_items_fdi_check'))
    def test_ai_payment_status_uses_adjusted_amount_and_payments(self):
        sql=read('20_functions/ai_technician_work_orders.sql')
        self.assertIn('public.technician_payments',sql)
        self.assertIn('cost_rule.paid_amount>=cost_rule.agreed_amount',sql)
        self.assertNotIn('s.payment_status',sql)
    def test_price_audit_item_shapes_match(self):
        sql=read('20_functions/replace_work_order_items.sql')
        before=sql[sql.index('select coalesce(jsonb_agg'):sql.index('into v_before_lines')]
        after=sql[sql.index('select sum(quantity)'):sql.index('into v_count,v_list')]
        keys=lambda text:set(re.findall(r"'([a-z_]+)'\s*,",text))
        self.assertEqual(keys(before),keys(after)-{'admin_override'})
    def test_technician_ai_can_update_through_atomic_writer(self):
        sql=read('20_functions/ai_mutate_work_order_role_safe.sql')
        self.assertIn("v_action='update'",sql)
        self.assertIn('public.save_my_work_order_case',sql)
        self.assertIn('public.can_access_work_order',sql)
        self.assertNotIn("if v_action <> 'create'",sql)
if __name__=='__main__':unittest.main()

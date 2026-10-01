from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "db/migrations/20261001_lab_partner_orders.sql"
FILE_AUTH = ROOT / "db/edge-functions/authorize-work-order-file/index.ts"


class LabPartnerOrderMigrationTests(unittest.TestCase):
    def test_lab_partner_order_migration_defines_secure_order_workflow(self):
        sql = MIGRATION.read_text()
        required = (
            "CREATE TABLE IF NOT EXISTS public.lab_partner_user_links",
            "CREATE TABLE IF NOT EXISTS public.lab_partner_work_order_items",
            "CREATE TABLE IF NOT EXISTS public.lab_partner_work_order_price_lines",
            "CREATE TABLE IF NOT EXISTS public.lab_work_order_approval_events",
            "ADD COLUMN IF NOT EXISTS order_origin",
            "ADD COLUMN IF NOT EXISTS approval_state",
            "ADD COLUMN IF NOT EXISTS deadline_at",
            "CREATE OR REPLACE FUNCTION public.estimate_lab_partner_work_order_price",
            "CREATE OR REPLACE FUNCTION public.create_lab_partner_work_order",
            "CREATE OR REPLACE FUNCTION public.review_external_work_order",
            "Europe/Bucharest",
        )
        for fragment in required:
            self.assertIn(fragment, sql)


    def test_migration_exposes_pricing_precedence_and_external_defaults(self):
        sql = MIGRATION.read_text()
        self.assertIn("urgent_percent_override", sql)
        self.assertIn("processing_amount_override", sql)
        self.assertIn("processing_enabled", sql)
        self.assertIn("order_origin='internal'", sql)
        self.assertIn("approval_state='approved'", sql)

    def test_file_authorizer_scopes_lab_partner_to_linked_partner(self):
        source = FILE_AUTH.read_text()
        self.assertIn("lab_partner_user_links", source)
        self.assertIn("link.partner_id !== order.partner_id", source)
        self.assertIn("Lab Partner can access files only for its assigned partner.", source)


if __name__ == "__main__":
    unittest.main()

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "db/schema"


def read(relative_path):
    path = ROOT / relative_path
    if not path.is_file():
        raise AssertionError(f"required schema file is missing: {relative_path}")
    return path.read_text()


class BillingModeContracts(unittest.TestCase):
    def test_catalog_mode_is_idempotent_and_constrained(self):
        source = read("db/schema/10_tables/16_lab_work_types.sql").lower()
        self.assertRegex(source, r"billing_mode[\"\s]+text\s+not null\s+default\s+'per_tooth'")
        self.assertRegex(source, r"add column if not exists\s+billing_mode\s+text\s+not null\s+default\s+'per_tooth'")
        self.assertIn("lab_work_types_billing_mode_check", source)
        for mode in ("per_tooth", "per_arch", "per_piece"):
            self.assertIn("'" + mode + "'", source)

    def test_price_lines_are_frozen_financial_authority(self):
        source = read("db/schema/10_tables/24a_work_order_price_lines.sql")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.lab_work_order_price_lines", source)
        self.assertRegex(
            source,
            r"PRIMARY KEY\s*\(lab_organization_id,\s*work_order_id,\s*work_type,\s*billing_scope\)",
        )
        for column in (
            "billing_mode",
            "billing_scope",
            "contract",
            "unit_price",
            "quantity",
            "line_total",
            "price_source",
            "price_fixed_at",
            "price_migrated",
            "created_at",
            "updated_at",
        ):
            self.assertRegex(source, rf"\b{column}\b")
        self.assertIn("FROM public.lab_work_order_items", source)
        self.assertIn("'tooth:' || i.tooth_number::text", source)
        self.assertIn("ON CONFLICT DO NOTHING", source)
        self.assertIn("i.price_fixed_at IS NOT NULL", source)
        self.assertNotIn("lab_contract_work_prices", source)
        self.assertNotIn("lab_work_types", source)

    def test_shared_helpers_define_canonical_units_and_saved_scope(self):
        derive = read("db/schema/20_functions/derive_billing_units.sql")
        self.assertIn("FUNCTION public.derive_billing_units", derive)
        self.assertIn("lower(trim", derive)
        for scope in ("tooth:", "arch:upper", "arch:lower", "piece"):
            self.assertIn(scope, derive)
        self.assertIn("Unknown billing mode", derive)

        saved_scope = read("db/schema/20_functions/work_order_billing_scope.sql")
        self.assertIn("FUNCTION public.work_order_billing_scope", saved_scope)
        self.assertIn("public.lab_work_order_price_lines", saved_scope)
        self.assertIn("GROUP BY lower(trim(line.work_type)),line.billing_mode", saved_scope)
        self.assertNotIn("public.lab_work_types", saved_scope)
        self.assertNotIn("public.lab_contract_work_prices", saved_scope)

    def test_estimation_and_replacement_use_billing_units(self):
        estimate = read("db/schema/20_functions/estimate_work_order_items.sql")
        self.assertIn("coalesce(v_role,'') NOT IN", estimate)
        self.assertIn("public.derive_billing_units", estimate)
        self.assertIn("billing_mode", estimate)
        self.assertIn("billing_scope", estimate)
        self.assertIn("element_count", estimate)

        replace = read("db/schema/20_functions/replace_work_order_items.sql")
        self.assertIn("public.derive_billing_units", replace)
        self.assertIn("public.lab_work_order_price_lines", replace)
        self.assertIn("public.work_order_billing_scope", replace)
        self.assertIn("before_price_lines", replace)
        self.assertIn("after_price_lines", replace)
        self.assertIn("existing_unit.billing_scope=desired.billing_scope", replace)
        self.assertIn("coalesce(existing_unit.work_type,desired.work_type)", replace)

        clinical = read("db/schema/20_functions/work_order_item_scope.sql")
        self.assertIn("count(*)", clinical.lower())
        self.assertNotRegex(clinical.lower(), r"element_count[^$]*sum\(quantity\)")
        for financial_field in (
            "i.contract",
            "i.unit_price",
            "i.line_total",
            "i.price_source",
            "i.price_fixed_at",
            "i.price_migrated",
        ):
            self.assertNotIn(financial_field, clinical)

    def test_price_line_read_and_access_boundary(self):
        reader = read("db/schema/20_functions/get_work_order_price_lines.sql")
        self.assertIn("FUNCTION public.get_work_order_price_lines", reader)
        self.assertIn("public.lab_work_order_price_lines", reader)
        self.assertRegex(reader, r"admin.*manager.*doctor")
        self.assertIn("Price line access denied", reader)
        self.assertIn("coalesce(v_role,'') NOT IN", reader)
        self.assertIn("GRANT EXECUTE", reader)
        self.assertIn("SELECT count(*) FROM public.lab_work_order_items", reader)

        policy = read("db/schema/30_policies/24a_work_order_price_lines.sql")
        self.assertIn("AS RESTRICTIVE FOR SELECT TO authenticated", policy)
        self.assertIn("public.is_lab_management", policy)
        self.assertIn("public.is_connected_doctor_for_lab", policy)
        self.assertIn("public.can_access_work_order", policy)

        grants = read("db/schema/40_grants.sql")
        self.assertRegex(
            grants,
            r"revoke insert,\s*update,\s*delete on table public\.lab_work_order_price_lines from anon,\s*authenticated",
        )

    def test_price_line_authority_covers_override_history_backfill_and_delete(self):
        override = read("db/schema/20_functions/set_work_order_price_snapshot.sql")
        self.assertIn("UPDATE public.lab_work_order_price_lines", override)
        self.assertNotIn("UPDATE public.lab_work_order_items", override)
        self.assertIn("v_unit_price:=round(p_unit_price,2)", override)
        self.assertRegex(override, r"SELECT round\(sum\(line\.line_total\),2\) INTO v_list")
        self.assertNotRegex(override, r"p_unit_price\s*\*\s*sum")

        history = read("db/schema/20_functions/get_work_order_financial_history.sql")
        self.assertIn("Price_Lines", history)
        self.assertIn("public.lab_work_order_price_lines", history)

        backfill = read("db/schema/20_functions/backfill_work_order_financial_history.sql")
        self.assertIn("public.lab_work_order_price_lines", backfill)
        self.assertIn("public.lab_work_order_items", backfill)
        self.assertIn("i.price_fixed_at IS NOT NULL", backfill)
        self.assertNotIn("resolve_work_order_price_snapshot", backfill)
        self.assertNotIn("public.lab_contract_work_prices", backfill)

        for function_name in ("delete_management_work_order", "delete_doctor_work_order"):
            source = read(f"db/schema/20_functions/{function_name}.sql")
            self.assertIn("public.lab_work_order_price_lines", source)

    def test_management_ai_reads_saved_price_lines(self):
        source = read("db/schema/20_functions/ai_read_dataset.sql")
        self.assertIn("coalesce(v_role,'') not in ('admin','manager')", source)
        work_orders = source[source.index("elsif v_dataset = 'work_orders'"):source.index("elsif v_dataset = 'financial_history'")]
        self.assertIn("price_lines", work_orders)
        self.assertIn("public.lab_work_order_price_lines", work_orders)

        technician = source[source.index("if v_role = 'technician'"):source.index("if coalesce(v_role,'') not in ('admin','manager')")]
        self.assertNotIn("public.lab_work_order_price_lines", technician)

    def test_legacy_price_migration_filters_invalid_fdi_before_cutover(self):
        for relative_path in (
            "db/schema/10_tables/24a_work_order_price_lines.sql",
            "db/schema/20_functions/backfill_work_order_financial_history.sql",
        ):
            source = read(relative_path)
            self.assertRegex(source, r"i\.tooth_number\s*/\s*10\s+BETWEEN\s+1\s+AND\s+4")
            self.assertRegex(source, r"i\.tooth_number\s*%\s*10\s+BETWEEN\s+1\s+AND\s+8")

    def test_technician_history_freezes_billing_mode(self):
        source = read("db/schema/10_tables/25_work_order_stage_assignments.sql").lower()
        for table in (
            "lab_work_order_assignment_cost_lines",
            "lab_work_order_assignment_adjustments",
        ):
            section = source[source.index(f"create table if not exists public.{table}"):]
            self.assertRegex(
                section,
                r"billing_mode\s+text\s+not null\s+default\s+'per_tooth'",
            )
            self.assertRegex(
                source,
                rf"alter table public\.{table}\s+add column if not exists\s+billing_mode\s+text\s+not null\s+default\s+'per_tooth'",
            )
            self.assertIn(f"{table}_billing_mode_check", source)
        for mode in ("per_tooth", "per_arch", "per_piece"):
            self.assertGreaterEqual(source.count("'" + mode + "'"), 2)
        self.assertNotIn("lab_work_types", source)
        self.assertNotIn("lab_technician_costs", source)

    def test_technician_costs_consume_canonical_billable_scope(self):
        resolver = read("db/schema/20_functions/resolve_work_order_technician_costs.sql")
        self.assertIn("public.work_order_billing_scope", resolver)
        self.assertIn("billing_mode", resolver)
        self.assertNotIn("FROM public.lab_work_order_items", resolver)
        self.assertRegex(resolver, r"round\(tc\.cost\s*\*\s*scope\.quantity,\s*2\)")

        sync = read("db/schema/20_functions/sync_work_order_stage_assignment.sql")
        self.assertRegex(
            sync,
            r"assignment_id,\s*work_type,\s*billing_mode,\s*quantity,\s*unit_cost,\s*amount,\s*cost_source",
        )
        self.assertIn("costs.billing_mode", sync)
        self.assertRegex(
            sync,
            r"SELECT sum\(quantity\) FROM public\.resolve_work_order_technician_costs",
        )

    def test_scope_adjustments_compare_normalized_type_and_frozen_mode(self):
        source = read("db/schema/20_functions/adjust_work_order_scope_costs.sql")
        self.assertIn("billing_mode", source)
        self.assertIn("work_type_key", source)
        self.assertRegex(source, r"FULL JOIN after_scope n\s+USING\(work_type_key,billing_mode\)")
        self.assertIn("l.billing_mode=d.billing_mode", source)
        self.assertNotRegex(source, r"(?i)update\s+public\.technician_payments")
        self.assertNotRegex(
            source,
            r"(?i)update\s+public\.lab_work_order_assignment_(?:cost_lines|adjustments)",
        )

        history = read("db/schema/20_functions/get_work_order_financial_history.sql")
        assignments = history[history.index("'Assignments'"):]
        self.assertIn("d.billing_mode", assignments)
        self.assertIn("l.billing_mode", assignments)

    def test_apply_includes_every_billing_mode_object(self):
        apply = read("db/schema/apply.sql")
        for path in (
            "10_tables/24a_work_order_price_lines.sql",
            "20_functions/derive_billing_units.sql",
            "20_functions/work_order_billing_scope.sql",
            "20_functions/get_work_order_price_lines.sql",
            "30_policies/24a_work_order_price_lines.sql",
        ):
            self.assertIn(path, apply)


if __name__ == "__main__":
    unittest.main()

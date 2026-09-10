from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class SchemaIdempotency(unittest.TestCase):
    def test_every_trigger_is_dropped_before_it_is_created(self):
        for path in sorted((ROOT / "db/schema").rglob("*.sql")):
            if path.name in {"apply.sql", "apply.supabase.sql"}:
                continue
            sql = path.read_text()
            for match in re.finditer(
                r"CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-zA-Z0-9_]+)",
                sql,
                re.IGNORECASE,
            ):
                trigger = match.group(1)
                preceding = sql[: match.start()]
                self.assertRegex(
                    preceding,
                    rf"DROP\s+TRIGGER\s+IF\s+EXISTS\s+{re.escape(trigger)}\b",
                    f"{path.relative_to(ROOT)} creates {trigger} without an idempotent drop",
                )


if __name__ == "__main__":
    unittest.main()

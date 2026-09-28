"""Schema v1 parser metadata: categorization, warnings, sprint, typed defects.

Covers the m5.1 parser pass: sprint marker parsed into records, defect fields
normalized to code lists, out-of-schema fields categorized (never rejected),
and the three warning classes. Additive-only: everything pre-existing is
untouched.
"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

PARSER_PATH = Path(os.environ.get(
    "ROADMAP_SYNC_PARSER", "~/.local/lib/roadmap-sync/roadmap_sync.py")).expanduser()

SPEC = importlib.util.spec_from_file_location("roadmap_sync", PARSER_PATH)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

BASE = """# Roadmap
{sprint}* [ ] **DEV-1 - Main task**
  * **Description**: Body text.
  * **Effort**: `[effort: 3/10]`
  * **Status**: Pending
  * **Tracked Defects**: [`BUG-01 - Crash`](file:///x/BUGS_ROADMAP.md), [`BUG-02`](file:///x/BUGS_ROADMAP.md)
  * **Resolved Defects**: [`BUG-03`](file:///x/BUGS_ROADMAP.md)
  * **Quirky Custom Field**: whatever
* [x] **DEV-2 - Done task**
  * **Description**: Did it.
  * **Effort**: `[effort: 1/10]`
  * **Status**: Completed
"""
SPRINT = "sprint: 2026-09-16 -> 2026-09-30\n"


class SchemaV1Tests(unittest.TestCase):
    def snap(self, text):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        root = Path(td.name)
        (root / "proj").mkdir()
        (root / "proj" / "X_ROADMAP.md").write_text(text)
        return mod.build_snapshot(root)

    def test_sprint_marker_reaches_source_and_tasks(self):
        s = self.snap(BASE.format(sprint=SPRINT))
        self.assertEqual(s["sources"][0]["sprint"], {"start": "2026-09-16", "end": "2026-09-30"})
        for t in s["tasks"]:
            self.assertEqual(t["sprint"], {"start": "2026-09-16", "end": "2026-09-30"})

    def test_no_marker_no_sprint_keys(self):
        s = self.snap(BASE.format(sprint=""))
        self.assertNotIn("sprint", s["sources"][0])
        self.assertNotIn("sprint", s["tasks"][0])

    def test_malformed_marker_warns_on_source_only(self):
        s = self.snap(BASE.format(sprint="sprint: next tuesday -> later\n"))
        self.assertEqual(s["sources"][0]["warnings"], ["sprint marker present but malformed"])
        self.assertNotIn("sprint", s["sources"][0])
        self.assertEqual(s["summary"]["error_count"], 0)

    def test_defect_fields_normalize_to_code_lists(self):
        s = self.snap(BASE.format(sprint=""))
        t = s["tasks"][0]
        self.assertEqual(t["tracked_defects"], ["BUG-01", "BUG-02"])
        self.assertEqual(t["resolved_defects"], ["BUG-03"])
        self.assertNotIn("tracked_defects", s["tasks"][1])

    def test_out_of_schema_categorized_not_rejected(self):
        s = self.snap(BASE.format(sprint=""))
        t = s["tasks"][0]
        self.assertEqual(t["schema_metadata"]["out_of_schema"], ["quirky_custom_field"])
        self.assertEqual(s["tasks"][1]["schema_metadata"]["out_of_schema"], [])
        self.assertEqual(s["summary"]["tasks_with_out_of_schema_fields"], 1)
        # the field itself is still parsed and stored
        self.assertEqual(t["fields"]["quirky_custom_field"], "whatever")

    def test_schema_valid_flags(self):
        s = self.snap(BASE.format(sprint=""))
        self.assertTrue(all(t["schema_metadata"]["schema_valid"] for t in s["tasks"]))
        bad = BASE.format(sprint="").replace("  * **Effort**: `[effort: 3/10]`\n", "")
        s2 = self.snap(bad)
        self.assertFalse(s2["tasks"][0]["schema_metadata"]["schema_valid"])

    def test_effort_type_mismatch_warns(self):
        bad = BASE.format(sprint="").replace("`[effort: 3/10]`", "big")
        s = self.snap(bad)
        self.assertIn("effort field present but not in x/10 form", s["tasks"][0]["warnings"])

    def test_conversation_chronology_rule(self):
        self.assertIsNone(mod.conversation_order_warning(["a-2026-09-20", "b-2026-09-22"]))
        self.assertIsNotNone(mod.conversation_order_warning(["b-2026-09-22", "a-2026-09-20"]))
        self.assertIsNone(mod.conversation_order_warning(["uuid-no-dates", "another"]))


class M52FieldTests(unittest.TestCase):
    """m5.2: summary, sprint membership order, and blocked_by parse into records."""

    TEXT = """# Roadmap
* [ ] **DEV-1 - Main task**
  * **Description**: Body text.
  * **Summary**: One short line.
  * **Sprint**: 2
  * **Blocked by**: DEV-9, DEV-8
  * **Effort**: `[effort: 3/10]`
  * **Status**: Pending
* [ ] **DEV-2 - Plain task**
  * **Description**: No extras.
  * **Effort**: `[effort: 1/10]`
  * **Status**: Pending
"""

    def snap(self, text):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        root = Path(td.name)
        (root / "proj").mkdir()
        (root / "proj" / "X_ROADMAP.md").write_text(text)
        return mod.build_snapshot(root)

    def test_summary_sprint_order_blocked_by_reach_record(self):
        s = self.snap(self.TEXT)
        t = s["tasks"][0]
        self.assertEqual(t["summary"], "One short line.")
        self.assertTrue(t["sprint_member"])
        self.assertEqual(t["sprint_order"], 2)
        self.assertEqual(t["blocked_by"], ["DEV-9", "DEV-8"])

    def test_new_keys_are_in_schema(self):
        s = self.snap(self.TEXT)
        self.assertEqual(s["tasks"][0]["schema_metadata"]["out_of_schema"], [])

    def test_non_numeric_sprint_field_is_not_membership(self):
        s = self.snap(self.TEXT.replace("* **Sprint**: 2", "* **Sprint**: 2026-09-23"))
        t = s["tasks"][0]
        self.assertNotIn("sprint_member", t)
        self.assertNotIn("sprint_order", t)

    def test_plain_task_has_none_of_the_new_keys(self):
        s = self.snap(self.TEXT)
        t = s["tasks"][1]
        for key in ("summary", "sprint_member", "sprint_order", "blocked_by"):
            self.assertNotIn(key, t)


if __name__ == "__main__":
    unittest.main()

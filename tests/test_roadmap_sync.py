import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("roadmap_sync", Path(__file__).parents[1] / "roadmap_sync.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

SAMPLE = """# Product Roadmap
## Current Sprint
* [ ] **DEV-M4 - Dual-Stack Automation**
  * **Description**: First line.
    - nested detail
    ```yaml
    token: $NOT_A_SECRET_VALUE
    ```
  * **Tracked Defects**: `BUG-10`, BUG-11
  * **Effort**: `[effort: 3/10]`
  * **Conversation**: [`[Conv: abc]`](conversation://abc-123)
  * **Status**: 🔄 In Progress
* [x] **BUG-01 - Fixed issue**
  * **Scope**: Fixed it.
  * **Effort**: `[effort: 2/10]`
  * **Status**: [Completed]
"""

class ParserTests(unittest.TestCase):
    def test_discovery_is_case_insensitive_and_normalizes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            p = root / "ProjectA" / "AcTiVe_RoAdMaP.MD"
            p.parent.mkdir()
            p.write_text(SAMPLE)
            (p.parent / "notes.md").write_text(SAMPLE)
            snap = mod.build_snapshot(root)
            self.assertEqual(snap["summary"]["source_count"], 1)
            self.assertEqual(snap["summary"]["task_count"], 2)
            first = snap["tasks"][0]
            self.assertEqual(first["code"], "DEV-M4")
            self.assertEqual(first["status"], "in_progress")
            self.assertEqual(first["effort"], {"value": 3.0, "scale": 10.0})
            self.assertEqual(first["defect_codes"], ["BUG-10", "BUG-11"])
            self.assertEqual(first["conversations"], ["abc-123"])
            self.assertIn("nested detail", first["description"])
            self.assertEqual(first["source"]["relative_path"], "ProjectA/AcTiVe_RoAdMaP.MD")
            self.assertTrue(first["source"]["file_sha256"])
            self.assertTrue(first["source"]["block_sha256"])
            self.assertEqual(snap["tasks"][1]["description"], "Fixed it.")

    def test_discovery_prunes_archived_ragenodes_trees(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = [
                root / "OLD-ARCHIVE-RAGENODES-REWRITE" / "archive_roadmap.md",
                root / "legacy" / "RaGeNoDeS.ArChIvE" / "nested_roadmap.md",
                root / "RageNodes" / "current_roadmap.md",
            ]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(SAMPLE)

            discovered = [p.relative_to(root).as_posix() for p in mod.discover(root)]
            self.assertEqual(discovered, ["RageNodes/current_roadmap.md"])

            snap = mod.build_snapshot(root)
            self.assertEqual(snap["summary"]["source_count"], 1)
            self.assertEqual(snap["summary"]["task_count"], 2)
            self.assertEqual(snap["sources"][0]["project"], "RageNodes")
            self.assertTrue(all("archive" not in source["relative_path"].casefold() for source in snap["sources"]))
            self.assertTrue(all("archive" not in task["source"]["relative_path"].casefold() for task in snap["tasks"]))

    def test_similarly_named_current_directory_is_not_excluded(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            p = root / "ragenodes.archive-notes" / "current_roadmap.md"
            p.parent.mkdir(parents=True)
            p.write_text(SAMPLE)
            snap = mod.build_snapshot(root)
            self.assertEqual(snap["summary"]["source_count"], 1)
            self.assertEqual(snap["summary"]["task_count"], 2)

    def test_identity_is_stable_when_content_changes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            p = root / "x_roadmap.md"
            p.write_text(SAMPLE)
            before = mod.build_snapshot(root)["tasks"][0]
            p.write_text(SAMPLE.replace("First line", "Changed line"))
            after = mod.build_snapshot(root)["tasks"][0]
            self.assertEqual(before["id"], after["id"])
            self.assertNotEqual(before["source"]["block_sha256"], after["source"]["block_sha256"])

if __name__ == "__main__":
    unittest.main()

"""Parser pruning regression: fixtures and write-inbox trees are not sources.

Regression: after M1/M2 landed, the live sync ingested
~/projects/InstinctConnector/fixtures (DEMO/ULT phantom tasks, 12 sources /
59 tasks instead of the clean 10/54). The parser now prunes fixture and
write-inbox directory names during discovery, exactly like archive pruning.

Run from the InstinctConnector root:
    python3 tests/test_roadmap_sync_pruning.py -v
"""
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

PARSER_PATH = Path(os.environ.get(
    "ROADMAP_SYNC_PARSER", "~/.local/lib/roadmap-sync/roadmap_sync.py")).expanduser()

SPEC = importlib.util.spec_from_file_location("roadmap_sync", PARSER_PATH)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

TASK = "* [ ] **{code} - {title}**\n  * **Status**: Pending\n"


class PruningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        real = self.root / "ragenodes.agentsdir" / "MAIN_ROADMAP.md"
        real.parent.mkdir(parents=True)
        real.write_text(TASK.format(code="REAL-1", title="A real task"))

    def tearDown(self):
        self.tmp.cleanup()

    def snapshot_codes(self):
        snap = mod.build_snapshot(self.root)
        return sorted(t["code"] for t in snap["tasks"]), snap

    def test_fixture_dirs_are_not_sources(self):
        for junk in ("fixtures", "test-fixtures", "test_fixtures",
                     "write-inbox/backups", "backups"):
            path = self.root / junk / "DEMO_ROADMAP.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(TASK.format(code="JUNK-1", title="phantom"))
        codes, snap = self.snapshot_codes()
        self.assertEqual(codes, ["REAL-1"])
        self.assertEqual(snap["summary"]["source_count"], 1)
        self.assertEqual(snap["summary"]["error_count"], 0)

    def test_archive_pruning_still_works(self):
        for junk in ("OLD-ARCHIVE-RAGENODES-REWRITE", "ragenodes.archive"):
            path = self.root / junk / "OLD_ROADMAP.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(TASK.format(code="OLD-1", title="archived"))
        codes, snap = self.snapshot_codes()
        self.assertEqual(codes, ["REAL-1"])
        self.assertEqual(snap["summary"]["source_count"], 1)

    def test_similar_names_still_count(self):
        # Only exact directory names are pruned; real projects near the
        # names must keep flowing.
        near = self.root / "fixtures-archive" / "NEAR_ROADMAP.md"
        near.parent.mkdir(parents=True)
        near.write_text(TASK.format(code="NEAR-1", title="not a fixture"))
        codes, snap = self.snapshot_codes()
        self.assertEqual(codes, ["NEAR-1", "REAL-1"])


if __name__ == "__main__":
    unittest.main()

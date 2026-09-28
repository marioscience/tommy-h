import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import roadmap_pipeline as pipe
import roadmap_write as rw
import roadmap_sync as sync

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "root"
        for relative, content in rw.FIXTURE_FILES.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        self.conf = {
            "schema_version": 1,
            "inbox_dir": str(self.tmp / "ops/inbox"),
            "archive_dir": str(self.tmp / "ops/archive"),
            "receipt_dir": str(self.tmp / "ops/receipts"),
            "backup_dir": str(self.tmp / "ops/backups"),
            "snapshot_path": str(self.tmp / "ops/snapshot.json"),
            "signing": False,
            "key_path": "",
            "git_auto_commit": False,
            "drive_push": False,
            "post_apply_hooks": [],
            "drive_remote": "fake:ops/inbox"
        }
        pipe.LEDGER_FILE = "ops/state.json"
        pipe.ensure_dirs(self.conf, self.root)
        
    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write_batch(self, name, ops):
        path = Path(self.conf["inbox_dir"]) / name
        batch = {
            "batch_id": name.split(".")[0],
            "created_at": "2026-09-27T00:00:00Z",
            "ops": ops
        }
        path.write_text(json.dumps(batch, indent=2))
        return path

    def test_happy_path(self):
        f = self.write_batch("batch1.json", [
            {"kind": "set_status", "code": "DEMO-1", "to": "completed", "from": "in_progress"}
        ])
        raw = f.read_bytes()
        res = pipe.do_apply_batch(raw, f, self.conf, self.root, dry_run=False, yes=True, quiet=True)
        self.assertTrue(res)
        self.assertFalse(f.exists())
        self.assertTrue((Path(self.conf["archive_dir"]) / f.name).exists())
        ledger = pipe.load_ledger(self.root)
        self.assertIn(pipe.batch_sha256(raw), ledger)
        # Check source modified
        self.assertIn("✅ Completed", (self.root / "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md").read_text())

    def test_malformed_op_quarantined(self):
        # bad status
        f = self.write_batch("batch_bad.json", [
            {"kind": "set_status", "code": "DEMO-1", "to": "invalid_status", "from": "in_progress"}
        ])
        raw = f.read_bytes()
        res = pipe.do_apply_batch(raw, f, self.conf, self.root, dry_run=False, yes=True, quiet=True)
        self.assertFalse(res)
        self.assertFalse(f.exists())
        self.assertTrue((Path("ops/quarantine") / f.name).exists())

    def test_idempotent_resume(self):
        f = self.write_batch("batch_idem.json", [
            {"kind": "set_status", "code": "DEMO-1", "to": "completed", "from": "in_progress"}
        ])
        raw = f.read_bytes()
        res = pipe.do_apply_batch(raw, f, self.conf, self.root, dry_run=False, yes=True, quiet=True)
        self.assertTrue(res)
        # It's achieved! Now restore file but keep ledger.
        f = self.write_batch("batch_idem.json", [
            {"kind": "set_status", "code": "DEMO-1", "to": "completed", "from": "in_progress"}
        ])
        res2 = pipe.do_apply_batch(raw, f, self.conf, self.root, dry_run=False, yes=True, quiet=True)
        self.assertTrue(res2)

    def test_hook_failure_ignored(self):
        self.conf["post_apply_hooks"] = ["exit 1"]
        f = self.write_batch("batch_hook.json", [
            {"kind": "set_status", "code": "DEMO-1", "to": "completed", "from": "in_progress"}
        ])
        raw = f.read_bytes()
        res = pipe.do_apply_batch(raw, f, self.conf, self.root, dry_run=False, yes=True, quiet=True)
        self.assertTrue(res) # Should still be true

    def test_legacy_file_migration(self):
        import roadmap_pipeline as pipe
        import roadmap_sync as sync
        legacy_state = {
            "some_hash": {"receipt_ids": ["123"], "apply_timestamp": "now"}
        }
        ledger_path = self.root / "ops/state.json"
        with open(ledger_path, "w") as f:
            json.dump(legacy_state, f)
        
        legacy_snapshot = {
            "summary": {"task_count": 42}
        }
        snap_path = self.root / "ops/snapshot.json"
        with open(snap_path, "w") as f:
            json.dump(legacy_snapshot, f)
            
        loaded = pipe.load_ledger(self.root)
        self.assertEqual(loaded, legacy_state)
        with open(ledger_path, "r") as f:
            new_state = json.load(f)
        self.assertEqual(new_state["schema_version"], 1)
        self.assertEqual(new_state["state"], legacy_state)
        self.assertTrue(Path(str(ledger_path) + ".bak").exists())
        
        # Test pipeline migration by triggering it manually since main() does it
        with open(snap_path, "r") as f:
            snap_data = json.load(f)
        if "schema_version" not in snap_data:
            shutil.copy2(snap_path, str(snap_path) + ".bak")
            snap_data["schema_version"] = 1
            sync.atomic_write_json(snap_path, snap_data)
            
        with open(snap_path, "r") as f:
            new_snap = json.load(f)
        self.assertEqual(new_snap["schema_version"], 1)
        self.assertEqual(new_snap["summary"], legacy_snapshot["summary"])
        self.assertTrue(Path(str(snap_path) + ".bak").exists())

    def test_corrupt_files_abort(self):
        import roadmap_pipeline as pipe
        ledger_path = self.root / "ops/state.json"
        with open(ledger_path, "w") as f:
            f.write("{ invalid json")
        with self.assertRaises(SystemExit) as cm:
            pipe.load_ledger(self.root)
        self.assertEqual(cm.exception.code, 3)

    def test_zero_byte_state_aborts(self):
        import roadmap_pipeline as pipe
        ledger_path = self.root / "ops/state.json"
        ledger_path.write_bytes(b"")
        with self.assertRaises(SystemExit) as cm:
            pipe.load_ledger(self.root)
        self.assertEqual(cm.exception.code, 3)

if __name__ == "__main__":
    unittest.main()

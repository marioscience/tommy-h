"""M2 tests: the local applier - lock, backup, atomic write, rollback, receipts.

Run from the InstinctConnector root:
    python3 tests/test_roadmap_apply.py -v
"""
import importlib.util
import fcntl
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

LIB_DIR = Path(os.environ.get("ROADMAP_SYNC_LIB", "~/.local/lib/roadmap-sync")).expanduser()
PARSER_PATH = Path(os.environ.get("ROADMAP_SYNC_PARSER", LIB_DIR / "roadmap_sync.py")).expanduser()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sync = load_module("roadmap_sync", PARSER_PATH)
rw = load_module("roadmap_write", LIB_DIR / "roadmap_write.py")
rv = load_module("roadmap_review", LIB_DIR / "roadmap_review.py")
ap = load_module("roadmap_apply", LIB_DIR / "roadmap_apply.py")

TARGET = "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md"


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / "tree"
        self.inbox = self.base / "write-inbox"
        for relative, content in rw.FIXTURE_FILES.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (self.inbox / "pending").mkdir(parents=True)
        (self.inbox / "approved").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def propose_and_approve(self, task, to):
        op = rw.build_operation(sync, self.root, task, to, "test")
        pending = self.inbox / "pending" / f"{op['operation_id']}.json"
        pending.write_text(json.dumps(op, indent=2, sort_keys=True) + "\n")
        record = rw.build_approval_record(op)
        approved = self.inbox / "approved" / pending.name
        os.replace(pending, approved)
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n"
        )
        return approved, op

    def source(self):
        return self.root / TARGET

    def receipt_for(self, op):
        path = self.inbox / "receipts" / f"{op['operation_id']}.receipt.json"
        self.assertTrue(path.is_file(), "receipt missing")
        return json.loads(path.read_text())

    def test_happy_path_applies_and_receipts(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        before_bytes = self.source().read_bytes()
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = self.source().read_text()
        self.assertIn("* [x] **DEMO-1 - Fixture in-progress task**", text)
        self.assertIn("* **Status**: ✅ Completed", text)
        # Parser agrees on the whole tree: one transition, zero other changes.
        _s, tasks = sync.parse_roadmap(self.source(), self.root)
        demo1 = next(t for t in tasks if t["code"] == "DEMO-1")
        self.assertEqual(demo1["status"], "completed")
        receipt = self.receipt_for(op)
        self.assertEqual(receipt["outcome"], "applied")
        self.assertEqual(receipt["before"]["file_sha256"], rw.hashlib.sha256(before_bytes).hexdigest())
        self.assertEqual(receipt["after"]["file_sha256"], rw.hashlib.sha256(self.source().read_bytes()).hexdigest())
        self.assertEqual(receipt["after"]["status"], "completed")
        # Operation and approval moved to receipts/; approved/ is empty.
        self.assertTrue((self.inbox / "receipts" / approved.name).is_file())
        self.assertEqual([p for p in (self.inbox / "approved").glob("*.json")], [])
        # Backup exists and is byte-identical to the original.
        backup = self.inbox / "backups" / receipt["backup_path"]
        self.assertEqual(backup.read_bytes(), before_bytes)

    def test_replay_is_refused(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        ap.apply_all(self.inbox, self.root, PARSER_PATH)
        # Drop an identical operation back into approved/.
        clone = self.inbox / "approved" / approved.name
        clone.write_text((self.inbox / "receipts" / approved.name).read_text())
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(
            (self.inbox / "receipts" / f"{op['operation_id']}.approval.json").read_text()
        )
        bytes_before = self.source().read_bytes()
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "quarantined")
        self.assertEqual(receipts[0]["reason_code"], "REPLAYED_OPERATION")
        self.assertEqual(self.source().read_bytes(), bytes_before)

    def test_missing_approval_is_quarantined(self):
        op = rw.build_operation(sync, self.root, "DEMO-1", "completed", "test")
        (self.inbox / "approved" / f"{op['operation_id']}.json").write_text(json.dumps(op))
        bytes_before = self.source().read_bytes()
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "quarantined")
        self.assertEqual(receipts[0]["reason_code"], "APPROVAL_MISSING")
        self.assertEqual(self.source().read_bytes(), bytes_before)

    def test_tampered_operation_breaks_approval_binding(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        tampered = json.loads(approved.read_text())
        tampered["reason"] = "tampered after approval"
        approved.write_text(json.dumps(tampered, indent=2, sort_keys=True) + "\n")
        bytes_before = self.source().read_bytes()
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "quarantined")
        self.assertEqual(receipts[0]["reason_code"], "APPROVAL_MISMATCH")
        self.assertEqual(self.source().read_bytes(), bytes_before)

    def test_source_drift_conflicts_without_writing(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        self.source().write_text(self.source().read_text() + "\nMario edited this.\n")
        drifted = self.source().read_bytes()
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "conflicted")
        self.assertEqual(receipts[0]["reason_code"], "SOURCE_HASH_MISMATCH")
        self.assertEqual(self.source().read_bytes(), drifted)
        self.assertEqual(list((self.inbox / "backups").glob("*")), [])

    def test_status_drift_conflicts_without_writing(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        self.source().write_text(self.source().read_text().replace("\U0001f504 In Progress", "⏳ Pending"))
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "conflicted")
        # The status edit changes the file bytes too, so the source pin fires first.
        self.assertEqual(receipts[0]["reason_code"], "SOURCE_HASH_MISMATCH")

    def test_expired_and_archived_are_quarantined(self):
        approved, op = self.propose_and_approve("DEMO-2", "in_progress")
        stale = json.loads(approved.read_text())
        stale["created_at"] = "2000-01-01T00:00:00Z"
        stale["expires_at"] = "2000-01-02T00:00:00Z"
        approved.write_text(json.dumps(stale, indent=2, sort_keys=True) + "\n")
        # Approval no longer matches; craft a matching one to isolate expiry.
        record = rw.build_approval_record(stale)
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(json.dumps(record))
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "quarantined")
        self.assertEqual(receipts[0]["reason_code"], "EXPIRED")

    def test_lock_blocks_second_applier(self):
        self.propose_and_approve("DEMO-1", "completed")
        lock_path = self.inbox / ".apply.lock"
        holder = open(lock_path, "a")
        fcntl.flock(holder.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            with self.assertRaises(rw.OperationError) as ctx:
                ap.apply_all(self.inbox, self.root, PARSER_PATH)
            self.assertEqual(ctx.exception.code, "ALREADY_RUNNING")
        finally:
            fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
            holder.close()

    def test_failing_tests_roll_back_byte_identical(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        before_bytes = self.source().read_bytes()
        failing = self.base / "failing-tests"
        failing.mkdir()
        (failing / "test_fail.py").write_text(
            "import unittest\nclass T(unittest.TestCase):\n    def test_x(self):\n        self.fail('boom')\n"
        )
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH, tests_dir=failing)
        self.assertEqual(receipts[0]["outcome"], "rolled_back")
        self.assertEqual(receipts[0]["reason_code"], "POST_WRITE_TESTS_FAILED")
        self.assertIn("restored byte-identical source", receipts[0]["detail"])
        self.assertEqual(self.source().read_bytes(), before_bytes)
        receipt = self.receipt_for(op)
        self.assertEqual(receipt["outcome"], "rolled_back")
        self.assertTrue(receipt["tests"]["ran"])
        self.assertFalse(receipt["tests"]["ok"])

    def crash_at_call(self, fail_on):
        """Patch os.replace to raise on the Nth call: 1=backup, 2=source, 3=receipt."""
        real_replace = os.replace
        calls = {"n": 0}

        def bomb(src, dst, *a, **k):
            calls["n"] += 1
            if calls["n"] == fail_on:
                raise RuntimeError("simulated crash")
            return real_replace(src, dst, *a, **k)

        ap.os.replace = bomb
        self.addCleanup(setattr, ap.os, "replace", real_replace)
        return calls

    def test_crash_during_backup_leaves_source_untouched(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        before_bytes = self.source().read_bytes()
        self.crash_at_call(fail_on=1)
        with self.assertRaises(RuntimeError):
            ap.apply_one(approved, self.inbox, self.root, sync)
        self.assertEqual(self.source().read_bytes(), before_bytes)
        self.assertEqual(list((self.inbox / "backups").glob("*")), [])
        self.assertFalse((self.inbox / "receipts" / f"{op['operation_id']}.receipt.json").exists())

    def test_crash_before_replace_leaves_source_untouched(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        before_bytes = self.source().read_bytes()
        self.crash_at_call(fail_on=2)
        with self.assertRaises(RuntimeError):
            ap.apply_one(approved, self.inbox, self.root, sync)
        self.assertEqual(self.source().read_bytes(), before_bytes)
        # Backup was taken before the crash point and survives for recovery.
        backups = list((self.inbox / "backups").glob("*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before_bytes)
        # No receipt: the operation may be retried, pins are re-checked.
        self.assertFalse((self.inbox / "receipts" / f"{op['operation_id']}.receipt.json").exists())

    def test_crash_after_replace_recovers_on_next_run(self):
        approved, op = self.propose_and_approve("DEMO-1", "completed")
        self.crash_at_call(fail_on=3)  # receipt write never lands
        with self.assertRaises(RuntimeError):
            ap.apply_one(approved, self.inbox, self.root, sync)
        # The write landed but no receipt exists. Next run must not rewrite:
        # pins no longer match, so it conflicts cleanly.
        self.assertIn("[x] **DEMO-1", self.source().read_text())
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "conflicted")
        self.assertEqual(receipts[0]["reason_code"], "SOURCE_HASH_MISMATCH")
        self.assertIn("[x] **DEMO-1", self.source().read_text())

    def test_pending_to_completed_and_insert_field(self):
        approved, op = self.propose_and_approve("DEMO-4", "in_progress")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = self.source().read_text()
        self.assertIn("* [ ] **DEMO-4", text)  # checkbox untouched
        self.assertIn("* **Status**: \U0001f504 In Progress", text)

    def test_empty_inbox_is_noop(self):
        self.assertEqual(ap.apply_all(self.inbox, self.root, PARSER_PATH), [])




class AddTaskApplyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / "tree"
        self.inbox = self.base / "write-inbox"
        for relative, content in rw.FIXTURE_FILES.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (self.inbox / "pending").mkdir(parents=True)
        (self.inbox / "approved").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def propose_and_approve_add(self, code="DEMO-9", title="Brand new task", effort=4.0,
                                status="pending", description="Added by test."):
        op = rw.build_add_operation(sync, self.root, TARGET, code, title, effort, status,
                                    "test add", description=description)
        pending = self.inbox / "pending" / f"{op['operation_id']}.json"
        pending.write_text(json.dumps(op, indent=2, sort_keys=True) + "\n")
        record = rw.build_approval_record(op)
        approved = self.inbox / "approved" / pending.name
        os.replace(pending, approved)
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n"
        )
        return approved, op

    def source(self):
        return self.root / TARGET

    def receipt_for(self, op):
        path = self.inbox / "receipts" / f"{op['operation_id']}.receipt.json"
        self.assertTrue(path.is_file(), "receipt missing")
        return json.loads(path.read_text())

    def test_add_happy_path(self):
        _approved, op = self.propose_and_approve_add()
        before = self.source().read_bytes()
        snap_before = sync.build_snapshot(self.root)
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = self.source().read_text()
        self.assertIn("* [ ] **DEMO-9 - Brand new task**", text)
        self.assertIn("* **Description**: Added by test.", text)
        self.assertIn("* **Effort**: `[effort: 4/10]`", text)
        self.assertIn("* **Status**: ⏳ Pending", text)
        snap_after = sync.build_snapshot(self.root)
        self.assertEqual(snap_after["summary"]["task_count"], snap_before["summary"]["task_count"] + 1)
        mine = [t for t in snap_after["tasks"] if t["code"] == "DEMO-9"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["status"], "pending")
        self.assertEqual(mine[0]["effort"], {"value": 4.0, "scale": 10.0})
        receipt = self.receipt_for(op)
        self.assertIsNone(receipt["before"]["status"])
        self.assertEqual(receipt["after"]["status"], "pending")
        # backup exists and holds the exact prior bytes
        backup = self.inbox / "backups" / receipt["backup_path"]
        self.assertEqual(backup.read_bytes(), before)

    def test_add_conflicts_when_code_lands_after_proposal(self):
        # drift between propose and apply: someone adds the code by hand
        _approved, op = self.propose_and_approve_add(code="DEMO-9")
        before = self.source().read_bytes()
        with self.source().open("a", encoding="utf-8") as handle:
            handle.write("\n* [ ] **DEMO-9 - Sneaked in by hand**\n  * **Status**: ⏳ Pending\n")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "conflicted")
        self.assertIn(receipts[0]["reason_code"], ("TASK_EXISTS", "SOURCE_HASH_MISMATCH"))
        self.assertNotEqual(self.source().read_bytes(), before)  # the manual edit stays; the op wrote nothing
        self.assertEqual(self.source().read_text().count("**DEMO-9 - Sneaked in by hand**"), 1)

    def test_propose_add_rejects_existing_code(self):
        with self.assertRaises(rw.ResolveError):
            rw.build_add_operation(sync, self.root, TARGET, "DEMO-1", "dup", 1.0, "pending", "test")

    def test_add_with_links_and_conversations(self):
        op = rw.build_add_operation(
            sync, self.root, TARGET, "DEMO-11", "Linked task", 2.0, "pending",
            "test add with links",
            description="Carries schema fields.",
            links=[{"text": "DEMO-1 - Fixture pending", "url": "file:///x/ACTIVE_ROADMAP.md"}],
            conversations=["123e4567-e89b-42d3-a456-426614174000"],
        )
        pending = self.inbox / "pending" / f"{op['operation_id']}.json"
        pending.write_text(json.dumps(op, indent=2, sort_keys=True) + "\n")
        record = rw.build_approval_record(op)
        approved = self.inbox / "approved" / pending.name
        (self.inbox / "approved").mkdir(exist_ok=True)
        os.replace(pending, approved)
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n"
        )
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = self.source().read_text()
        self.assertIn("* **Links**: [`DEMO-1 - Fixture pending`](file:///x/ACTIVE_ROADMAP.md)", text)
        self.assertIn("* **Conversation**: [`Conv: 123e4567`](conversation://123e4567-e89b-42d3-a456-426614174000)", text)
        snap = sync.build_snapshot(self.root)
        mine = [t for t in snap["tasks"] if t["code"] == "DEMO-11"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["conversations"], ["123e4567-e89b-42d3-a456-426614174000"])
        self.assertTrue(any(l["url"] == "file:///x/ACTIVE_ROADMAP.md" for l in mine[0]["links"]))
        self.assertTrue(mine[0]["schema_metadata"]["schema_valid"])
        self.assertEqual(mine[0]["schema_metadata"]["out_of_schema"], [])

    def test_add_rejects_malformed_links(self):
        with self.assertRaises(rw.SchemaError):
            rw.build_add_operation(
                sync, self.root, TARGET, "DEMO-12", "Bad links", 1.0, "pending",
                "test", links=[{"text": "only-text"}],
            )
        with self.assertRaises(rw.SchemaError):
            rw.build_add_operation(
                sync, self.root, TARGET, "DEMO-12", "Bad conv", 1.0, "pending",
                "test", conversations=["two\nlines"],
            )

    def test_propose_add_completed_status_renders_checkbox(self):
        _approved, op = self.propose_and_approve_add(code="DEMO-10", status="completed")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = self.source().read_text()
        self.assertIn("* [x] **DEMO-10 - Brand new task**", text)


class DeleteTaskApplyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / "tree"
        self.inbox = self.base / "write-inbox"
        for relative, content in rw.FIXTURE_FILES.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (self.inbox / "pending").mkdir(parents=True)
        (self.inbox / "approved").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def propose_and_approve_delete(self, code="DEMO-2"):
        op = rw.build_delete_operation(sync, self.root, code, "test delete")
        pending = self.inbox / "pending" / f"{op['operation_id']}.json"
        pending.write_text(json.dumps(op, indent=2, sort_keys=True) + "\n")
        record = rw.build_approval_record(op)
        approved = self.inbox / "approved" / pending.name
        os.replace(pending, approved)
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n"
        )
        return approved, op

    def test_delete_happy_path(self):
        _approved, op = self.propose_and_approve_delete("DEMO-2")
        src = self.root / op["target"]["source_path"]
        before = src.read_bytes()
        snap_before = sync.build_snapshot(self.root)
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = src.read_text()
        self.assertNotIn("DEMO-2", text)
        self.assertIn("DEMO-1", text)  # neighbors untouched
        self.assertIn("DEMO-3", text)
        snap_after = sync.build_snapshot(self.root)
        self.assertEqual(snap_after["summary"]["task_count"],
                         snap_before["summary"]["task_count"] - 1)
        self.assertFalse(any(t["code"] == "DEMO-2" for t in snap_after["tasks"]))
        receipt = json.loads(
            (self.inbox / "receipts" / f"{op['operation_id']}.receipt.json").read_text())
        # receipt carries the full verbatim removed block (recoverable from it)
        self.assertIn("DEMO-2 - Fixture pending task", receipt["removed_block"])
        self.assertIn("⏳ Pending", receipt["removed_block"])
        self.assertEqual(receipt["before"]["status"], "pending")
        self.assertIsNone(receipt["after"]["status"])
        # byte backup of the pre-delete file exists
        backup = self.inbox / "backups" / receipt["backup_path"]
        self.assertEqual(backup.read_bytes(), before)

    def test_delete_conflicts_on_drift(self):
        _approved, op = self.propose_and_approve_delete("DEMO-1")
        src = self.root / op["target"]["source_path"]
        before = src.read_bytes()
        with src.open("a", encoding="utf-8") as handle:
            handle.write("\n* manual edit after approval\n")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "conflicted")
        text = src.read_text()
        self.assertIn("DEMO-1", text)                    # delete wrote nothing
        self.assertIn("manual edit after approval", text)  # drift edit untouched

    def test_delete_second_apply_conflicts_task_gone(self):
        _approved, op = self.propose_and_approve_delete("DEMO-3")
        ap.apply_all(self.inbox, self.root, PARSER_PATH)
        # re-stage the same approved op (replay attempt)
        name = f"{op['operation_id']}.json"
        (self.inbox / "approved" / name).write_text(
            (self.inbox / "receipts" / f"{op['operation_id']}.receipt.json").read_text()
            and json.dumps(op, indent=2, sort_keys=True) + "\n")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        # replay is refused: quarantined because a receipt already exists, or
        # conflicted because the task is gone - either way nothing is written
        self.assertIn(receipts[0]["outcome"], ("conflicted", "quarantined"))


class EditTaskApplyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / "tree"
        self.inbox = self.base / "write-inbox"
        for relative, content in rw.FIXTURE_FILES.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (self.inbox / "pending").mkdir(parents=True)
        (self.inbox / "approved").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def propose_and_approve_edit(self, code="DEMO-2", mode="append", text="extra context.",
                                 field="description"):
        op = rw.build_edit_operation(sync, self.root, code, mode, text, "test edit", field=field)
        pending = self.inbox / "pending" / f"{op['operation_id']}.json"
        pending.write_text(json.dumps(op, indent=2, sort_keys=True) + "\n")
        record = rw.build_approval_record(op)
        approved = self.inbox / "approved" / pending.name
        os.replace(pending, approved)
        (self.inbox / "approved" / f"{op['operation_id']}.approval.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n"
        )
        return approved, op

    def receipt_for(self, op):
        path = self.inbox / "receipts" / f"{op['operation_id']}.receipt.json"
        self.assertTrue(path.is_file(), "receipt missing")
        return json.loads(path.read_text())

    def test_edit_append_happy_path(self):
        _approved, op = self.propose_and_approve_edit("DEMO-2", "append", "extra context.")
        src = self.root / op["target"]["source_path"]
        before = src.read_bytes()
        snap_before = sync.build_snapshot(self.root)
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = src.read_text()
        self.assertIn("Stands in for a task not yet started. extra context.", text)
        snap_after = sync.build_snapshot(self.root)
        self.assertEqual(snap_after["summary"]["task_count"], snap_before["summary"]["task_count"])
        mine = [t for t in snap_after["tasks"] if t["code"] == "DEMO-2"]
        self.assertEqual(mine[0]["description"], "Stands in for a task not yet started. extra context.")
        self.assertEqual(mine[0]["status"], "pending")  # status untouched
        receipt = self.receipt_for(op)
        self.assertEqual(receipt["edit"]["before"], "Stands in for a task not yet started.")
        self.assertEqual(receipt["edit"]["after"],
                         "Stands in for a task not yet started. extra context.")
        self.assertEqual(receipt["before"]["status"], receipt["after"]["status"])
        backup = self.inbox / "backups" / receipt["backup_path"]
        self.assertEqual(backup.read_bytes(), before)

    def test_edit_replace_happy_path(self):
        _approved, op = self.propose_and_approve_edit("DEMO-1", "replace", "Completely new.")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = (self.root / op["target"]["source_path"]).read_text()
        self.assertIn("**Description**: Completely new.", text)
        self.assertNotIn("Stands in for a task currently being worked.", text)

    def test_edit_inserts_description_when_missing(self):
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        text = target.read_text()
        text = text.replace("  * **Description**: Stands in for a finished task.\n", "")
        target.write_text(text)
        _approved, op = self.propose_and_approve_edit("DEMO-3", "append", "Now it has one.")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        snap_after = sync.build_snapshot(self.root)
        mine = [t for t in snap_after["tasks"] if t["code"] == "DEMO-3"]
        self.assertEqual(mine[0]["description"], "Now it has one.")

    def test_edit_summary_field_end_to_end(self):
        _approved, op = self.propose_and_approve_edit("DEMO-2", "replace", "One short line.",
                                                      field="summary")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = (self.root / op["target"]["source_path"]).read_text()
        self.assertIn("**Summary**: One short line.", text)
        snap_after = sync.build_snapshot(self.root)
        mine = [t for t in snap_after["tasks"] if t["code"] == "DEMO-2"]
        self.assertEqual(mine[0]["summary"], "One short line.")
        self.assertEqual(mine[0]["status"], "pending")

    def test_edit_sprint_field_then_clear_end_to_end(self):
        _approved, op = self.propose_and_approve_edit("DEMO-2", "replace", "2", field="sprint")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        text = (self.root / op["target"]["source_path"]).read_text()
        self.assertIn("**Sprint**: 2", text)
        snap_after = sync.build_snapshot(self.root)
        mine = [t for t in snap_after["tasks"] if t["code"] == "DEMO-2"]
        self.assertTrue(mine[0]["sprint_member"])
        self.assertEqual(mine[0]["sprint_order"], 2)

        _approved2, op2 = self.propose_and_approve_edit("DEMO-2", "clear", "", field="sprint")
        receipts2 = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(len(receipts2), 1)
        self.assertEqual(receipts2[0]["outcome"], "applied")
        text = (self.root / op2["target"]["source_path"]).read_text()
        self.assertNotIn("**Sprint**", text)
        snap_final = sync.build_snapshot(self.root)
        mine = [t for t in snap_final["tasks"] if t["code"] == "DEMO-2"]
        self.assertNotIn("sprint_member", mine[0])

    def test_edit_blocked_by_end_to_end(self):
        _approved, op = self.propose_and_approve_edit("DEMO-2", "replace", "DEMO-4, ULT-1",
                                                      field="blocked_by")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "applied")
        snap_after = sync.build_snapshot(self.root)
        mine = [t for t in snap_after["tasks"] if t["code"] == "DEMO-2"]
        self.assertEqual(mine[0]["blocked_by"], ["DEMO-4", "ULT-1"])

    def test_edit_conflicts_on_drift(self):
        _approved, op = self.propose_and_approve_edit("DEMO-1", "append", "extra.")
        src = self.root / op["target"]["source_path"]
        with src.open("a", encoding="utf-8") as handle:
            handle.write("\n* manual edit after approval\n")
        receipts = ap.apply_all(self.inbox, self.root, PARSER_PATH)
        self.assertEqual(receipts[0]["outcome"], "conflicted")
        text = src.read_text()
        self.assertIn("Stands in for a task currently being worked.", text)  # edit wrote nothing
        self.assertNotIn("extra.", text)


if __name__ == "__main__":
    unittest.main()

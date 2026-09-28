"""M1 tests: operation schema, policy, proposals and the review command.

Run from the InstinctConnector root:
    python3 tests/test_roadmap_write.py -v

The modules under test load from ~/.local/lib/roadmap-sync by default;
override with ROADMAP_SYNC_LIB and ROADMAP_SYNC_PARSER for a sandbox.
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

LIB_DIR = Path(os.environ.get("ROADMAP_SYNC_LIB", "~/.local/lib/roadmap-sync")).expanduser()
PARSER_PATH = Path(os.environ.get("ROADMAP_SYNC_PARSER", LIB_DIR / "roadmap_sync.py")).expanduser()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # lets roadmap_review import roadmap_write anywhere
    spec.loader.exec_module(module)
    return module


sync = load_module("roadmap_sync", PARSER_PATH)
rw = load_module("roadmap_write", LIB_DIR / "roadmap_write.py")
rv = load_module("roadmap_review", LIB_DIR / "roadmap_review.py")


def make_fixture_tree(root: Path) -> None:
    for relative, content in rw.FIXTURE_FILES.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def run_review(op_path: Path, root: Path) -> tuple[int, str]:
    out = StringIO()
    with redirect_stdout(out):
        code = rv.review(op_path, root, PARSER_PATH)
    return code, out.getvalue()


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_fixture_tree(self.root)
        self.op = rw.build_operation(sync, self.root, "DEMO-2", "in_progress", "test reason")

    def tearDown(self):
        self.tmp.cleanup()

    def test_propose_builds_pinned_operation(self):
        op = self.op
        self.assertEqual(op["schema_version"], 1)
        self.assertEqual(op["actor"], "instinct")
        self.assertEqual(op["action"], "set_status")
        self.assertEqual(op["change"], {"from": "pending", "to": "in_progress"})
        self.assertIsNone(op["approval"])
        self.assertEqual(op["target"]["source_path"], "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md")
        path = self.root / op["target"]["source_path"]
        _source, tasks = sync.parse_roadmap(path, self.root)
        task = next(t for t in tasks if t["code"] == "DEMO-2")
        self.assertEqual(op["target"]["expected_source_sha256"], task["source"]["file_sha256"])
        self.assertEqual(op["target"]["expected_task_fingerprint"], task["source"]["block_sha256"])
        self.assertEqual(op["target"]["stable_id"], task["id"])
        rw.validate_operation(op)  # does not raise

    def test_propose_rejects_disallowed_transitions(self):
        # v3: every real status flip is allowed, in both directions.
        for code, to in (("DEMO-3", "pending"), ("DEMO-3", "in_progress"),
                         ("DEMO-2", "completed"), ("DEMO-1", "pending")):
            rw.build_operation(sync, self.root, code, to, "any direction is fine")
        # no-ops are the only rejected transition
        with self.assertRaises(rw.TransitionError):
            rw.build_operation(sync, self.root, "DEMO-2", "pending", "no-op")

    def test_propose_missing_and_duplicate_tasks(self):
        with self.assertRaises(rw.ResolveError) as ctx:
            rw.build_operation(sync, self.root, "NOPE-9", "in_progress", "missing")
        self.assertEqual(ctx.exception.code, "TASK_NOT_FOUND")
        dupe = self.root / "ragenodesultimate" / "COPY_ROADMAP.md"
        dupe.write_text("* [ ] **DEMO-2 - Second task with the same code**\n  * **Status**: Pending\n")
        with self.assertRaises(rw.ResolveError) as ctx:
            rw.build_operation(sync, self.root, "DEMO-2", "in_progress", "dupe")
        self.assertEqual(ctx.exception.code, "DUPLICATE_TASK")

    def test_canonical_hash_is_order_independent_and_approval_blind(self):
        payload = json.dumps(self.op, sort_keys=True)
        shuffled = json.loads(payload)
        shuffled["target"] = dict(reversed(list(shuffled["target"].items())))
        self.assertEqual(rw.operation_hash(self.op), rw.operation_hash(shuffled))
        with_approval = dict(self.op, approval={"reviewer": "mario-local"})
        self.assertEqual(rw.operation_hash(self.op), rw.operation_hash(with_approval))
        changed = dict(self.op, reason="different reason")
        self.assertNotEqual(rw.operation_hash(self.op), rw.operation_hash(changed))

    def test_validate_rejects_bad_envelopes(self):
        for mutate, marker in [
            (lambda o: o.update(schema_version=2), "schema"),
            (lambda o: o.update(actor="someone-else"), "actor"),
            (lambda o: o.update(action="delete_task"), "action"),
            (lambda o: o.update(reason=""), "reason"),
            (lambda o: o.update(approval={"reviewer": "mario-local"}), "approval"),
            (lambda o: o["target"].update(expected_source_sha256="zz"), "sha256"),
            (lambda o: o.update(operation_id="whatever"), "operation_id"),
        ]:
            broken = json.loads(json.dumps(self.op))
            mutate(broken)
            with self.assertRaises(rw.OperationError, msg=marker):
                rw.validate_operation(broken)

    def test_expiry(self):
        expired = json.loads(json.dumps(self.op))
        expired["created_at"] = "2000-01-01T00:00:00Z"
        expired["expires_at"] = "2000-01-02T00:00:00Z"
        rw.validate_operation(expired)  # schema fine
        with self.assertRaises(rw.ExpiredError):
            rw.check_expiry(expired)


class PolicyTests(unittest.TestCase):
    def test_source_path_policy(self):
        allowed = [
            "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md",
            "ragenodesultimate/FEATURES_ROADMAP.md",
            "ragenodes.agentsdir/archive-notes/DEEP_ROADMAP.md",  # similar name, not archived
        ]
        denied = [
            "../ragenodes.agentsdir/X_ROADMAP.md",
            "/home/mario/projects/ragenodes.agentsdir/X_ROADMAP.md",
            "OLD-ARCHIVE-RAGENODES-REWRITE/OLD_ROADMAP.md",
            "old-archive-ragenodes-rewrite/old_ROADMAP.md",
            "Ragenodes.Archive/x_ROADMAP.md",
            "ragenodes.agentsdir/nested/ragenodes.archive/X_ROADMAP.md",
            "otherproject/X_ROADMAP.md",
            "ragenodes.agentsdir/notes.md",
            "ragenodes.agentsdir/ROADMAP.txt",
        ]
        for path in allowed:
            rw.check_source_path(path)
        for path in denied:
            with self.assertRaises(rw.PolicyError, msg=path):
                rw.check_source_path(path)


class DiscoveryTests(unittest.TestCase):
    def test_iter_roadmap_files_prunes_nonsource_dirs(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            keep = root / "ragenodes.agentsdir" / "X_ROADMAP.md"
            keep.parent.mkdir(parents=True)
            keep.write_text("* [ ] **X-1 - real task**\n")
            for junk in ("fixtures/F_ROADMAP.md", "test-fixtures/T_ROADMAP.md",
                         "write-inbox/backups/20260101T000000Z_deadbeef_X_ROADMAP.md",
                         "backups/OLD_ROADMAP.md"):
                path = root / junk
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("* [ ] **JUNK-1 - phantom**\n")
            found = [p.as_posix() for p in rw.iter_roadmap_files(root)]
            self.assertEqual(found, [keep.as_posix()])


    def test_init_fixtures_refuses_projects_tree(self):
        with tempfile.TemporaryDirectory() as td:
            fake_projects = Path(td) / "projects"
            fake_projects.mkdir()
            with self.assertRaises(rw.OperationError) as ctx:
                rw.init_fixtures(fake_projects / "roadmap-sync-fixtures", sync, projects_root=fake_projects)
            self.assertEqual(ctx.exception.code, "FIXTURE_INSIDE_PROJECTS")
            self.assertFalse((fake_projects / "roadmap-sync-fixtures").exists())
            # Outside ~/projects is fine.
            ok_dir = Path(td) / "roadmap-sync-fixtures"
            rw.init_fixtures(ok_dir, sync, projects_root=fake_projects)
            self.assertTrue((ok_dir / "ragenodes.agentsdir").is_dir())

    def test_init_fixtures_expands_tilde_default(self):
        with tempfile.TemporaryDirectory() as td:
            import unittest.mock as mock
            with mock.patch.dict(os.environ, {"HOME": td}):
                rw.init_fixtures(Path("~/roadmap-sync-fixtures"), sync)
            self.assertTrue((Path(td) / "roadmap-sync-fixtures" / "ragenodes.agentsdir").is_dir())
            self.assertFalse((Path(td) / "~").exists())  # never a literal tilde dir


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_fixture_tree(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def propose_file(self, task, to, name="op.json"):
        op = rw.build_operation(sync, self.root, task, to, "test proposal")
        path = self.root / name
        path.write_text(json.dumps(op, indent=2, sort_keys=True) + "\n")
        return path, op

    def test_review_complete_happy_path(self):
        op_path, _op = self.propose_file("DEMO-1", "completed")
        code, out = run_review(op_path, self.root)
        self.assertEqual(code, 0, out)
        self.assertIn("VERDICT: APPLICABLE", out)
        self.assertIn("-* [ ] **DEMO-1 - Fixture in-progress task**", out)
        self.assertIn("+* [x] **DEMO-1 - Fixture in-progress task**", out)
        self.assertIn("-  * **Status**: \U0001f504 In Progress", out)
        self.assertIn("+  * **Status**: ✅ Completed", out)
        # Deterministic: the same review prints the same diff twice.
        _code2, out2 = run_review(op_path, self.root)
        self.assertEqual(out, out2)

    def test_review_pending_to_in_progress_keeps_checkbox(self):
        op_path, _op = self.propose_file("DEMO-2", "in_progress")
        code, out = run_review(op_path, self.root)
        self.assertEqual(code, 0, out)
        self.assertNotIn("[x] **DEMO-2", out)
        self.assertIn("+  * **Status**: \U0001f504 In Progress", out)

    def test_review_inserts_missing_status_field(self):
        op_path, _op = self.propose_file("DEMO-4", "in_progress")
        code, out = run_review(op_path, self.root)
        self.assertEqual(code, 0, out)
        self.assertIn("+  * **Status**: \U0001f504 In Progress", out)

    def test_review_conflict_when_source_changes(self):
        op_path, _op = self.propose_file("DEMO-1", "completed")
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        target.write_text(target.read_text() + "\nMario typed a new line here.\n")
        code, out = run_review(op_path, self.root)
        self.assertEqual(code, 2, out)
        self.assertIn("[FAIL] source sha256", out)
        self.assertIn("VERDICT: CONFLICT", out)

    def test_review_conflict_when_status_drifts(self):
        op_path, _op = self.propose_file("DEMO-1", "completed")
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        target.write_text(target.read_text().replace("\U0001f504 In Progress", "⏳ Pending"))
        code, out = run_review(op_path, self.root)
        self.assertEqual(code, 2, out)
        self.assertIn("[FAIL] task fingerprint", out)
        self.assertIn("[FAIL] from-status", out)

    def test_review_invalid_operations_exit_3(self):
        op_path, op = self.propose_file("DEMO-2", "in_progress")
        for mutate in (
            lambda o: o.update(created_at="2000-01-01T00:00:00Z", expires_at="2000-01-02T00:00:00Z"),
            lambda o: o["target"].update(source_path="OLD-ARCHIVE-RAGENODES-REWRITE/OLD_ROADMAP.md"),
            lambda o: o.update(change={"from": "pending", "to": "pending"}),
        ):
            broken = json.loads(json.dumps(op))
            mutate(broken)
            op_path.write_text(json.dumps(broken, indent=2, sort_keys=True) + "\n")
            code, out = run_review(op_path, self.root)
            self.assertEqual(code, 3, out)

    def test_review_writes_nothing(self):
        op_path, _op = self.propose_file("DEMO-1", "completed")
        before = {p.as_posix(): p.stat().st_mtime_ns for p in self.root.rglob("*") if p.is_file()}
        run_review(op_path, self.root)
        after = {p.as_posix(): p.stat().st_mtime_ns for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_render_preserves_all_other_lines(self):
        path = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        text = path.read_text()
        _source, tasks = sync.parse_roadmap(path, self.root)
        for task in tasks:
            for _from, to in sorted(rw.ALLOWED_TRANSITIONS):
                if task["status"] != _from:
                    continue
                rendered = rv.render_status_edit(text, task, sync, to)
                old_lines, new_lines = text.split("\n"), rendered.split("\n")
                changed = [i for i in range(max(len(old_lines), len(new_lines)))
                           if (old_lines[i] if i < len(old_lines) else None)
                           != (new_lines[i] if i < len(new_lines) else None)]
                # At most: checkbox char on the task line + one status line,
                # or one inserted status line (shifts the rest by one).
                if len(new_lines) == len(old_lines):
                    self.assertLessEqual(len(changed), 2)
                    for i in changed:
                        if i == task["source"]["line_start"] - 1:
                            if "[ ]" in old_lines[i]:
                                self.assertEqual(old_lines[i].replace("[ ]", "[x]"), new_lines[i])
                            else:
                                self.assertEqual(old_lines[i].replace("[x]", "[ ]"), new_lines[i])
                        else:
                            self.assertIn("**Status**", old_lines[i])
                            self.assertIn("**Status**", new_lines[i])
                else:
                    self.assertEqual(len(new_lines), len(old_lines) + 1)




class ReopenTransitionTests(unittest.TestCase):
    """v2 boomerang: completed -> in_progress is the one reverse transition."""

    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = Path(self.td.name) / "fixtures"
        rw.init_fixtures(self.root, sync, projects_root=Path("/nonexistent-no-guard"))

    def tearDown(self):
        self.td.cleanup()

    def test_reopen_propose_and_render(self):
        op_path, op = self.propose("DEMO-3", "in_progress")
        self.assertEqual(op["change"], {"from": "completed", "to": "in_progress"})
        code, out = run_review(op_path, self.root)
        self.assertEqual(code, 0, out)
        self.assertIn("APPLICABLE", out)
        self.assertIn("-* [x] **DEMO-3", out)
        self.assertIn("+* [ ] **DEMO-3", out)

    def test_noop_transitions_still_rejected(self):
        for status in ("pending", "in_progress", "completed"):
            with self.assertRaises(rw.TransitionError):
                rw.check_transition(status, status)

    def propose(self, code, to):
        ops = rw.build_operation(sync, self.root, code, to, "reopen test", 24)
        pending = self.root / "write-inbox" / "pending"
        path = rw.write_operation(ops, pending)
        return path, ops

class FixtureGeneratorTests(unittest.TestCase):
    def test_init_fixtures_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "fixtures"
            written = rw.init_fixtures(root, sync)
            by_name = {p.name: p for p in written}
            self.assertEqual(run_review(by_name["valid-start-demo2.json"], root)[0], 0)
            self.assertEqual(run_review(by_name["valid-complete-demo1.json"], root)[0], 0)
            self.assertEqual(run_review(by_name["valid-start-demo4-nofield.json"], root)[0], 0)
            self.assertEqual(run_review(by_name["conflict-bad-source-hash.json"], root)[0], 2)
            self.assertEqual(run_review(by_name["invalid-expired.json"], root)[0], 3)
            self.assertEqual(run_review(by_name["invalid-archive-path.json"], root)[0], 3)
            self.assertEqual(run_review(by_name["invalid-transition.json"], root)[0], 3)


class DeleteProposalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "tree"
        make_fixture_tree(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_build_delete_pins_and_block(self):
        op = rw.build_delete_operation(sync, self.root, "DEMO-2", "test")
        self.assertEqual(op["action"], "delete_task")
        self.assertEqual(op["target"]["task_id"], "DEMO-2")
        self.assertEqual(op["change"]["from"], "pending")
        self.assertIsNone(op["change"]["to"])
        self.assertIn("DEMO-2 - Fixture pending task", op["delete"]["removed_block"])
        self.assertIn("⏳ Pending", op["delete"]["removed_block"])
        self.assertTrue(op["target"]["expected_task_fingerprint"])
        self.assertTrue(op["target"]["expected_source_sha256"])
        rw.validate_operation(op)  # schema-clean

    def test_build_delete_unknown_code(self):
        with self.assertRaises(rw.ResolveError) as ctx:
            rw.build_delete_operation(sync, self.root, "NOPE-99", "test")
        self.assertEqual(ctx.exception.code, "TASK_NOT_FOUND")

    def test_review_delete_applicable(self):
        op = rw.build_delete_operation(sync, self.root, "DEMO-3", "test")
        path = Path(self.tmp.name) / "op.json"
        path.write_text(json.dumps(op, indent=2) + "\n")
        code, out = run_review(path, self.root)
        self.assertEqual(code, 0, out)
        self.assertIn("DELETE", out)
        self.assertIn("DEMO-3 - Fixture completed task", out)

    def test_review_delete_conflicts_on_drift(self):
        op = rw.build_delete_operation(sync, self.root, "DEMO-1", "test")
        path = Path(self.tmp.name) / "op.json"
        path.write_text(json.dumps(op, indent=2) + "\n")
        target = self.root / op["target"]["source_path"]
        target.write_text(target.read_text() + "\n* unrelated edit\n")
        code, out = run_review(path, self.root)
        self.assertEqual(code, 2, out)

    def test_delete_never_touches_pruned_dirs(self):
        with self.assertRaises(rw.ResolveError):
            rw.build_delete_operation(sync, self.root, "OLD-1", "test")


class EditProposalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "tree"
        make_fixture_tree(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_build_edit_append(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "append", "also covers X.", "test")
        self.assertEqual(op["action"], "edit_task")
        self.assertEqual(op["change"]["from"], op["change"]["to"])
        self.assertEqual(op["edit"]["mode"], "append")
        self.assertEqual(op["edit"]["before"], "Stands in for a task not yet started.")
        self.assertTrue(op["edit"]["after"].endswith("also covers X."))
        self.assertIn("Stands in for a task not yet started.", op["edit"]["after"])
        rw.validate_operation(op)

    def test_build_edit_replace(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-1", "replace", "Brand new text.", "test")
        self.assertEqual(op["edit"]["before"], "Stands in for a task currently being worked.")
        self.assertEqual(op["edit"]["after"], "Brand new text.")
        rw.validate_operation(op)

    def test_build_edit_insert_when_no_description(self):
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        text = target.read_text()
        text = text.replace("  * **Description**: Stands in for a task not yet started.\n", "")
        target.write_text(text)
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "append", "First description.", "test")
        self.assertIsNone(op["edit"]["before"])
        self.assertEqual(op["edit"]["after"], "First description.")

    def test_build_edit_unknown_code(self):
        with self.assertRaises(rw.ResolveError) as ctx:
            rw.build_edit_operation(sync, self.root, "NOPE-9", "append", "x", "test")
        self.assertEqual(ctx.exception.code, "TASK_NOT_FOUND")

    def test_build_edit_noop_refused(self):
        with self.assertRaises(rw.ResolveError) as ctx:
            rw.build_edit_operation(sync, self.root, "DEMO-2", "replace",
                                    "Stands in for a task not yet started.", "test")
        self.assertEqual(ctx.exception.code, "NO_OP")

    def test_build_edit_rejects_multiline_text(self):
        with self.assertRaises(rw.PolicyError):
            rw.build_edit_operation(sync, self.root, "DEMO-2", "append", "one\ntwo", "test")

    def test_schema_rejects_tampered_after(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "append", "extra.", "test")
        op["edit"]["after"] = "something else entirely"
        with self.assertRaises(rw.SchemaError):
            rw.validate_operation(op)

    def test_build_edit_summary_replace(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "One short line.",
                                     "test", field="summary")
        self.assertEqual(op["edit"]["field"], "summary")
        self.assertIsNone(op["edit"]["before"])
        self.assertEqual(op["edit"]["after"], "One short line.")
        rw.validate_operation(op)

    def test_build_edit_sprint_order(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "3",
                                     "test", field="sprint")
        self.assertEqual(op["edit"]["after"], "3")
        rw.validate_operation(op)

    def test_build_edit_sprint_rejects_non_numeric(self):
        with self.assertRaises(rw.PolicyError):
            rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "abc",
                                    "test", field="sprint")

    def test_build_edit_blocked_by_normalizes(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "DEMO-4  DEMO-1, DEMO-4",
                                     "test", field="blocked_by")
        self.assertEqual(op["edit"]["after"], "DEMO-4, DEMO-1")
        rw.validate_operation(op)

    def test_build_edit_blocked_by_rejects_garbage(self):
        with self.assertRaises(rw.PolicyError):
            rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "not-a-code",
                                    "test", field="blocked_by")

    def test_build_edit_append_refused_for_non_description(self):
        with self.assertRaises(rw.PolicyError):
            rw.build_edit_operation(sync, self.root, "DEMO-2", "append", "x",
                                    "test", field="summary")

    def test_build_edit_clear_refused_for_description(self):
        with self.assertRaises(rw.PolicyError):
            rw.build_edit_operation(sync, self.root, "DEMO-2", "clear", "",
                                    "test", field="description")

    def test_build_edit_clear_absent_field_is_noop(self):
        with self.assertRaises(rw.ResolveError) as ctx:
            rw.build_edit_operation(sync, self.root, "DEMO-2", "clear", "",
                                    "test", field="summary")
        self.assertEqual(ctx.exception.code, "NO_OP")

    def test_build_edit_clear_present_field(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "1",
                                     "test", field="sprint")
        rw.validate_operation(op)
        # simulate the field having landed, then a clear against it
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        text = target.read_text()
        text = text.replace("  * **Effort**: `[effort: 2/10]`",
                            "  * **Sprint**: 1\n  * **Effort**: `[effort: 2/10]`", 1)
        target.write_text(text)
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "clear", "",
                                     "test", field="sprint")
        self.assertEqual(op["edit"]["before"], "1")
        self.assertIsNone(op["edit"]["after"])
        rw.validate_operation(op)

    def test_schema_rejects_clear_with_after(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-2", "replace", "1",
                                     "test", field="sprint")
        op["edit"]["mode"] = "clear"
        op["edit"]["text"] = ""
        with self.assertRaises(rw.SchemaError):
            rw.validate_operation(op)

    def test_review_edit_applicable(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-3", "append", "postscript.", "test")
        path = Path(self.tmp.name) / "op.json"
        path.write_text(json.dumps(op, indent=2) + "\n")
        code, out = run_review(path, self.root)
        self.assertEqual(code, 0, out)
        self.assertIn("description before:", out)
        self.assertIn("description after:", out)

    def test_review_edit_conflicts_on_drift(self):
        op = rw.build_edit_operation(sync, self.root, "DEMO-1", "replace", "new.", "test")
        path = Path(self.tmp.name) / "op.json"
        path.write_text(json.dumps(op, indent=2) + "\n")
        target = self.root / op["target"]["source_path"]
        target.write_text(target.read_text() + "\n* unrelated edit\n")
        code, out = run_review(path, self.root)
        self.assertEqual(code, 2, out)


if __name__ == "__main__":
    unittest.main()

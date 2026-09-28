"""Tests for roadmap_cli.py - the roadmap command line.

The write subcommands are exercised end to end on a fixture tree through the
real installed pipeline (propose -> review -> approve -> apply), exactly as a
terminal run would, with stdin carrying the y/N answers.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LIB_DIR = Path(os.environ.get("ROADMAP_SYNC_LIB", "~/.local/lib/roadmap-sync")).expanduser()
PARSER_PATH = Path(os.environ.get("ROADMAP_SYNC_PARSER", LIB_DIR / "roadmap_sync.py")).expanduser()
CLI = LIB_DIR / "roadmap_cli.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


rw = load_module("roadmap_write", LIB_DIR / "roadmap_write.py")


def make_fixture_tree(root: Path) -> None:
    for relative, content in rw.FIXTURE_FILES.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


FAKE_SYSTEMCTL = '#!/usr/bin/env python3\n"""Fake systemctl for CLI tests: logs argv, never touches real systemd."""\nimport os, sys\n\nwith open(os.environ["FAKE_SYSTEMCTL_LOG"], "a") as fh:\n    fh.write(" ".join(sys.argv[1:]) + "\\n")\nargs = sys.argv[1:]\nif "cat" in args or "start" in args:\n    sys.exit(0)\nif "is-active" in args:\n    print("inactive")\n    sys.exit(3)\nsys.exit(0)\n'


class CliCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "root"
        self.inbox = self.tmp / "inbox"
        # a throwaway HOME keeps the suite hermetic: the CLI's state (chat-ops
        # log, snapshot file) lives under ~/.local/share/roadmap-sync, and a
        # real log on the machine must never leak into a test run
        self.home = self.tmp / "home"
        self.home.mkdir()
        make_fixture_tree(self.root)
        self.env = dict(os.environ)
        self.env.update({
            "HOME": str(self.home),
            "M4_LIB": str(LIB_DIR),
            "M4_ROOT": str(self.root),
            "M4_INBOX": str(self.inbox),
            "M4_PARSER": str(PARSER_PATH),
        })
        # progress-bar toggles are per-test inputs; never inherit them from the
        # caller's environment (a forced install run would leak into the CLI)
        self.env.pop("ROADMAP_PROGRESS_FORCE", None)
        self.env.pop("ROADMAP_NO_PROGRESS", None)
        # a fake systemctl first on PATH: the post-write sync kick must never
        # reach the developer's real user systemd (it blocked on a real sync)
        self.sysbin = self.tmp / "sysbin"
        self.sysbin.mkdir()
        fake = self.sysbin / "systemctl"
        fake.write_text(FAKE_SYSTEMCTL)
        fake.chmod(0o755)
        self.systemctl_log = self.tmp / "systemctl.log"
        self.env["FAKE_SYSTEMCTL_LOG"] = str(self.systemctl_log)
        self.env["PATH"] = f"{self.sysbin}:{self.env.get('PATH', '')}"

    def systemctl_calls(self):
        if not self.systemctl_log.is_file():
            return []
        return self.systemctl_log.read_text().splitlines()

    def cli(self, *argv, stdin: str = "") -> subprocess.CompletedProcess:
        return subprocess.run(["python3", str(CLI), *argv], input=stdin,
                              capture_output=True, text=True, env=self.env)

    def tasks(self):
        out = self.tmp / "snap.json"
        subprocess.run(["python3", str(PARSER_PATH), "--root", str(self.root),
                        "--output", str(out)], check=True, capture_output=True)
        return {t["code"]: t for t in json.loads(out.read_text())["tasks"]}


class BasicsTests(CliCase):
    def test_version(self):
        proc = self.cli("--version")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("roadmap 1.7.0", proc.stdout)

    def test_bare_and_help(self):
        for argv in ([], ["--help"], ["set", "--help"]):
            proc = self.cli(*argv)
            self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("update", self.cli("--help").stdout)
        self.assertIn("receipts", self.cli("--help").stdout)

    def test_status_aliases(self):
        for code, alias, want in [("DEMO-1", "done", "completed"), ("DEMO-2", "wip", "in_progress"), ("DEMO-1", "todo", "pending")]:
            proc = self.cli("set", code, alias, stdin="n\n")
            self.assertIn(f"{code} -> {want}", proc.stdout + proc.stderr, alias)

    def test_unknown_status_rejected(self):
        proc = self.cli("set", "DEMO-2", "banana")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("unknown status", proc.stderr)

    def test_unknown_task_rejected(self):
        proc = self.cli("set", "NOPE-99", "done")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("no task", proc.stderr)

    def test_noop_rejected(self):
        proc = self.cli("set", "DEMO-1", "in_progress")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("already in_progress", proc.stderr)

    def test_inbox_inside_root_refused(self):
        self.env["M4_INBOX"] = str(self.root / "inbox")
        proc = self.cli("set", "DEMO-2", "done")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("REFUSE", proc.stderr)


class WriteFlowTests(CliCase):
    def test_set_end_to_end(self):
        proc = self.cli("set", "DEMO-1", "completed", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("exactly one change: DEMO-1 in_progress -> completed", proc.stdout)
        self.assertIn("PASS", proc.stdout)
        self.assertEqual(self.tasks()["DEMO-1"]["status"], "completed")
        receipts = list((self.inbox / "receipts").glob("*.receipt.json"))
        self.assertEqual(len(receipts), 1)

    def test_set_declined_writes_nothing(self):
        proc = self.cli("set", "DEMO-1", "completed", stdin="n\n")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("aborted", proc.stdout)
        self.assertEqual(self.tasks()["DEMO-1"]["status"], "in_progress")

    def test_add_end_to_end(self):
        proc = self.cli("add", "DEMO-9", "--file", "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md",
                        "--title", "CLI added task", "--effort", "3",
                        "--desc", "added by the CLI test", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("exactly one change: DEMO-9 added as pending", proc.stdout)
        tasks = self.tasks()
        self.assertEqual(tasks["DEMO-9"]["status"], "pending")
        self.assertIn("added by the CLI test", tasks["DEMO-9"]["description"])

    def test_add_existing_code_rejected(self):
        proc = self.cli("add", "DEMO-1", "--file", "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md",
                        "--title", "dupe", "--effort", "1")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("already exists", proc.stderr)

    def test_edit_append_and_replace(self):
        proc = self.cli("edit", "DEMO-1", "append", "extra context", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("description edited", proc.stdout)
        desc = self.tasks()["DEMO-1"]["description"]
        self.assertIn("extra context", desc)
        self.assertIn("Stands in for a task currently being worked", desc)
        proc = self.cli("edit", "DEMO-1", "replace", "brand new text", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.tasks()["DEMO-1"]["description"], "brand new text")

    def test_delete_end_to_end_with_warning(self):
        proc = self.cli("delete", "DEMO-2", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DELETE WARNING", proc.stdout)
        self.assertIn("exactly one change: DEMO-2 removed", proc.stdout)
        self.assertNotIn("DEMO-2", self.tasks())


class ViewTests(CliCase):
    def test_receipts_after_writes(self):
        self.cli("set", "DEMO-1", "completed", stdin="y\n")
        proc = self.cli("receipts")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("applied", proc.stdout)
        self.assertIn("ANTIGRAVITY_CLI_ROADMAP.md", proc.stdout)

    def test_receipts_empty(self):
        proc = self.cli("receipts")
        self.assertEqual(proc.returncode, 0)
        self.assertIn("no receipts yet", proc.stdout)

    def test_log_missing_is_graceful(self):
        proc = self.cli("log")
        self.assertEqual(proc.returncode, 0)
        self.assertIn("no chat-ops log yet", proc.stdout)

    def test_status_prints_summary(self):
        proc = self.cli("status")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("tasks across", proc.stdout)
        self.assertIn("sync timer:", proc.stdout)


class ListTests(CliCase):
    def test_list_all(self):
        proc = self.cli("list")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("All tasks: 5 (1 done, 1 in progress, 3 pending)", proc.stdout)
        for code in ("DEMO-1", "DEMO-2", "DEMO-3", "DEMO-4", "ULT-1"):
            self.assertIn(code, proc.stdout)
        self.assertIn("== ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md ==", proc.stdout)
        self.assertIn("== ragenodesultimate/FEATURES_ROADMAP.md ==", proc.stdout)
        # short descriptions are the line bodies
        self.assertIn("DEMO-1 - Stands in for a task currently being worked. (8/10) [in progress]",
                      proc.stdout)
        self.assertIn("DEMO-3 - Stands in for a finished task. (1/10) [done]", proc.stdout)

    def test_list_status_flags(self):
        proc = self.cli("list", "--completed")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-3", proc.stdout)
        self.assertNotIn("DEMO-1", proc.stdout)
        self.assertNotIn("ULT-1", proc.stdout)
        proc = self.cli("list", "--pending", "--in-progress")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-1", proc.stdout)
        self.assertIn("DEMO-2", proc.stdout)
        self.assertIn("ULT-1", proc.stdout)
        self.assertNotIn("DEMO-3", proc.stdout)

    def test_list_file_filter(self):
        proc = self.cli("list", "--file", "features")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("ULT-1", proc.stdout)
        self.assertNotIn("DEMO-1", proc.stdout)
        self.assertNotIn("ANTIGRAVITY_CLI_ROADMAP.md ==", proc.stdout)

    def test_list_no_match(self):
        proc = self.cli("list", "--file", "nope")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("no tasks match", proc.stdout)

    def test_list_desc(self):
        proc = self.cli("list", "--desc", "--completed")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-3", proc.stdout)
        self.assertIn("Stands in for a finished task.", proc.stdout)

    def test_list_sprint_area_is_distinct(self):
        proc = self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.cli("list")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("== CURRENT SPRINT ==", proc.stdout)
        sprint_area = proc.stdout.split("== CURRENT SPRINT ==")[1].split("\n== ")[0]
        self.assertIn("DEMO-2", sprint_area)
        self.assertIn("DEMO-4", sprint_area)
        # members appear once: in the sprint area, not again under their file
        self.assertEqual(proc.stdout.count("DEMO-2 -"), 1)
        self.assertEqual(proc.stdout.count("DEMO-4 -"), 1)

    def test_list_uses_summary_when_present(self):
        proc = self.cli("edit", "DEMO-2", "replace", "The short version.",
                        "--field", "summary", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.cli("list")
        self.assertIn("DEMO-2 - The short version. (2/10)", proc.stdout)
        self.assertNotIn("DEMO-2 - Stands in for a task not yet started.", proc.stdout)


class NextTests(CliCase):
    def test_next_fallback_board_order(self):
        proc = self.cli("next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-2 - Fixture pending task (2/10)", proc.stdout)
        self.assertIn("no active sprint - top pending in board order", proc.stdout)
        self.assertIn("run: roadmap set DEMO-2 in_progress", proc.stdout)

    def test_next_nothing_pending(self):
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        text = target.read_text(encoding="utf-8")
        text = (text.replace("* [ ]", "* [x]")
                    .replace("\U0001f504 In Progress", "\u2705 Completed")
                    .replace("\u23f3 Pending", "\u2705 Completed"))
        target.write_text(text, encoding="utf-8")
        target2 = self.root / "ragenodesultimate" / "FEATURES_ROADMAP.md"
        text2 = target2.read_text(encoding="utf-8").replace("* [ ]", "* [x]").replace("\u23f3 Pending", "\u2705 Completed")
        target2.write_text(text2, encoding="utf-8")
        proc = self.cli("next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("nothing pending", proc.stdout)

    def test_next_serves_sprint_in_his_order(self):
        proc = self.cli("sprint", "set", "DEMO-4", "DEMO-2", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.cli("next")
        self.assertIn("DEMO-4 - Fixture task without a status field (3/10)", proc.stdout)
        self.assertIn("sprint task 1 of 2, your order", proc.stdout)

    def test_next_auto_bump_off_sprint(self):
        proc = self.cli("edit", "DEMO-2", "replace", "DEMO-4", "--field", "blocked_by", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.cli("next")
        self.assertIn("DEMO-4 - Fixture task without a status field (3/10)", proc.stdout)
        self.assertIn("jumped in from off-sprint: blocks DEMO-2 (sprint 1 of 1)", proc.stdout)
        self.assertIn("add it to the sprint: roadmap sprint set --add DEMO-4", proc.stdout)

    def test_next_auto_bump_on_sprint(self):
        self.cli("edit", "DEMO-2", "replace", "DEMO-4", "--field", "blocked_by", stdin="y\n")
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("next")
        self.assertIn("DEMO-4 - Fixture task without a status field (3/10)", proc.stdout)
        self.assertIn("jumped ahead: blocks DEMO-2 (sprint 1 of 2)", proc.stdout)
        self.assertNotIn("add it to the sprint", proc.stdout)

    def test_next_all_annotations(self):
        self.cli("edit", "DEMO-2", "replace", "DEMO-4", "--field", "blocked_by", stdin="y\n")
        self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        proc = self.cli("next", "--all")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn(" 1. DEMO-4 (3/10) [bumped, off-sprint, blocks DEMO-2]", proc.stdout)
        self.assertIn(" 2. DEMO-2 (2/10) [blocked by DEMO-4]", proc.stdout)


class SprintCommandTests(CliCase):
    def test_sprint_no_marker_no_set(self):
        proc = self.cli("sprint")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Sprint window not set", proc.stdout)
        self.assertIn("sprint: YYYY-MM-DD -> YYYY-MM-DD", proc.stdout)
        self.assertIn("No active sprint - set one with: roadmap sprint set CODE [CODE...]", proc.stdout)

    def _write_sprint_marker(self, start_offset_days: int, end_offset_days: int):
        from datetime import date, timedelta
        today = date.today()
        start = today + timedelta(days=start_offset_days)
        end = today + timedelta(days=end_offset_days)
        target = self.root / "ragenodes.agentsdir" / "ANTIGRAVITY_CLI_ROADMAP.md"
        text = target.read_text(encoding="utf-8")
        marker = f"sprint: {start.isoformat()} -> {end.isoformat()}\n"
        target.write_text(text.replace("# Antigravity CLI Roadmap\n", "# Antigravity CLI Roadmap\n" + marker, 1),
                          encoding="utf-8")
        return start, end

    def test_sprint_view_with_window_and_set(self):
        start, end = self._write_sprint_marker(-3, 4)
        proc = self.cli("sprint", "set", "DEMO-2", "DEMO-1", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Sprint set: 2 tasks, in your listed order", proc.stdout)
        self.assertIn("PASS", proc.stdout)
        proc = self.cli("sprint")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn(f"Sprint {start.isoformat()} -> {end.isoformat()} (4 days left)", proc.stdout)
        self.assertIn("Set (2 tasks, 10 effort):", proc.stdout)
        self.assertIn(" 1. DEMO-2 (2/10)", proc.stdout)
        self.assertIn(" 2. DEMO-1 (8/10) [in progress]", proc.stdout)
        self.assertIn("Next up: DEMO-2", proc.stdout)
        tasks = self.tasks()
        self.assertEqual(tasks["DEMO-2"]["sprint_order"], 1)
        self.assertEqual(tasks["DEMO-1"]["sprint_order"], 2)
        self.assertTrue(tasks["DEMO-1"]["sprint_member"])

    def test_sprint_ended_window(self):
        self._write_sprint_marker(-10, -2)
        proc = self.cli("sprint")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("ended 2 days ago", proc.stdout)

    def test_sprint_future_window(self):
        self._write_sprint_marker(3, 10)
        proc = self.cli("sprint")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("starts in 3 days", proc.stdout)

    def test_sprint_set_replaces_and_clears(self):
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "set", "DEMO-4", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Sprint set: 1 tasks, in your listed order (1 cleared)", proc.stdout)
        tasks = self.tasks()
        self.assertNotIn("sprint_member", tasks["DEMO-2"])
        self.assertEqual(tasks["DEMO-4"]["sprint_order"], 1)

    def test_sprint_set_add_appends(self):
        self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        proc = self.cli("sprint", "set", "DEMO-4", "--add", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        tasks = self.tasks()
        self.assertEqual(tasks["DEMO-2"]["sprint_order"], 1)
        self.assertEqual(tasks["DEMO-4"]["sprint_order"], 2)

    def test_sprint_set_add_dupe_rejected(self):
        self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        proc = self.cli("sprint", "set", "DEMO-2", "--add", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("already on the sprint", proc.stderr)

    def test_sprint_set_noop(self):
        self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        proc = self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("nothing to do", proc.stdout)

    def test_sprint_set_declined_writes_nothing(self):
        proc = self.cli("sprint", "set", "DEMO-2", stdin="n\n")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("aborted", proc.stdout)
        self.assertNotIn("sprint_member", self.tasks()["DEMO-2"])

    def test_sprint_set_unknown_task_rejected(self):
        proc = self.cli("sprint", "set", "NOPE-99", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("no task", proc.stderr)

    def test_sprint_move(self):
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", "ULT-1", stdin="y\n")
        proc = self.cli("sprint", "move", "ULT-1", "--to", "1", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Sprint order: ULT-1, DEMO-2, DEMO-4", proc.stdout)
        tasks = self.tasks()
        self.assertEqual(tasks["ULT-1"]["sprint_order"], 1)
        self.assertEqual(tasks["DEMO-2"]["sprint_order"], 2)
        self.assertEqual(tasks["DEMO-4"]["sprint_order"], 3)

    def test_sprint_move_not_member_rejected(self):
        self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        proc = self.cli("sprint", "move", "DEMO-4", "--to", "1", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("not on the sprint", proc.stderr)

    def test_sprint_clear(self):
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "clear", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Sprint cleared", proc.stdout)
        tasks = self.tasks()
        self.assertNotIn("sprint_member", tasks["DEMO-2"])
        self.assertNotIn("sprint_member", tasks["DEMO-4"])

    def test_sprint_clear_when_empty(self):
        proc = self.cli("sprint", "clear")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("nothing to clear", proc.stdout)

    def test_sprint_list(self):
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "list")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("== CURRENT SPRINT ==", proc.stdout)
        self.assertIn("DEMO-2 - Stands in for a task not yet started. (2/10)", proc.stdout)
        self.assertNotIn("ULT-1", proc.stdout)

    def test_sprint_list_when_empty(self):
        proc = self.cli("sprint", "list")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("no sprint set", proc.stdout)


class EditFieldTests(CliCase):
    def test_edit_summary_and_clear(self):
        proc = self.cli("edit", "DEMO-1", "replace", "Short version.", "--field", "summary", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("PASS", proc.stdout)
        self.assertEqual(self.tasks()["DEMO-1"]["summary"], "Short version.")
        proc = self.cli("edit", "DEMO-1", "clear", "--field", "summary", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("summary", self.tasks()["DEMO-1"])

    def test_edit_clear_description_rejected(self):
        proc = self.cli("edit", "DEMO-1", "clear", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("cannot be cleared", proc.stderr)

    def test_edit_sprint_rejects_bad_text(self):
        proc = self.cli("edit", "DEMO-1", "replace", "abc", "--field", "sprint", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("positive integer", proc.stdout + proc.stderr)

    def test_edit_append_refused_for_summary(self):
        proc = self.cli("edit", "DEMO-1", "append", "x", "--field", "summary", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("description only", proc.stdout + proc.stderr)




FAKE_RCLONE = '#!/usr/bin/env python3\n"""Fake rclone for update tests: serves a local directory as the remote."""\nimport json, os, shutil, sys\n\nroot = os.environ["FAKE_RCLONE_ROOT"]\n\ndef resolve(spec):\n    return os.path.join(root, spec.split(":", 1)[1].lstrip("/"))\n\nargs = sys.argv[1:]\ncmd = args[0]\nif cmd == "cat":\n    sys.stdout.write(open(resolve(args[1])).read())\nelif cmd == "size":\n    target = resolve(args[-1])\n    total = count = 0\n    for dp, _, fns in os.walk(target):\n        for fn in fns:\n            count += 1\n            total += os.path.getsize(os.path.join(dp, fn))\n    print(json.dumps({"count": count, "bytes": total}))\nelif cmd == "copy":\n    src, dst = resolve(args[1]), args[2]\n    os.makedirs(dst, exist_ok=True)\n    for fn in os.listdir(src):\n        s = os.path.join(src, fn)\n        if os.path.isfile(s):\n            shutil.copy2(s, os.path.join(dst, fn))\nelif cmd == "lsd":\n    for name in sorted(os.listdir(resolve(args[1]))):\n        if os.path.isdir(os.path.join(resolve(args[1]), name)):\n            print("          -1 2026-09-23 17:00:00        -1 " + name)\nelse:\n    sys.exit(2)\n'


class UpdateTests(CliCase):
    """`roadmap update` end to end against a fake release channel: LATEST
    pointer, determinate byte progress bar, and the installer handoff."""

    def setUp(self):
        super().setUp()
        self.remote = self.tmp / "remote"
        self.release = self.remote / "releases" / "m9.9-test"
        self.release.mkdir(parents=True)
        (self.release / "payload-a.txt").write_text("a" * 100)
        (self.release / "payload-b.txt").write_text("b" * 200)
        (self.release / "install.sh").write_text("#!/usr/bin/env bash\necho INSTALL RAN\n")
        (self.remote / "releases" / "LATEST").write_text("m9.9-test\n")
        self.bindir = self.tmp / "bin"
        self.bindir.mkdir()
        fake = self.bindir / "rclone"
        fake.write_text(FAKE_RCLONE)
        fake.chmod(0o755)
        self.env["PATH"] = f"{self.bindir}:{self.env['PATH']}"
        self.env["FAKE_RCLONE_ROOT"] = str(self.remote)
        self.env["M4_RELEASES_REMOTE"] = "fake:releases"
        self.env["M4_RELEASES_LOCAL"] = str(self.tmp / "pulled")

    def run_update(self, env):
        return subprocess.run(["python3", str(CLI), "update"],
                              capture_output=True, text=True, env=env)

    def test_update_pulls_with_progress_bar_and_installs(self):
        env = dict(self.env, ROADMAP_PROGRESS_FORCE="1")
        proc = self.run_update(env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("checking the release channel", proc.stdout)
        self.assertIn("pulling release m9.9-test (3 files, 337 B)", proc.stdout)
        # pipes translate \r -> \n, so assert on the redrawn frames themselves
        self.assertGreaterEqual(proc.stdout.count("files   "), 2)  # bar drew, then redrew
        self.assertIn("[############################] 100%", proc.stdout)
        self.assertIn("3/3 files", proc.stdout)
        self.assertIn("download complete (3 files)", proc.stdout)
        self.assertIn("INSTALL RAN", proc.stdout)       # installer handoff ran
        pulled = self.tmp / "pulled" / "m9.9-test"
        self.assertEqual((pulled / "payload-a.txt").read_text(), "a" * 100)
        self.assertEqual((pulled / "payload-b.txt").read_text(), "b" * 200)

    def test_update_without_tty_gets_plain_lines_not_bar(self):
        proc = self.run_update(self.env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("[#", proc.stdout)            # no bar frames at all
        self.assertIn("download complete (3 files)", proc.stdout)

    def test_update_falls_back_to_newest_folder_without_latest(self):
        (self.remote / "releases" / "LATEST").unlink()
        (self.remote / "releases" / "m9.8-older").mkdir()
        proc = self.run_update(self.env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("no LATEST pointer", proc.stdout)
        self.assertIn("pulling release m9.9-test", proc.stdout)

    def test_no_progress_env_disables_bar(self):
        env = dict(self.env, ROADMAP_NO_PROGRESS="1", ROADMAP_PROGRESS_FORCE="1")
        proc = self.run_update(env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("[#", proc.stdout)




    def test_sprint_current_shows_in_progress_detail(self):
        self.cli("sprint", "set", "DEMO-1", "DEMO-2", stdin="y\n")
        proc = self.cli("sprint", "current")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-1 - ", proc.stdout)
        self.assertIn("status: in_progress", proc.stdout)
        self.assertIn("sprint: 1 of 2, your order", proc.stdout)
        self.assertIn("description:", proc.stdout)

    def test_sprint_current_none_in_progress_points_to_next(self):
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "current")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("no sprint task in progress", proc.stdout)
        self.assertIn("next up: DEMO-2", proc.stdout)

    def test_sprint_current_no_sprint(self):
        proc = self.cli("sprint", "current")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("no sprint set", proc.stdout)



    def test_sprint_next_scoped_to_roster(self):
        self.cli("sprint", "set", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-4 - Fixture task without a status field (3/10)", proc.stdout)
        self.assertIn("sprint task 1 of 1, your order", proc.stdout)
        self.assertNotIn("DEMO-2", proc.stdout)

    def test_sprint_next_ignores_off_sprint_blocker_but_notes_it(self):
        self.cli("edit", "DEMO-2", "replace", "DEMO-4", "--field", "blocked_by", stdin="y\n")
        self.cli("sprint", "set", "DEMO-2", stdin="y\n")
        proc = self.cli("sprint", "next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-2 - ", proc.stdout)
        self.assertIn("heads up: also blocked by off-sprint DEMO-4", proc.stdout)
        # the global next still sees the off-sprint dep and bumps it
        proc = self.cli("next")
        self.assertIn("DEMO-4 - Fixture task without a status field (3/10)", proc.stdout)

    def test_sprint_next_bump_on_sprint(self):
        self.cli("edit", "DEMO-2", "replace", "DEMO-4", "--field", "blocked_by", stdin="y\n")
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-4 - Fixture task without a status field (3/10)", proc.stdout)
        self.assertIn("jumped ahead: blocks DEMO-2 (sprint 1 of 2)", proc.stdout)
        self.assertNotIn("off-sprint", proc.stdout)

    def test_sprint_next_celebration_when_all_done(self):
        self.cli("sprint", "set", "DEMO-3", stdin="y\n")
        proc = self.cli("sprint", "next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("SPRINT COMPLETE - all 1 task done!", proc.stdout)
        self.assertIn("DEMO-3 - ", proc.stdout)
        self.assertIn("[done]", proc.stdout)
        self.assertIn("Project Zomboid", proc.stdout)

    def test_sprint_next_in_progress_only(self):
        self.cli("sprint", "set", "DEMO-1", stdin="y\n")
        proc = self.cli("sprint", "next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("in progress: DEMO-1", proc.stdout)
        self.assertIn("finish what is in flight", proc.stdout)

    def test_sprint_next_no_sprint(self):
        proc = self.cli("sprint", "next")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("no sprint set", proc.stdout)

    def test_sprint_next_all_annotations(self):
        self.cli("edit", "DEMO-2", "replace", "DEMO-4", "--field", "blocked_by", stdin="y\n")
        self.cli("sprint", "set", "DEMO-2", "DEMO-4", stdin="y\n")
        proc = self.cli("sprint", "next", "--all")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("[bumped, blocks DEMO-2]", proc.stdout)
        self.assertIn("DEMO-2 (2/10) [blocked by DEMO-4]", proc.stdout)



    def test_set_with_summary_writes_both(self):
        proc = self.cli("set", "DEMO-2", "done", "--summary", "second fixture task", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("status -> completed", proc.stdout)
        self.assertIn("summary <- second fixture task", proc.stdout)
        self.assertIn("exactly the approved writes: DEMO-2 status -> completed, summary set", proc.stdout)
        tasks = self.tasks()
        self.assertEqual(tasks["DEMO-2"]["status"], "completed")
        self.assertEqual((tasks["DEMO-2"].get("summary") or "").strip(), "second fixture task")

    def test_set_summary_only_when_status_already_matches(self):
        proc = self.cli("set", "DEMO-1", "wip", "--summary", "first fixture task", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("summary <- first fixture task", proc.stdout)
        self.assertNotIn("status ->", proc.stdout)
        tasks = self.tasks()
        self.assertEqual(tasks["DEMO-1"]["status"], "in_progress")
        self.assertEqual((tasks["DEMO-1"].get("summary") or "").strip(), "first fixture task")

    def test_set_empty_summary_rejected(self):
        proc = self.cli("set", "DEMO-2", "done", "--summary", "   ", stdin="y\n")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--summary must not be empty", proc.stderr)

    def test_set_without_summary_unchanged(self):
        proc = self.cli("set", "DEMO-2", "done", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("exactly one change: DEMO-2 pending -> completed", proc.stdout)

    def test_show_full_detail(self):
        proc = self.cli("show", "DEMO-1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-1 - ", proc.stdout)
        self.assertIn("status: in_progress", proc.stdout)
        self.assertIn("effort: 8/10", proc.stdout)
        self.assertIn("description:", proc.stdout)
        self.assertIn("source:", proc.stdout)

    def test_show_case_insensitive_code(self):
        proc = self.cli("show", "demo-1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("DEMO-1 - ", proc.stdout)

    def test_show_unknown_code_rejected(self):
        proc = self.cli("show", "NOPE-9")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("no task NOPE-9", proc.stderr)


class SyncKickTests(CliCase):
    """The post-write kick goes to the fake systemctl, queued with --no-block,
    whatever the caller's DBUS/XDG environment looks like."""

    def assert_write_kicks(self):
        proc = self.cli("set", "DEMO-1", "completed", stdin="y\n")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("PASS", proc.stdout)
        starts = [c for c in self.systemctl_calls() if " start " in f" {c} "]
        self.assertTrue(starts, self.systemctl_calls())
        self.assertIn("--no-block", starts[-1].split())

    def test_approved_write_kicks_with_no_block(self):
        self.assert_write_kicks()

    def test_kick_ignores_bus_env(self):
        self.env["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=/nonexistent/bus"
        self.env["XDG_RUNTIME_DIR"] = "/nonexistent/run"
        self.assert_write_kicks()

    def test_kick_with_bus_env_unset(self):
        self.env.pop("DBUS_SESSION_BUS_ADDRESS", None)
        self.env.pop("XDG_RUNTIME_DIR", None)
        self.assert_write_kicks()

    def test_sync_command_uses_no_block(self):
        proc = self.cli("sync")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("--user start --no-block roadmap-sync.service", self.systemctl_calls())


if __name__ == "__main__":
    unittest.main()



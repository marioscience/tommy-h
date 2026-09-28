"""Tests for release-watch.sh - the desktop release notifier.

The watcher is a fail-safe hook in the 5-minute sync run: it must announce an
uninstalled channel release at most every 4 hours, stay silent when the
install is current, initialize its marker silently on first run, and never
fail the sync no matter what breaks. rclone and notify-send are stubbed on a
fake PATH; state lives in a temp M4_STATE.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

# the script installs to the lib dir while this test lives in the tests dir,
# so resolve it the way test_roadmap_cli.py resolves the CLI: env-overridable
LIB_DIR = Path(os.environ.get("ROADMAP_SYNC_LIB", "~/.local/lib/roadmap-sync")).expanduser()
SCRIPT = LIB_DIR / "release-watch.sh"

RCLONE_STUB = """#!/usr/bin/env bash
if [ -n "${FAKE_RCLONE_FAIL:-}" ]; then echo "boom" >&2; exit 1; fi
if [ "$1" = "cat" ] && [ "$2" = "${M4_RELEASES_REMOTE}/LATEST" ]; then
  printf '%s\\n' "${FAKE_LATEST:-}"
  exit 0
fi
echo "unexpected rclone args: $*" >&2; exit 1
"""

NOTIFY_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${NOTIFY_LOG}"
if [ -n "${FAKE_NOTIFY_FAIL:-}" ]; then exit 1; fi
"""


class ReleaseWatchCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.state = self.tmp / "state"
        self.state.mkdir()
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        (self.bin / "rclone").write_text(RCLONE_STUB)
        (self.bin / "notify-send").write_text(NOTIFY_STUB)
        for stub in ("rclone", "notify-send"):
            (self.bin / stub).chmod(0o755)
        self.notify_log = self.tmp / "notify.log"
        self.env = dict(os.environ)
        self.env.update({
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "M4_STATE": str(self.state),
            "M4_RELEASES_REMOTE": "fake:releases",
            "NOTIFY_LOG": str(self.notify_log),
            "FAKE_LATEST": "m4.6-test-release",
        })

    def run_watch(self, **env_overrides):
        env = dict(self.env)
        env.update({k: str(v) for k, v in env_overrides.items()})
        return subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True, env=env)

    def set_marker(self, name):
        (self.state / "installed-release").write_text(name + "\n")

    def set_last_notified(self, age_seconds):
        (self.state / "release-watch-last-notified").write_text(str(int(time.time() - age_seconds)) + "\n")

    def notifications(self):
        return self.notify_log.read_text().splitlines() if self.notify_log.exists() else []


class NotifyTests(ReleaseWatchCase):
    def test_announces_uninstalled_release(self):
        self.set_marker("m4.5-cli-2026-09-23")
        proc = self.run_watch()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.notifications(),
                         ["Patching code m4.6-test-release is on the channel - run: roadmap update"])
        self.assertTrue((self.state / "release-watch-last-notified").is_file())

    def test_silent_when_current(self):
        self.set_marker("m4.6-test-release")
        proc = self.run_watch()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.notifications(), [])

    def test_first_run_initializes_marker_silently(self):
        proc = self.run_watch()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.notifications(), [])
        self.assertEqual((self.state / "installed-release").read_text().strip(), "m4.6-test-release")

    def test_no_renotify_inside_4_hours(self):
        self.set_marker("m4.5-cli-2026-09-23")
        self.set_last_notified(age_seconds=3600)
        proc = self.run_watch()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.notifications(), [])

    def test_renotify_after_4_hours(self):
        self.set_marker("m4.5-cli-2026-09-23")
        self.set_last_notified(age_seconds=4 * 3600 + 10)
        proc = self.run_watch()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(self.notifications()), 1)


class FailSafeTests(ReleaseWatchCase):
    def test_rclone_failure_never_fails(self):
        self.set_marker("m4.5-cli-2026-09-23")
        proc = self.run_watch(FAKE_RCLONE_FAIL="1")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(self.notifications(), [])

    def test_empty_latest_never_fails(self):
        self.set_marker("m4.5-cli-2026-09-23")
        proc = self.run_watch(FAKE_LATEST="")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(self.notifications(), [])

    def test_notify_failure_never_fails_and_retries_soon(self):
        self.set_marker("m4.5-cli-2026-09-23")
        proc = self.run_watch(FAKE_NOTIFY_FAIL="1")
        self.assertEqual(proc.returncode, 0)
        # last-notified must NOT be written, so the next sync run tries again
        self.assertFalse((self.state / "release-watch-last-notified").is_file())

    def test_missing_state_dir_never_fails(self):
        import shutil
        shutil.rmtree(self.state)
        proc = self.run_watch()
        self.assertEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main()

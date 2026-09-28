#!/usr/bin/env python3
"""roadmap - the command line for the roadmap-sync system.

One entry point for everything: pulling and installing releases (update),
service health and the live picture (status), guarded writes that reuse the
same propose -> review -> approve -> apply gates as every other path
(set / add / edit / delete), and views into what the system did
(log / receipts). Nothing here bypasses the gates: every write still shows
the exact colored git diff and waits for a y.

Env overrides (same names the rest of the system uses):
  M4_LIB     pipeline modules dir   (default ~/.local/lib/roadmap-sync)
  M4_ROOT    roadmap root           (default ~/projects)
  M4_INBOX   write inbox            (default ~/roadmap-write-inbox)
  M4_PARSER  parser path            (default $M4_LIB/roadmap_sync.py)
  M4_RELEASES_REMOTE  release channel remote (default gdrive:InstinctConnector/releases)
  M4_RELEASES_LOCAL   local download dir       (default ~/instinct-inbox)
  ROADMAP_NO_PROGRESS  disable the update progress bar
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CLI_VERSION = "1.7.0"
RELEASE_NAME = "m5.5-test-fix"

HOME = Path.home()
LIB = Path(os.environ.get("M4_LIB", HOME / ".local/lib/roadmap-sync")).expanduser()
ROOT = Path(os.environ.get("M4_ROOT", HOME / "projects")).expanduser()
INBOX = Path(os.environ.get("M4_INBOX", HOME / "roadmap-write-inbox")).expanduser()
PARSER = Path(os.environ.get("M4_PARSER", LIB / "roadmap_sync.py")).expanduser()
STATE = HOME / ".local/share/roadmap-sync"
CHAT_LOG = STATE / "chat-ops.log"
SNAPSHOT_FILE = STATE / "roadmap-status.json"
RELEASES_REMOTE = os.environ.get("M4_RELEASES_REMOTE", "gdrive:InstinctConnector/releases")
RELEASES_LOCAL = Path(os.environ.get("M4_RELEASES_LOCAL", HOME / "instinct-inbox")).expanduser()

STATUS_ALIASES = {
    "completed": "completed", "complete": "completed", "done": "completed",
    "in_progress": "in_progress", "in-progress": "in_progress", "inprogress": "in_progress",
    "wip": "in_progress", "started": "in_progress",
    "pending": "pending", "todo": "pending", "to-do": "pending", "open": "pending",
}


def die(msg: str, code: int = 2) -> "SystemExit":
    print(msg, file=sys.stderr)
    return SystemExit(code)


def run(cmd: list, capture: bool = False, check: bool = True, **kw) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, capture_output=capture, text=True, **kw)
    if check and proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:] if capture else []
        raise die(f"command failed ({' '.join(str(c) for c in cmd[:2])} ...): " + " | ".join(tail))
    return proc


def parser_args() -> list:
    return ["--parser", str(PARSER)] if os.environ.get("M4_PARSER") else []


def snapshot(out_path: Path, strict: bool = True) -> dict:
    cmd = ["python3", str(PARSER), "--root", str(ROOT), "--output", str(out_path)]
    if strict:
        cmd.append("--strict")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise die("snapshot failed: " + (proc.stderr or proc.stdout).strip().splitlines()[-1])
    return json.loads(out_path.read_text())


def norm_status(raw: str) -> str:
    status = STATUS_ALIASES.get(raw.lower())
    if not status:
        raise die(f"unknown status: {raw} (use pending, in_progress, completed - or todo, wip, done)")
    return status


def check_inbox_outside_root() -> None:
    root, inbox = os.path.realpath(ROOT), os.path.realpath(INBOX)
    if inbox == root or inbox.startswith(root + os.sep):
        raise die(f"REFUSE: write-inbox is inside the scanned root {root}")


def task_table(snap: dict) -> dict:
    return {t["code"]: t for t in snap["tasks"]}


SYSTEMCTL_TIMEOUT = 5  # seconds; the kick is queued with --no-block, never waited on


def kick_sync(hint_on_missing: bool) -> None:
    """Post-write sync kick. Queues the service start and returns at once; a
    slow or missing systemctl never turns an applied write into a failure."""
    try:
        proc = subprocess.run(["systemctl", "--user", "cat", "roadmap-sync.service"],
                              capture_output=True, timeout=SYSTEMCTL_TIMEOUT)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        print(f"could not check the user service ({type(exc).__name__}) - start it by hand:")
        print("  systemctl --user start roadmap-sync.service")
        return
    if proc.returncode == 0:
        try:
            subprocess.run(["systemctl", "--user", "start", "--no-block", "roadmap-sync.service"],
                           capture_output=True, timeout=SYSTEMCTL_TIMEOUT)
            print("sync started - the dashboard confirms within a minute")
        except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
            print(f"sync kick did not go through ({type(exc).__name__}) - start it by hand:")
            print("  systemctl --user start roadmap-sync.service")
    elif hint_on_missing:
        print("could not see the user service from this shell - start it by hand:")
        print("  systemctl --user start roadmap-sync.service")


def guarded_apply(op_path: Path, before_path: Path, expect: dict) -> int:
    """Review (colored git diff at a terminal), y/N, approve, apply, prove the delta."""
    run(["python3", str(LIB / "roadmap_review.py"), str(op_path), "--root", str(ROOT)] + parser_args())
    answer = input(expect["prompt"])
    if answer != "y":
        print(f"aborted - nothing was written (the proposal sits unapproved in {INBOX}/pending)")
        return 1
    run(["python3", str(LIB / "roadmap_review.py"), str(op_path), "--root", str(ROOT),
         "--inbox", str(INBOX), "--approve"] + parser_args())
    run(["python3", str(LIB / "roadmap_apply.py"), "--inbox", str(INBOX), "--root", str(ROOT)] + parser_args())

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        after_path = Path(f.name)
    after = task_table(snapshot(after_path))
    before = task_table(json.loads(before_path.read_text()))
    code = expect["code"]
    ok, msg = expect["check"](before, after, code)
    if not ok:
        raise die(f"FAIL: unexpected delta - {msg}", 1)
    print(msg)

    kick_sync(hint_on_missing=True)
    print("PASS")
    return 0


def propose(subcommand: list) -> Path:
    (INBOX / "pending").mkdir(parents=True, exist_ok=True)
    out = run(["python3", str(LIB / "roadmap_write.py"), subcommand[0], *subcommand[1:],
               "--root", str(ROOT), "--out", str(INBOX / "pending")] + parser_args(), capture=True)
    print(out.stdout, end="")
    for line in out.stdout.splitlines():
        if line.startswith("operation: "):
            return Path(line.split()[1])
    raise die("propose did not report an operation path")


def require_task(before: dict, code: str) -> None:
    if code not in before:
        raise die(f"no task {code!r} on the roadmap. known codes: {sorted(before)}")


def cmd_set(args) -> int:
    to = norm_status(args.status)
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    before = task_table(snapshot(before_path))
    require_task(before, args.code)
    wants_summary = args.summary is not None
    if wants_summary and not args.summary.strip():
        raise die("--summary must not be empty")
    if before[args.code]["status"] == to and not wants_summary:
        raise die(f"{args.code} is already {to} - nothing to do.")
    if wants_summary:
        # status flip + summary backfill in one command (m5.3): one upfront y,
        # each write through the full guarded path (per-op pins, diffs,
        # receipts), then one combined delta proof.
        plan = []
        if before[args.code]["status"] != to:
            plan.append(["propose", "--task", args.code, "--to", to,
                         "--reason", f"roadmap CLI: Mario set {args.code} to {to}"])
        plan.append(["propose-edit", "--task", args.code, "--mode", "replace",
                     "--field", "summary", "--text", args.summary.strip(),
                     "--reason", f"roadmap CLI: Mario set {args.code} summary"])
        print(f"write plan for {args.code}:")
        if before[args.code]["status"] != to:
            print(f"  status -> {to}")
        print(f"  summary <- {args.summary.strip()}")
        answer = input(f"Approve and apply {len(plan)} write(s) on the REAL roadmap? [y/N] ")
        if answer != "y":
            print("aborted - nothing was written")
            return 1
        applied = 0
        try:
            for spec in plan:
                op = propose(spec)
                run(["python3", str(LIB / "roadmap_review.py"), str(op), "--root", str(ROOT)] + parser_args())
                run(["python3", str(LIB / "roadmap_review.py"), str(op), "--root", str(ROOT),
                     "--inbox", str(INBOX), "--approve"] + parser_args())
                run(["python3", str(LIB / "roadmap_apply.py"), "--inbox", str(INBOX), "--root", str(ROOT)] + parser_args())
                applied += 1
        except SystemExit:
            print(f"stopped after {applied} of {len(plan)} writes - receipts in {INBOX}/receipts say why")
            raise
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            after_path = Path(f.name)
        after = task_table(snapshot(after_path))
        status_moved = {k for k in set(before) | set(after)
                        if before.get(k, {}).get("status") != after.get(k, {}).get("status")}
        summary_moved = {k for k in set(before) & set(after)
                         if task_field_text(before[k], "summary") != task_field_text(after[k], "summary")}
        ok = (status_moved <= {args.code} and summary_moved == {args.code}
              and after[args.code]["status"] == to
              and (task_field_text(after[args.code], "summary") or "").strip() == args.summary.strip())
        if not ok:
            raise die("FAIL: unexpected delta - more than the approved status+summary changed", 1)
        moves = ([f"status -> {to}"] if before[args.code]["status"] != to else []) + ["summary set"]
        print(f"exactly the approved writes: {args.code} " + ", ".join(moves))
        # same post-write sync kick as guarded_apply
        kick_sync(hint_on_missing=False)
        print("PASS")
        return 0
    op = propose(["propose", "--task", args.code, "--to", to,
                  "--reason", f"roadmap CLI: Mario set {args.code} to {to}"])
    return guarded_apply(op, before_path, {
        "code": args.code,
        "prompt": f"Approve and apply {args.code} -> {to} on the REAL roadmap? [y/N] ",
        "check": lambda b, a, c: (
            (True, f"exactly one change: {c} {b[c]['status']} -> {to}")
            if {k for k in set(b) | set(a) if b.get(k, {}).get("status") != a.get(k, {}).get("status")} == {c}
            and a[c]["status"] == to
            else (False, "statuses moved beyond the approved change")
        )
    })


def cmd_add(args) -> int:
    to = norm_status(args.status)
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    before = task_table(snapshot(before_path))
    if args.code in before:
        raise die(f"{args.code} already exists - nothing to do.")
    sub = ["propose-add", "--file", args.file, "--task", args.code, "--title", args.title,
           "--effort", str(args.effort), "--status", to,
           "--reason", f"roadmap CLI: Mario added {args.code}"]
    if args.desc:
        sub += ["--description", args.desc]
    op = propose(sub)
    return guarded_apply(op, before_path, {
        "code": args.code,
        "prompt": f"Approve and ADD {args.code} to {args.file} on the REAL roadmap? [y/N] ",
        "check": lambda b, a, c: (
            (True, f"exactly one change: {c} added as {a[c]['status']}")
            if c in a and c not in b and len(a) == len(b) + 1
            and {k for k in b if b[k]["status"] != a.get(k, {}).get("status")} == set()
            else (False, "task delta is not exactly the approved add")
        )
    })


def task_field_text(t: dict, field: str) -> str:
    if field == "description":
        return (t.get("description") or "")
    return ((t.get("fields") or {}).get(field) or "").strip()


def cmd_edit(args) -> int:
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    before = task_table(snapshot(before_path))
    require_task(before, args.code)
    if args.mode == "clear":
        if args.field == "description":
            raise die("the description cannot be cleared")
    elif not args.text.strip():
        raise die("edit text must not be empty")
    op = propose(["propose-edit", "--task", args.code, "--mode", args.mode, "--field", args.field,
                  "--text", args.text,
                  "--reason", f"roadmap CLI: Mario edited {args.code} {args.field} ({args.mode})"])
    return guarded_apply(op, before_path, {
        "code": args.code,
        "prompt": f"Approve and EDIT the {args.code} {args.field} on the REAL roadmap? [y/N] ",
        "check": lambda b, a, c: (
            (True, f"exactly one change: {c} {args.field} edited (status stays {a[c]['status']})")
            if {k for k in set(b) | set(a) if b.get(k, {}).get("status") != a.get(k, {}).get("status")} == set()
            and {k for k in set(b) & set(a)
                 if task_field_text(b[k], args.field) != task_field_text(a[k], args.field)} == {c}
            else (False, "delta is not exactly the approved edit")
        )
    })


def cmd_delete(args) -> int:
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    before = task_table(snapshot(before_path))
    require_task(before, args.code)
    print(f"*** DELETE WARNING: this permanently removes {args.code} from the roadmap file.")
    print("*** Recovery is manual: the full block stays in the receipt and a byte")
    print(f"*** backup of the file lands in {INBOX}/backups.")
    op = propose(["propose-delete", "--task", args.code,
                  "--reason", f"roadmap CLI: Mario asked to DELETE {args.code}"])
    return guarded_apply(op, before_path, {
        "code": args.code,
        "prompt": f"Approve and DELETE {args.code} from the REAL roadmap? (recoverable via receipt + backup) [y/N] ",
        "check": lambda b, a, c: (
            (True, f"exactly one change: {c} removed (was {b[c]['status']})")
            if c in b and c not in a and len(a) == len(b) - 1
            and {k for k in a if b.get(k, {}).get("status") != a[k]["status"]} == set()
            else (False, "task delta is not exactly the approved delete")
        )
    })


def cmd_status(args) -> int:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    proc = subprocess.run(["python3", str(PARSER), "--root", str(ROOT),
                           "--output", str(out_path)], capture_output=True, text=True)
    if proc.returncode != 0:
        print("snapshot failed:", (proc.stderr or proc.stdout).strip().splitlines()[-1])
        return 1
    snap = json.loads(out_path.read_text())
    s = snap["summary"]
    counts = s["status_counts"]
    print(f"roadmap: {s['task_count']} tasks across {s['source_count']} sources, {s['error_count']} errors")
    print(f"  pending {counts.get('pending', 0)} | in progress {counts.get('in_progress', 0)} | completed {counts.get('completed', 0)}")
    for t in snap["tasks"]:
        if t["status"] == "in_progress":
            print(f"  working: {t['code']} - {t['title']}")
    proc = subprocess.run(["systemctl", "--user", "is-active", "roadmap-sync.timer"], capture_output=True, text=True)
    timer = proc.stdout.strip() if proc.returncode == 0 else "not visible from this shell"
    print(f"sync timer: {timer}")
    if SNAPSHOT_FILE.is_file():
        import datetime
        mtime = datetime.datetime.fromtimestamp(SNAPSHOT_FILE.stat().st_mtime).strftime("%H:%M")
        print(f"last upload: {mtime} ({SNAPSHOT_FILE})")
    return 0


def short_desc(t: dict, width: int = 80) -> str:
    """One-line short description: the summary field when present, else the
    first line of the description, truncated. Falls back to the title."""
    s = (t.get("summary") or "").strip()
    if not s:
        lines = (t.get("description") or "").strip().splitlines()
        s = lines[0].strip() if lines else ""
    if len(s) > width:
        s = s[: width - 3].rstrip() + "..."
    return s


def effort_str(t: dict) -> str:
    eff = t.get("effort") or {}
    ev, es = eff.get("value"), eff.get("scale")
    return f"{ev:g}/{es:g}" if ev is not None and es is not None else "-"


def list_line(t: dict) -> str:
    text = short_desc(t) or t["title"]
    mark = {"in_progress": " [in progress]", "completed": " [done]"}.get(t["status"], "")
    return f"{t['code']} - {text} ({effort_str(t)}){mark}"


def sprint_members(snap: dict) -> list:
    members = [t for t in snap["tasks"] if t.get("sprint_member")]
    members.sort(key=lambda t: (t.get("sprint_order") or 0, t["code"]))
    return members


def cmd_list(args) -> int:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    tasks = snap["tasks"]
    total = len(tasks)
    wanted = {s for s, flag in (("completed", args.completed), ("in_progress", args.in_progress),
                                ("pending", args.pending)) if flag}
    if wanted:
        tasks = [t for t in tasks if t["status"] in wanted]
    if args.file:
        needle = args.file.lower()
        tasks = [t for t in tasks if needle in ((t.get("source") or {}).get("relative_path") or "").lower()]
    counts = snap["summary"]["status_counts"]
    print(f"All tasks: {total} ({counts.get('completed', 0)} done, {counts.get('in_progress', 0)} in progress, "
          f"{counts.get('pending', 0)} pending)")
    if not tasks:
        print("no tasks match those filters" if (wanted or args.file) else "no tasks on the roadmap")
        return 0

    def emit(t: dict) -> None:
        print(list_line(t))
        if args.desc and (t.get("description") or "").strip():
            print(f"    {t['description'].strip()}")

    sprint_ts = [t for t in tasks if t.get("sprint_member")]
    sprint_ts.sort(key=lambda t: (t.get("sprint_order") or 0, t["code"]))
    if sprint_ts:
        print("\n== CURRENT SPRINT ==")
        for t in sprint_ts:
            emit(t)
    groups = {}
    order = []
    for t in tasks:
        if t.get("sprint_member"):
            continue
        rel = (t.get("source") or {}).get("relative_path") or "?"
        if rel not in groups:
            groups[rel] = []
            order.append(rel)
        groups[rel].append(t)
    for rel in order:
        print(f"\n== {rel} ==")
        for t in groups[rel]:
            emit(t)
    return 0


def next_pick(snap: dict, members: list):
    """The one task to serve: first pending in the sprint order (fallback: first
    pending in board order), then auto-bump to its deepest pending blocker.
    Returns (serve, directly_blocked_task_or_None, used_fallback)."""
    by_code = {t["code"]: t for t in snap["tasks"]}
    if members:
        base = next((t for t in members if t["status"] == "pending"), None)
        fallback = False
    else:
        base = next((t for t in snap["tasks"] if t["status"] == "pending"), None)
        fallback = True
    if base is None:
        return None, None, fallback
    seen = set()
    serve, prev = base, None
    while serve["code"] not in seen:
        seen.add(serve["code"])
        dep = next((by_code[c] for c in (serve.get("blocked_by") or [])
                    if c in by_code and by_code[c]["status"] == "pending"), None)
        if dep is None:
            break
        prev, serve = serve, dep
    return serve, prev, fallback


def cmd_next(args) -> int:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    members = sprint_members(snap)
    if args.all:
        by_code = {t["code"]: t for t in snap["tasks"]}
        pool = [t for t in (members if members else snap["tasks"]) if t["status"] == "pending"]
        rows = []
        emitted = set()
        for t in pool:
            if t["code"] in emitted:
                continue
            dep = next((by_code[c] for c in (t.get("blocked_by") or [])
                        if c in by_code and by_code[c]["status"] == "pending"), None)
            if dep is not None and dep["code"] not in emitted and not dep.get("sprint_member"):
                rows.append(f"{dep['code']} ({effort_str(dep)}) [bumped, off-sprint, blocks {t['code']}]")
                emitted.add(dep["code"])
            note = f" [blocked by {dep['code']}]" if dep is not None else ""
            rows.append(f"{t['code']} ({effort_str(t)}){note}")
            emitted.add(t["code"])
        if not rows:
            print("nothing pending" + (" on the sprint" if members else ""))
            return 0
        for i, row in enumerate(rows, 1):
            print(f"{i:>2}. {row}")
        return 0
    serve, prev, fallback = next_pick(snap, members)
    if serve is None:
        print("nothing pending - the roadmap is clear")
        return 0
    print(f"{serve['code']} - {serve['title']} ({effort_str(serve)})")
    if prev is not None:
        pos = prev.get("sprint_order")
        where = f"sprint {pos} of {len(members)}" if pos else "on the sprint"
        if serve.get("sprint_member"):
            print(f"jumped ahead: blocks {prev['code']} ({where})")
        else:
            print(f"jumped in from off-sprint: blocks {prev['code']} ({where})")
            print(f"add it to the sprint: roadmap sprint set --add {serve['code']}")
    elif fallback:
        print("no active sprint - top pending in board order")
    else:
        pos = serve.get("sprint_order")
        if pos:
            print(f"sprint task {pos} of {len(members)}, your order")
        else:
            print("on the sprint, your order")
    print(f"run: roadmap set {serve['code']} in_progress")
    return 0


SPRINT_MARKER = re.compile(r"^\s*sprint\s*:\s*(\d{4}-\d{2}-\d{2})\s*->\s*(\d{4}-\d{2}-\d{2})\s*$")


def sprint_windows() -> list:
    """Scan the source files of the current snapshot for sprint marker lines.

    The marker is one plain line near the top of a roadmap file:
    sprint: 2026-09-16 -> 2026-09-30
    The parser also reads it into the snapshot (m5.1); this scan stays so the CLI
    works against older snapshots too.
    """
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    rel_paths = []
    for t in snap["tasks"]:
        rel = (t.get("source") or {}).get("relative_path")
        if rel and rel not in rel_paths:
            rel_paths.append(rel)
    found = []
    for rel in rel_paths:
        try:
            head = (ROOT / rel).read_text(encoding="utf-8").splitlines()[:40]
        except OSError:
            continue
        for line in head:
            m = SPRINT_MARKER.match(line)
            if m:
                found.append((rel, date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))))
    return snap, found


def _fmt_day(d: date) -> str:
    return d.strftime("%b") + " " + str(d.day)


def sprint_view(snap: dict) -> int:
    _snap, windows = sprint_windows()
    today = date.today()
    current = [w for w in windows if w[1] <= today <= w[2]]
    chosen = current[0] if current else (max(windows, key=lambda w: w[2]) if windows else None)
    if chosen is None:
        print("Sprint window not set - add one marker line at the top of a roadmap file:")
        print("  sprint: YYYY-MM-DD -> YYYY-MM-DD")
    else:
        _rel, start, end = chosen
        if today < start:
            n = (start - today).days
            when = f"starts in {n} day{'s' if n != 1 else ''}"
        elif today > end:
            n = (today - end).days
            when = f"ended {n} day{'s' if n != 1 else ''} ago"
        else:
            n = (end - today).days
            when = f"{n} day{'s' if n != 1 else ''} left"
        print(f"Sprint {start.isoformat()} -> {end.isoformat()} ({when})")
    members = sprint_members(snap)
    if not members:
        print("No active sprint - set one with: roadmap sprint set CODE [CODE...]")
        return 0
    total = sum((t.get("effort") or {}).get("value") or 0 for t in members)
    print(f"Set ({len(members)} tasks, {total:g} effort):")
    for i, t in enumerate(members, 1):
        mark = {"in_progress": " [in progress]", "completed": " [done]"}.get(t["status"], "")
        print(f"{i:>2}. {t['code']} ({effort_str(t)}){mark}")
    serve, _prev, _fallback = next_pick(snap, members)
    print(f"Next up: {serve['code']}" if serve else "Next up: nothing pending")
    return 0


def apply_sprint_writes(plan: list) -> int:
    """plan: (mode, code, text|None) sprint-field writes. One upfront y, then each
    write runs the full guarded path (propose -> review -> approve -> apply) in
    order, so every op pins the live bytes of its moment. Per-op receipts and
    backups are exactly the ones a single write would leave."""
    print("write plan (one guarded write per line):")
    for mode, c, val in plan:
        print(f"  {c}: Sprint <- {val}" if mode == "replace" else f"  {c}: Sprint field cleared")
    answer = input(f"Approve and apply {len(plan)} field write(s) on the REAL roadmap? [y/N] ")
    if answer != "y":
        print("aborted - nothing was written")
        return 1
    applied = 0
    try:
        for mode, c, val in plan:
            op = propose(["propose-edit", "--task", c, "--mode", mode, "--field", "sprint",
                          "--text", val or "",
                          "--reason", f"roadmap CLI: sprint field write ({mode}{' ' + val if val else ''} on {c})"])
            run(["python3", str(LIB / "roadmap_review.py"), str(op), "--root", str(ROOT)] + parser_args())
            run(["python3", str(LIB / "roadmap_review.py"), str(op), "--root", str(ROOT),
                 "--inbox", str(INBOX), "--approve"] + parser_args())
            run(["python3", str(LIB / "roadmap_apply.py"), "--inbox", str(INBOX), "--root", str(ROOT)] + parser_args())
            applied += 1
    except SystemExit:
        print(f"stopped after {applied} of {len(plan)} writes - receipts in {INBOX}/receipts say why")
        raise
    return 0


def sprint_set(args) -> int:
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    snap = snapshot(before_path)
    before = task_table(snap)
    members = sprint_members(snap)
    for code in args.codes:
        require_task(before, code)
    if len(set(args.codes)) != len(args.codes):
        raise die("duplicate codes in the list")
    current_order = [t["code"] for t in members]
    if args.add:
        dupes = [c for c in args.codes if c in current_order]
        if dupes:
            raise die(f"already on the sprint: {', '.join(dupes)} - reorder with: roadmap sprint move CODE --to N")
        new_order = current_order + args.codes
        clears = []
    else:
        new_order = args.codes
        clears = [c for c in current_order if c not in args.codes]
    cur_pos = {t["code"]: t.get("sprint_order") for t in members}
    plan = [("replace", c, str(i + 1)) for i, c in enumerate(new_order) if cur_pos.get(c) != i + 1]
    plan += [("clear", c, None) for c in clears]
    if not plan:
        print("sprint already exactly that - nothing to do.")
        return 0
    if apply_sprint_writes(plan) != 0:
        return 1
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        after_path = Path(f.name)
    got = [t["code"] for t in sprint_members(snapshot(after_path))]
    if got != new_order:
        raise die(f"FAIL: sprint order is {got}, expected {new_order}", 1)
    suffix = f" ({len(clears)} cleared)" if clears else ""
    print(f"Sprint set: {len(new_order)} tasks, in your listed order{suffix}")
    print("PASS")
    return 0


def sprint_clear(args) -> int:
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    snap = snapshot(before_path)
    members = sprint_members(snap)
    if not members:
        print("no sprint set - nothing to clear.")
        return 0
    plan = [("clear", t["code"], None) for t in members]
    if apply_sprint_writes(plan) != 0:
        return 1
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        after_path = Path(f.name)
    left = sprint_members(snapshot(after_path))
    if left:
        raise die(f"FAIL: sprint still has members: {[t['code'] for t in left]}", 1)
    print("Sprint cleared - the window marker line was not touched")
    print("PASS")
    return 0


def sprint_move(args) -> int:
    check_inbox_outside_root()
    before_path = Path(tempfile.mkstemp(suffix=".json")[1])
    snap = snapshot(before_path)
    members = sprint_members(snap)
    codes = [t["code"] for t in members]
    if args.code not in codes:
        raise die(f"{args.code} is not on the sprint (set: {', '.join(codes) or 'empty'})")
    if not 1 <= args.to <= len(codes):
        raise die(f"--to must be between 1 and {len(codes)}")
    codes.remove(args.code)
    codes.insert(args.to - 1, args.code)
    cur_pos = {t["code"]: t.get("sprint_order") for t in members}
    plan = [("replace", c, str(i + 1)) for i, c in enumerate(codes) if cur_pos.get(c) != i + 1]
    if not plan:
        print(f"{args.code} is already at position {args.to} - nothing to do.")
        return 0
    if apply_sprint_writes(plan) != 0:
        return 1
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        after_path = Path(f.name)
    got = [t["code"] for t in sprint_members(snapshot(after_path))]
    if got != codes:
        raise die(f"FAIL: sprint order is {got}, expected {codes}", 1)
    print("Sprint order: " + ", ".join(codes))
    print("PASS")
    return 0


def sprint_list(args) -> int:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    members = sprint_members(snap)
    if not members:
        print("no sprint set - nothing to list.")
        return 0
    print("== CURRENT SPRINT ==")
    for t in members:
        print(list_line(t))
    return 0


def sprint_next(args) -> int:
    """Sprint-scoped next: the roster only, never off-sprint tasks (the global
    `roadmap next` keeps the off-sprint view). When the roster is all done it
    celebrates: his 6:54 PM spec - flashy congrats, recreation encouragement
    (Project Zomboid), and a summary of the completed work."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    members = sprint_members(snap)
    if not members:
        print("no sprint set - roadmap next works globally without one")
        return 0
    by_code = {t["code"]: t for t in snap["tasks"]}
    on_sprint = {t["code"] for t in members}
    pending = [t for t in members if t["status"] == "pending"]

    def on_sprint_dep(t):
        return next((by_code[c] for c in (t.get("blocked_by") or [])
                     if c in by_code and by_code[c]["status"] == "pending" and c in on_sprint), None)

    def off_sprint_dep(t):
        return next((c for c in (t.get("blocked_by") or [])
                     if c in by_code and by_code[c]["status"] == "pending" and c not in on_sprint), None)

    if args.all and pending:
        rows, emitted = [], set()
        for t in pending:
            if t["code"] in emitted:
                continue
            dep, off = on_sprint_dep(t), off_sprint_dep(t)
            if dep is not None and dep["code"] not in emitted:
                rows.append(f"{dep['code']} ({effort_str(dep)}) [bumped, blocks {t['code']}]")
                emitted.add(dep["code"])
            note = f" [blocked by {dep['code']}]" if dep is not None else ""
            note += f" [also blocked off-sprint by {off}]" if off else ""
            rows.append(f"{t['code']} ({effort_str(t)}){note}")
            emitted.add(t["code"])
        for i, row in enumerate(rows, 1):
            print(f"{i:>2}. {row}")
        return 0

    if not pending:
        wip = [t for t in members if t["status"] == "in_progress"]
        if wip:
            for t in wip:
                print(f"in progress: {t['code']} - {t['title']} ({effort_str(t)})")
            print("finish what is in flight, then: roadmap sprint next")
            return 0
        n = len(members)
        points = sum((t.get("effort") or {}).get("value") or 0 for t in members)
        print("=" * 50)
        print(f"  SPRINT COMPLETE - all {n} task{'s' if n != 1 else ''} done!")
        print("=" * 50)
        print(f"you shipped {n} task{'s' if n != 1 else ''}, {points:g} effort points:")
        for t in members:
            print(f"  {t['code']} - {t['title']} ({effort_str(t)}) [done]")
        print()
        print("that is a real body of work. Go play some Project Zomboid -")
        print("you have earned the recreation period.")
        return 0

    base = pending[0]
    seen, serve, prev = set(), base, None
    while serve["code"] not in seen:
        seen.add(serve["code"])
        dep = on_sprint_dep(serve)
        if dep is None:
            break
        prev, serve = serve, dep
    print(f"{serve['code']} - {serve['title']} ({effort_str(serve)})")
    if prev is not None:
        print(f"jumped ahead: blocks {prev['code']} (sprint {prev.get('sprint_order')} of {len(members)})")
    else:
        pos = serve.get("sprint_order")
        if pos:
            print(f"sprint task {pos} of {len(members)}, your order")
    off = off_sprint_dep(serve)
    if off:
        print(f"heads up: also blocked by off-sprint {off} - roadmap next sees it")
    print(f"run: roadmap set {serve['code']} in_progress")
    return 0


def show_task_detail(t: dict, members: list) -> None:
    """Full detail for one task - the long-description home (sprint current,
    and later `roadmap show`)."""
    print(f"{t['code']} - {t['title']}")
    print(f"  status: {t['status']}")
    print(f"  effort: {effort_str(t)}")
    pos = t.get("sprint_order")
    if pos:
        print(f"  sprint: {pos} of {len(members)}, your order")
    blocked = t.get("blocked_by") or []
    if blocked:
        print(f"  blocked by: {', '.join(blocked)}")
    rel = (t.get("source") or {}).get("relative_path")
    if rel:
        print(f"  source: {rel}")
    summary = (t.get("summary") or "").strip()
    if summary:
        print(f"  summary: {summary}")
    desc = (t.get("description") or "").strip()
    if desc:
        print("  description:")
        for line in desc.splitlines():
            print(f"    {line}")


def sprint_current(args) -> int:
    """The sprint task(s) being worked on, in full detail."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    members = sprint_members(snap)
    if not members:
        print("no sprint set - nothing is current.")
        return 0
    current = [t for t in members if t["status"] == "in_progress"]
    if not current:
        print("no sprint task in progress right now.")
        serve, _, _ = next_pick(snap, members)
        if serve is not None:
            print(f"next up: {serve['code']} - start it with: roadmap set {serve['code']} in_progress")
        return 0
    for i, t in enumerate(current):
        if i:
            print()
        show_task_detail(t, members)
    return 0


def cmd_sprint(args) -> int:
    action = getattr(args, "sprint_action", None)
    if action == "set":
        return sprint_set(args)
    if action == "clear":
        return sprint_clear(args)
    if action == "move":
        return sprint_move(args)
    if action == "list":
        return sprint_list(args)
    if action == "current":
        return sprint_current(args)
    if action == "next":
        return sprint_next(args)
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    return sprint_view(snapshot(out_path))


def cmd_show(args) -> int:
    """Full detail for any task (m5.3) - same renderer as `sprint current`."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    snap = snapshot(out_path)
    by_code = task_table(snap)
    t = by_code.get(args.code) or by_code.get(args.code.upper())
    if t is None:
        raise die(f"no task {args.code} on the roadmap")
    show_task_detail(t, sprint_members(snap))
    return 0


def cmd_sync(args) -> int:
    try:
        proc = subprocess.run(["systemctl", "--user", "start", "--no-block", "roadmap-sync.service"],
                              capture_output=True, text=True, timeout=SYSTEMCTL_TIMEOUT)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        print(f"could not start the service from this shell: {type(exc).__name__}")
        return 1
    if proc.returncode != 0:
        print("could not start the service from this shell:", (proc.stderr or "").strip())
        return 1
    print("sync started - the dashboard updates within a minute")
    return 0


def cmd_log(args) -> int:
    if not CHAT_LOG.is_file():
        print(f"no chat-ops log yet ({CHAT_LOG})")
        return 0
    lines = CHAT_LOG.read_text(errors="replace").splitlines()
    for line in lines[-args.lines:]:
        print(line)
    return 0


def cmd_receipts(args) -> int:
    receipts_dir = INBOX / "receipts"
    files = sorted(receipts_dir.glob("*.receipt.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        print(f"no receipts yet ({receipts_dir})")
        return 0
    for path in files[:args.count]:
        r = json.loads(path.read_text())
        before = (r.get("before") or {}).get("status") or "-"
        after = (r.get("after") or {}).get("status") or "-"
        when = (r.get("finished_at") or r.get("started_at") or "")[:16].replace("T", " ")
        detail = f" [{r['reason_code']}]" if r.get("reason_code") else ""
        print(f"{when}  {str(r.get('outcome')):<12} {str(r.get('operation_id')):<20} {r.get('source_path')}  {before} -> {after}{detail}")
    return 0


def _human_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{int(n)} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def _progress_enabled() -> bool:
    # the bar is a terminal nicety: real TTY, or forced in tests. Anything
    # piped/headless gets plain milestone lines instead of carriage returns.
    if os.environ.get("ROADMAP_NO_PROGRESS"):
        return False
    return sys.stdout.isatty() or bool(os.environ.get("ROADMAP_PROGRESS_FORCE"))


def _draw_bar(done_bytes: int, total_bytes: int, done_files: int, total_files: int) -> None:
    width = 28
    frac = max(0.0, min(1.0, done_bytes / total_bytes)) if total_bytes else 0.0
    filled = int(width * frac)
    bar = "#" * filled + "-" * (width - filled)
    sys.stdout.write(
        f"\r  [{bar}] {int(frac * 100):3d}%  "
        f"{_human_bytes(done_bytes)}/{_human_bytes(total_bytes)}  "
        f"{done_files}/{total_files} files   ")
    sys.stdout.flush()


def _dir_stats(path: Path) -> tuple:
    count = total = 0
    for entry in path.rglob("*"):
        if entry.is_file():
            count += 1
            try:
                total += entry.stat().st_size
            except OSError:
                pass
    return count, total


def cmd_update(args) -> int:
    print("checking the release channel for updates...")
    proc = subprocess.run(["rclone", "cat", f"{RELEASES_REMOTE}/LATEST"], capture_output=True, text=True)
    if proc.returncode == 0 and proc.stdout.strip():
        name = proc.stdout.strip().splitlines()[0].strip()
    else:
        print("no LATEST pointer - picking the newest release folder by name")
        proc = subprocess.run(["rclone", "lsd", RELEASES_REMOTE], capture_output=True, text=True)
        if proc.returncode != 0:
            raise die("rclone cannot reach the releases channel - is gdrive configured?")
        names = [line.split()[-1] for line in proc.stdout.splitlines() if line.split()]
        if not names:
            raise die("no releases found on the channel")
        name = sorted(names)[-1]
    dest = RELEASES_LOCAL / name

    # measure first so the bar is determinate: one cheap `rclone size` call,
    # then the copy runs in the background while we watch the bytes land.
    total_files = total_bytes = 0
    size = subprocess.run(["rclone", "size", "--json", f"{RELEASES_REMOTE}/{name}"],
                          capture_output=True, text=True)
    if size.returncode == 0:
        try:
            info = json.loads(size.stdout)
            total_files, total_bytes = int(info.get("count", 0)), int(info.get("bytes", 0))
        except (ValueError, TypeError):
            pass
    show_bar = _progress_enabled() and total_bytes > 0
    if total_files:
        print(f"pulling release {name} ({total_files} files, {_human_bytes(total_bytes)}) -> {dest}")
    else:
        print(f"pulling release {name} -> {dest}")
    dest.mkdir(parents=True, exist_ok=True)

    copy = subprocess.Popen(["rclone", "copy", f"{RELEASES_REMOTE}/{name}", str(dest)])
    if show_bar:
        _draw_bar(0, total_bytes, 0, total_files)
        while copy.poll() is None:
            done_files, done_bytes = _dir_stats(dest)
            _draw_bar(min(done_bytes, total_bytes), total_bytes,
                      min(done_files, total_files), total_files)
            time.sleep(0.2)
    rc = copy.wait()
    if rc != 0:
        raise die(f"rclone copy failed pulling {name} (exit {rc}) - check the network and gdrive config")
    if show_bar:
        _draw_bar(total_bytes, total_bytes, total_files, total_files)
        sys.stdout.write("\n")
    # flush before the installer handoff so piped stdout keeps line order
    print(f"download complete ({total_files} files)" if total_files else "download complete", flush=True)
    print("installing (you may press d at the prompt to review the diffs first)", flush=True)
    proc = subprocess.run(["bash", str(dest / "install.sh")])
    return proc.returncode


def cmd_version(args) -> int:
    print(f"roadmap {CLI_VERSION} ({RELEASE_NAME})")
    print(f"pipeline: {LIB}")
    print(f"parser:   {'present' if PARSER.is_file() else 'MISSING'} ({PARSER})")
    return 0



def cmd_apply(args):
    import roadmap_pipeline
    import sys
    old_argv = sys.argv[:]
    sys.argv = ["roadmap_pipeline"]
    if getattr(args, 'pull', False): sys.argv.append("--pull")
    if getattr(args, 'verify', False): sys.argv.append("--verify")
    if getattr(args, 'dry_run', False): sys.argv.append("--dry-run")
    if getattr(args, 'yes', False): sys.argv.append("--yes")
    if getattr(args, 'verbose', False): sys.argv.append("-v")
    try:
        roadmap_pipeline.main()
    finally:
        sys.argv = old_argv
    return 0

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="roadmap", description=__doc__.splitlines()[0],
                                epilog="Every write shows the exact colored git diff and waits for your y. Nothing writes without it.")
    p.add_argument("--version", action="store_true", help="print the CLI version and pipeline paths")
    sub = p.add_subparsers(dest="command")

    sp = sub.add_parser("set", help="flip a task's status (aliases: done, wip, todo)")
    sp.add_argument("code"); sp.add_argument("status")
    sp.add_argument("--summary", default=None,
                    help="also set the short description (summary field) in the same run")
    sp.set_defaults(func=cmd_set)

    sp = sub.add_parser("add", help="add a new task (lands at the end of the file)")
    sp.add_argument("code")
    sp.add_argument("--file", required=True, help="source path relative to the root, e.g. ragenodes.agentsdir/ACTIVE_ROADMAP.md")
    sp.add_argument("--title", required=True)
    sp.add_argument("--effort", type=float, required=True, help="effort value on a 0-10 scale")
    sp.add_argument("--status", default="pending")
    sp.add_argument("--desc", default=None, help="single-line description")
    sp.set_defaults(func=cmd_add)

    sp = sub.add_parser("show", help="full detail for one task (status, effort, full description)")
    sp.add_argument("code"); sp.set_defaults(func=cmd_show)

    sp = sub.add_parser("edit", help="edit a task field (description by default)")
    sp.add_argument("code"); sp.add_argument("mode", choices=["append", "replace", "clear"])
    sp.add_argument("text", nargs="?", default="")
    sp.add_argument("--field", default="description",
                    choices=["description", "summary", "sprint", "blocked_by"])
    sp.set_defaults(func=cmd_edit)

    sp = sub.add_parser("delete", help="remove a task (loud warning; receipt keeps the block)")
    sp.add_argument("code"); sp.set_defaults(func=cmd_delete)

    sp = sub.add_parser("status", help="live picture: counts, in-progress work, sync health")
    sp.set_defaults(func=cmd_status)


    sp = sub.add_parser("sprint", help="sprint state, membership and your work order")
    sp.set_defaults(func=cmd_sprint, sprint_action=None)
    ssub = sp.add_subparsers(dest="sprint_action")
    s = ssub.add_parser("set", help="set membership AND work order (listed order = work order)")
    s.add_argument("codes", nargs="+")
    s.add_argument("--add", action="store_true", help="append codes at the end instead of replacing the set")
    s.set_defaults(func=cmd_sprint)
    s = ssub.add_parser("clear", help="remove all sprint membership (the window marker stays)")
    s.set_defaults(func=cmd_sprint)
    s = ssub.add_parser("list", help="sprint tasks only, in your order")
    s.set_defaults(func=cmd_sprint)
    s = ssub.add_parser("current", help="the sprint task you are working on, in full detail")
    s.set_defaults(func=cmd_sprint)
    s = ssub.add_parser("next", help="next task on the sprint only (global next: `roadmap next`)")
    s.add_argument("--all", action="store_true", help="list the sprint's upcoming order with annotations")
    s.set_defaults(func=cmd_sprint)
    s = ssub.add_parser("move", help="move a sprint task to position N")
    s.add_argument("code"); s.add_argument("--to", type=int, required=True)
    s.set_defaults(func=cmd_sprint)


    sp = sub.add_parser("next", help="the one task to work on next (your sprint order; blockers auto-bump)")
    sp.add_argument("--all", action="store_true", help="list the full upcoming order with bump annotations")
    sp.set_defaults(func=cmd_next)


    sp = sub.add_parser("list", help="every task with a short description; current sprint in its own area")
    sp.add_argument("--completed", action="store_true", help="show completed tasks")
    sp.add_argument("--in-progress", action="store_true", help="show in-progress tasks")
    sp.add_argument("--pending", action="store_true", help="show pending tasks")
    sp.add_argument("--file", default=None, help="only files whose path contains this text (case-insensitive)")
    sp.add_argument("--desc", action="store_true", help="also print each task's description")
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("sync", help="run the sync right now (dashboard updates within a minute)")
    sp.set_defaults(func=cmd_sync)

    sp = sub.add_parser("log", help="what the chat-approved ops did lately")
    sp.add_argument("--lines", type=int, default=40); sp.set_defaults(func=cmd_log)

    sp = sub.add_parser("receipts", help="the last write receipts (every attempt leaves exactly one)")
    sp.add_argument("--count", type=int, default=10); sp.set_defaults(func=cmd_receipts)

    sp = sub.add_parser("update", help="pull the latest release from the channel and install it")
    sp.set_defaults(func=cmd_update)

    sp = sub.add_parser("version", help="print the CLI version and pipeline paths")
    sp.set_defaults(func=cmd_version)

    # -- apply --
    ap_parser = sub.add_parser("apply", help="unified roadmap apply command")
    ap_parser.add_argument("--pull", action="store_true")
    ap_parser.add_argument("--verify", action="store_true")
    ap_parser.add_argument("--dry-run", action="store_true")
    ap_parser.add_argument("--yes", action="store_true")
    ap_parser.add_argument("-v", "--verbose", action="store_true")
    ap_parser.add_argument("--root", default=None, help="override the root directory")
    ap_parser.set_defaults(func=cmd_apply)
    return p


def main() -> int:
    args = build_parser().parse_args()
    if args.version:
        return cmd_version(args)
    if not getattr(args, "func", None):
        build_parser().print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

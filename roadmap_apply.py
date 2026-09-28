#!/usr/bin/env python3
"""Guarded roadmap writes, milestone M2: the local applier.

The only component allowed to write roadmap Markdown. It consumes approved
operation + approval pairs from write-inbox/approved/, revalidates every
pin against live bytes, backs up the source, applies one bounded semantic
edit atomically, re-parses, and rolls back from the backup on any post-write
failure. Every attempt ends in exactly one append-only receipt.

Outcomes: applied | conflicted (source drifted; needs a fresh proposal) |
quarantined (invalid, expired, replayed or policy-violating) | rolled_back.

Exit codes: 0 = everything applied (or inbox empty), 2 = at least one
conflict, 3 = at least one quarantine or rollback.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import roadmap_write as rw
    import roadmap_review as rv
except ImportError:  # loaded standalone via importlib in tests
    import importlib.util

    _here = Path(__file__).resolve().parent
    for _name in ("roadmap_write", "roadmap_review"):
        _spec = importlib.util.spec_from_file_location(_name, _here / f"{_name}.py")
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules[_name] = _mod
        _spec.loader.exec_module(_mod)
    rw = sys.modules["roadmap_write"]
    rv = sys.modules["roadmap_review"]

RECEIPT_KIND = "receipt"
OUTCOMES = ("applied", "conflicted", "quarantined", "rolled_back")
CONFLICT_CODES = frozenset({
    "SOURCE_HASH_MISMATCH",
    "TASK_FINGERPRINT_MISMATCH",
    "STABLE_ID_MISMATCH",
    "FROM_STATUS_MISMATCH",
    "TASK_NOT_FOUND",
    "DUPLICATE_TASK",
    "SOURCE_PATH_MISMATCH",
    "TASK_EXISTS",
    "SOURCE_NOT_FOUND",
})
BACKUP_KEEP = 50
TEST_TIMEOUT_SECONDS = 180


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    """Temp file in the same directory, fsync, os.replace, directory fsync."""
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
        fsync_dir(path.parent)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def write_json_atomic(path: Path, payload: dict) -> None:
    if path.exists():
        raise rw.OperationError(f"refusing to overwrite existing record {path}", code="REPLAYED_OPERATION")
    write_bytes_atomic(path, (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"))


class ApplyLock:
    """One applier at a time per inbox."""

    def __init__(self, inbox: Path):
        self.path = inbox / ".apply.lock"
        self.handle = None

    def __enter__(self):
        self.handle = open(self.path, "a")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.handle.close()
            raise rw.OperationError("another applier holds the inbox lock", code="ALREADY_RUNNING") from exc
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


def make_backup(source: Path, backups_dir: Path, raw: bytes) -> Path:
    backups_dir.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(raw).hexdigest()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = backups_dir / f"{stamp}_{sha[:12]}_{source.name}"
    write_bytes_atomic(dest, raw)
    if hashlib.sha256(dest.read_bytes()).hexdigest() != sha:
        raise rw.OperationError(f"backup checksum mismatch for {dest}", code="BACKUP_FAILED")
    backups = sorted(backups_dir.glob("*_*_*"))
    for old in backups[:-BACKUP_KEEP]:
        old.unlink()
    return dest


def rollback(source: Path, backup: Path, expected_sha: str) -> str:
    """Restore the exact prior bytes and prove it."""
    write_bytes_atomic(source, backup.read_bytes())
    restored = hashlib.sha256(source.read_bytes()).hexdigest()
    if restored != expected_sha:
        return f"ROLLBACK FAILED: restored sha {restored[:12]}... != original {expected_sha[:12]}... - restore {backup} manually NOW"
    return f"restored byte-identical source from {backup.name}"


def run_tests(tests_dir: Path) -> tuple[bool, str]:
    proc = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(tests_dir), "-p", "test_*.py"],
        capture_output=True, text=True, timeout=TEST_TIMEOUT_SECONDS,
    )
    output = (proc.stdout + proc.stderr).strip()
    return proc.returncode == 0, output[-2000:]


def verify_after_write(mod, root: Path, path: Path, before_tasks: list[dict], task: dict, to_status: str) -> None:
    """Post-write proof on the real file: intended transition, nothing else."""
    _source, after_tasks = mod.parse_roadmap(path, root)
    if len(after_tasks) != len(before_tasks):
        raise rw.OperationError(
            f"task count changed: {len(before_tasks)} -> {len(after_tasks)}", code="POST_WRITE_MISMATCH"
        )
    target = next((t for t in after_tasks if t["id"] == task["id"]), None)
    if target is None:
        raise rw.OperationError("target task identity lost after write", code="POST_WRITE_MISMATCH")
    if target["status"] != to_status:
        raise rw.OperationError(
            f"post-write status is {target['status']}, expected {to_status}", code="POST_WRITE_MISMATCH"
        )
    before_blocks = {t["id"]: t["source"]["block_sha256"] for t in before_tasks if t["id"] != task["id"]}
    after_blocks = {t["id"]: t["source"]["block_sha256"] for t in after_tasks if t["id"] != task["id"]}
    if before_blocks != after_blocks:
        raise rw.OperationError("unrelated task blocks changed", code="POST_WRITE_MISMATCH")


def verify_add_after_write(mod, root: Path, path: Path, before_tasks: list[dict], code: str,
                           to_status: str, add: dict) -> dict:
    """Post-write proof for add_task: exactly one new task, nothing else moved."""
    _source, after_tasks = mod.parse_roadmap(path, root)
    if len(after_tasks) != len(before_tasks) + 1:
        raise rw.OperationError(
            f"task count delta is {len(after_tasks) - len(before_tasks)}, expected +1", code="POST_WRITE_MISMATCH"
        )
    before_ids = {t["id"] for t in before_tasks}
    added = [t for t in after_tasks if t["id"] not in before_ids]
    if len(added) != 1 or added[0]["code"] != code:
        raise rw.OperationError(f"expected exactly one new task {code}", code="POST_WRITE_MISMATCH")
    task = added[0]
    if task["status"] != to_status:
        raise rw.OperationError(
            f"post-write status is {task['status']}, expected {to_status}", code="POST_WRITE_MISMATCH"
        )
    before_blocks = {t["id"]: t["source"]["block_sha256"] for t in before_tasks}
    after_blocks = {t["id"]: t["source"]["block_sha256"] for t in after_tasks if t["id"] in before_ids}
    if before_blocks != after_blocks:
        raise rw.OperationError("unrelated task blocks changed", code="POST_WRITE_MISMATCH")
    return task


def verify_edit_after_write(mod, root: Path, path: Path, before_tasks: list[dict], task: dict,
                            edit: dict) -> dict:
    """Post-write proof: the edited task now carries exactly the target description,
    its status did not move, and no other task changed."""
    _source, after_tasks = mod.parse_roadmap(path, root)
    if len(after_tasks) != len(before_tasks):
        raise rw.OperationError(
            f"task count changed after write: {len(before_tasks)} -> {len(after_tasks)}",
            code="POST_WRITE_DELTA",
        )
    after_by_id = {t["id"]: t for t in after_tasks}
    edited = after_by_id.get(task["id"])
    if edited is None:
        raise rw.OperationError("edited task missing after write", code="POST_WRITE_DELTA")
    field = edit.get("field", "description")
    if field == "description":
        after_value = edited["description"]
    else:
        after_value = ((edited.get("fields") or {}).get(field) or "").strip() or None
    if edit.get("mode") == "clear":
        if after_value is not None:
            raise rw.OperationError(
                f"{field} field still present after clear: {after_value!r}",
                code="POST_WRITE_DELTA",
            )
    elif after_value != edit["after"]:
        raise rw.OperationError(
            f"{field} did not land: got {after_value!r}",
            code="POST_WRITE_DELTA",
        )
    if edited["status"] != task["status"]:
        raise rw.OperationError(
            f"status moved during edit: {task['status']} -> {edited['status']}",
            code="POST_WRITE_DELTA",
        )
    before_others = {t["id"]: t["source"]["block_sha256"] for t in before_tasks if t["id"] != task["id"]}
    after_others = {i: t["source"]["block_sha256"] for i, t in after_by_id.items() if i != task["id"]}
    if before_others != after_others:
        raise rw.OperationError("unrelated task blocks changed after write", code="POST_WRITE_DELTA")
    return edited


def verify_delete_after_write(mod, root: Path, path: Path, before_tasks: list[dict], code: str) -> None:
    """Post-write proof for a deletion: the task is gone, nothing else moved."""
    _source, after_tasks = mod.parse_roadmap(path, root)
    if len(after_tasks) != len(before_tasks) - 1:
        raise rw.OperationError(
            f"post-write task count delta is {len(after_tasks) - len(before_tasks)}, expected -1",
            code="POST_WRITE_DELTA",
        )
    after_codes = [t["code"] for t in after_tasks]
    if code in after_codes:
        raise rw.OperationError(f"post-write re-parse still finds {code!r}", code="POST_WRITE_DELTA")
    removed = [t for t in before_tasks if t["code"] not in set(after_codes)]
    if len(removed) != 1 or removed[0]["code"] != code:
        raise rw.OperationError(
            f"unexpected removal set: {[t['code'] for t in removed]}", code="POST_WRITE_DELTA")
    before_blocks = {t["id"]: t["source"]["block_sha256"] for t in before_tasks}
    after_blocks = {t["id"]: t["source"]["block_sha256"] for t in after_tasks if t["id"] in before_blocks}
    if {k: v for k, v in before_blocks.items() if k in after_blocks} != after_blocks:
        raise rw.OperationError("unrelated task blocks changed by the delete", code="POST_WRITE_DELTA")


def check_pins(operation: dict, path: Path, task: dict, raw: bytes) -> None:
    target = operation["target"]
    live_sha = hashlib.sha256(raw).hexdigest()
    if live_sha != target["expected_source_sha256"]:
        raise rw.OperationError(
            f"source file changed since proposal (expected {target['expected_source_sha256'][:12]}..., live {live_sha[:12]}...)",
            code="SOURCE_HASH_MISMATCH",
        )
    if task["source"]["block_sha256"] != target["expected_task_fingerprint"]:
        raise rw.OperationError("task block changed since proposal", code="TASK_FINGERPRINT_MISMATCH")
    if "stable_id" in target and task["id"] != target["stable_id"]:
        raise rw.OperationError("task identity drifted since proposal", code="STABLE_ID_MISMATCH")
    if task["status"] != operation["change"]["from"]:
        raise rw.OperationError(
            f"live status is {task['status']}, operation expects {operation['change']['from']}",
            code="FROM_STATUS_MISMATCH",
        )


def load_approval(inbox: Path, operation: dict) -> Path:
    approval_path = inbox / "approved" / f"{operation['operation_id']}.approval.json"
    if not approval_path.is_file():
        raise rw.OperationError(
            f"no approval record for {operation['operation_id']}; file presence is not approval",
            code="APPROVAL_MISSING",
        )
    try:
        record = json.loads(approval_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise rw.OperationError(f"approval record is not valid JSON: {exc}", code="APPROVAL_MISMATCH") from exc
    rw.validate_approval_record(record, operation)
    return approval_path


def apply_one(op_path: Path, inbox: Path, root: Path, mod, tests_dir: Path | None = None) -> dict:
    """One approved operation, one attempt, one terminal receipt."""
    receipts_dir = inbox / "receipts"
    quarantine_dir = inbox / "quarantine"
    receipts_dir.mkdir(parents=True, exist_ok=True)
    quarantine_dir.mkdir(parents=True, exist_ok=True)
    started = utc_now()
    receipt: dict = {
        "schema_version": rw.SCHEMA_VERSION,
        "kind": RECEIPT_KIND,
        "actor": "instinct-applier",
        "operation_id": op_path.name.removesuffix(".json"),
        "operation_hash": None,
        "outcome": None,
        "reason_code": None,
        "detail": None,
        "started_at": started,
        "finished_at": None,
        "source_path": None,
        "backup_path": None,
        "before": None,
        "after": None,
        "tests": {"ran": False, "ok": None, "output_tail": None},
    }
    approval_path: Path | None = None
    outcome = "quarantined"  # fail closed until proven otherwise
    try:
        operation = rw.load_operation(op_path)
        receipt["operation_id"] = operation["operation_id"]
        receipt["operation_hash"] = rw.operation_hash(operation)
        receipt["source_path"] = operation["target"]["source_path"]
        if (receipts_dir / f"{operation['operation_id']}.receipt.json").exists():
            raise rw.OperationError("a terminal receipt already exists for this operation", code="REPLAYED_OPERATION")
        rw.check_expiry(operation)
        rw.check_source_path(operation["target"]["source_path"])
        approval_path = load_approval(inbox, operation)

        is_add = operation["action"] == rw.ACTION_ADD_TASK
        is_del = operation["action"] == rw.ACTION_DELETE_TASK
        is_edit = operation["action"] == rw.ACTION_EDIT_TASK
        if is_add:
            relative = operation["target"]["source_path"]
            path = root / relative
            if not path.is_file():
                raise rw.OperationError(f"source file not found under {root}: {relative}", code="SOURCE_NOT_FOUND")
            if rw.find_task(mod, root, operation["target"]["task_id"]):
                raise rw.OperationError(
                    f"task code {operation['target']['task_id']!r} already exists under {root}", code="TASK_EXISTS"
                )
            raw = path.read_bytes()
            live_sha = hashlib.sha256(raw).hexdigest()
            if live_sha != operation["target"]["expected_source_sha256"]:
                raise rw.OperationError(
                    f"source file changed since proposal (expected {operation['target']['expected_source_sha256'][:12]}..., live {live_sha[:12]}...)",
                    code="SOURCE_HASH_MISMATCH",
                )
            receipt["before"] = {
                "file_sha256": operation["target"]["expected_source_sha256"],
                "task_fingerprint": None,
                "status": None,
            }
        else:
            path, task = rw.resolve_unique_task(mod, root, operation)
            raw = path.read_bytes()
            check_pins(operation, path, task, raw)
            receipt["before"] = {
                "file_sha256": operation["target"]["expected_source_sha256"],
                "task_fingerprint": operation["target"]["expected_task_fingerprint"],
                "status": operation["change"]["from"],
            }
            if is_edit:
                receipt["before"]["description"] = operation["edit"]["before"]

        backup = make_backup(path, inbox / "backups", raw)
        receipt["backup_path"] = backup.name

        to_status = operation["change"]["to"]
        old_text = raw.decode("utf-8-sig", errors="replace")
        if is_add:
            new_text = rv.render_add_task(old_text, operation["target"]["task_id"], operation["add"], to_status)
            ok, detail = rv.verify_render_add(mod, root, operation["target"]["source_path"], old_text, new_text,
                                              operation["target"]["task_id"], to_status, operation["add"])
        elif is_del:
            new_text = rv.render_delete_task(old_text, task)
            ok, detail = rv.verify_render_delete(mod, root, operation["target"]["source_path"], old_text,
                                                 new_text, operation["target"]["task_id"])
        elif is_edit:
            new_text = rv.render_field_edit(old_text, task, mod, operation["edit"])
            ok, detail = rv.verify_render_edit(mod, root, operation["target"]["source_path"], old_text,
                                               new_text, operation["target"]["task_id"], operation["edit"])
        else:
            new_text = rv.render_status_edit(old_text, task, mod, to_status)
            ok, detail = rv.verify_render(mod, root, operation["target"]["source_path"], old_text, new_text, task, to_status)
        if not ok:
            raise rw.OperationError(f"render verification failed: {detail}", code="RENDER_FAILED")

        _pre_source, before_tasks = mod.parse_roadmap(path, root)
        write_bytes_atomic(path, new_text.encode("utf-8"))

        # Post-write gate: anything short of a clean proof restores the backup.
        try:
            if is_add:
                after_task = verify_add_after_write(mod, root, path, before_tasks,
                                                    operation["target"]["task_id"], to_status, operation["add"])
            elif is_del:
                verify_delete_after_write(mod, root, path, before_tasks, operation["target"]["task_id"])
            elif is_edit:
                verify_edit_after_write(mod, root, path, before_tasks, task, operation["edit"])
            else:
                verify_after_write(mod, root, path, before_tasks, task, to_status)
            if tests_dir is not None:
                tests_ok, tail = run_tests(tests_dir)
                receipt["tests"] = {"ran": True, "ok": tests_ok, "output_tail": tail}
                if not tests_ok:
                    raise rw.OperationError("unit tests failed after write", code="POST_WRITE_TESTS_FAILED")
        except rw.OperationError as exc:
            detail = rollback(path, backup, receipt["before"]["file_sha256"])
            receipt["outcome"] = "rolled_back"
            receipt["reason_code"] = exc.code
            receipt["detail"] = f"{exc}; {detail}"
            receipt["finished_at"] = utc_now()
            write_json_atomic(receipts_dir / f"{operation['operation_id']}.receipt.json", receipt)
            _settle(op_path, approval_path, receipts_dir)
            return receipt

        after_raw = path.read_bytes()
        if is_del:
            # the receipt is the restore path: keep the full removed block verbatim
            receipt["removed_block"] = operation["delete"]["removed_block"]
            receipt["after"] = {
                "file_sha256": hashlib.sha256(after_raw).hexdigest(),
                "task_fingerprint": None,
                "status": None,
            }
        elif is_edit:
            _post_source, after_tasks = mod.parse_roadmap(path, root)
            after_task = next(t for t in after_tasks if t["id"] == task["id"])
            # the receipt is the audit trail: before/after description text
            receipt["edit"] = operation["edit"]
            receipt["after"] = {
                "file_sha256": hashlib.sha256(after_raw).hexdigest(),
                "task_fingerprint": after_task["source"]["block_sha256"],
                "status": after_task["status"],
            }
        elif not is_add:
            _post_source, after_tasks = mod.parse_roadmap(path, root)
            after_task = next(t for t in after_tasks if t["id"] == task["id"])
            receipt["after"] = {
                "file_sha256": hashlib.sha256(after_raw).hexdigest(),
                "task_fingerprint": after_task["source"]["block_sha256"],
                "status": after_task["status"],
            }
        else:
            receipt["after"] = {
                "file_sha256": hashlib.sha256(after_raw).hexdigest(),
                "task_fingerprint": after_task["source"]["block_sha256"],
                "status": after_task["status"],
            }
        outcome = "applied"
        if is_add:
            receipt["detail"] = f"added {operation['target']['task_id']} ({operation['add']['title']}) as {to_status}"
        elif is_edit:
            receipt["detail"] = (f"edited {operation['target']['task_id']} {operation['edit']['field']} "
                                 f"({operation['edit']['mode']}); before/after text kept in this receipt")
        elif is_del:
            receipt["detail"] = (f"deleted {operation['target']['task_id']} ({operation['delete']['title']}); "
                                 f"full block kept in this receipt, byte backup {receipt['backup_path']}")
        else:
            receipt["detail"] = f"{operation['change']['from']} -> {to_status} applied to {operation['target']['task_id']}"
    except rw.OperationError as exc:
        receipt["reason_code"] = exc.code
        receipt["detail"] = str(exc)
        outcome = "conflicted" if exc.code in CONFLICT_CODES else "quarantined"

    receipt["outcome"] = outcome
    receipt["finished_at"] = utc_now()
    receipt_path = receipts_dir / f"{receipt['operation_id']}.receipt.json"
    if not receipt_path.exists():
        # Append-only: a replayed operation keeps its original terminal receipt.
        write_json_atomic(receipt_path, receipt)
    if outcome in ("conflicted", "quarantined"):
        _settle(op_path, approval_path, quarantine_dir)
    else:
        _settle(op_path, approval_path, receipts_dir)
    return receipt


def _settle(op_path: Path, approval_path: Path | None, dest_dir: Path) -> None:
    """Move the operation (and its approval) out of approved/ - never copy."""
    if op_path.exists():
        os.replace(op_path, dest_dir / op_path.name)
    if approval_path is not None and approval_path.exists():
        os.replace(approval_path, dest_dir / approval_path.name)


def apply_all(inbox: Path, root: Path, parser_path: Path | None = None, tests_dir: Path | None = None) -> list[dict]:
    mod = rw.load_parser(parser_path)
    approved = sorted(
        p for p in (inbox / "approved").glob("*.json")
        if not p.name.endswith(".approval.json")
    ) if (inbox / "approved").is_dir() else []
    receipts = []
    with ApplyLock(inbox):
        for op_path in approved:
            receipts.append(apply_one(op_path, inbox, root, mod, tests_dir))
    return receipts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inbox", type=Path, required=True, help="write-inbox directory")
    parser.add_argument("--root", type=Path, required=True, help="roadmap root containing the project dirs")
    parser.add_argument("--parser", type=Path, default=None,
                        help=f"path to roadmap_sync.py (default {rw.DEFAULT_PARSER_PATH})")
    parser.add_argument("--tests-dir", type=Path, default=None,
                        help="run unittest discovery here after each write; failure rolls back")
    args = parser.parse_args()
    try:
        receipts = apply_all(
            args.inbox.expanduser().resolve(), args.root.expanduser().resolve(), args.parser,
            args.tests_dir.expanduser().resolve() if args.tests_dir else None,
        )
    except rw.OperationError as exc:
        print(f"error [{exc.code}]: {exc}", file=sys.stderr)
        return 3
    if not receipts:
        print("nothing approved to apply")
        return 0
    worst = 0
    for receipt in receipts:
        print(f"{receipt['outcome'].upper():<11} {receipt['operation_id']}  {receipt['reason_code'] or ''}  {receipt['detail'] or ''}")
        if receipt["outcome"] in ("quarantined", "rolled_back"):
            worst = 3
        elif receipt["outcome"] == "conflicted":
            worst = max(worst, 2)
    return worst


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Guarded roadmap writes, milestone M1: the review command.

Shows exactly what an operation would change - current task, requested
transition, source excerpt, deterministic unified diff, and every
precondition check - without writing anything. Mario's review of this
output is the human gate; the applier (M2) does not exist yet.

Exit codes: 0 = every check passes, 2 = conflict (source drifted since the
proposal), 3 = invalid (schema, policy, expiry or transition failure).
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import roadmap_write as rw
except ImportError:  # loaded standalone via importlib in tests
    import importlib.util

    _spec = importlib.util.spec_from_file_location(
        "roadmap_write", Path(__file__).resolve().parent / "roadmap_write.py"
    )
    rw = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(rw)


class Check:
    def __init__(self, name: str, ok: bool, detail: str, fatal_class: str = "conflict"):
        self.name = name
        self.ok = ok
        self.detail = detail
        self.fatal_class = fatal_class  # "invalid" quarantines; "conflict" needs re-proposal


def render_status_edit(text: str, task: dict, mod, to_status: str) -> str:
    """Render the smallest semantic status edit. Pure function, no writes.

    Only two byte regions may change: the checkbox character on the task
    line (for completions) and the Status field line (replaced, or inserted
    directly after the task line when the task has no Status field).
    """
    lines = text.split("\n")
    start = task["source"]["line_start"] - 1
    end = task["source"]["line_end"]

    task_match = mod.TASK_RE.match(lines[start])
    if task_match is None:
        raise rw.OperationError("task line no longer matches the parser task pattern", code="RENDER_FAILED")

    checkbox = "x" if to_status == "completed" else " "
    lines[start] = lines[start][: task_match.start("check")] + checkbox + lines[start][task_match.end("check"):]

    status_text = rw.STATUS_RENDER[to_status]
    status_idx = None
    for i in range(start + 1, min(end, len(lines))):
        field_match = mod.FIELD_RE.match(lines[i])
        if field_match and mod.field_key(field_match.group("label")) == "status":
            status_idx = i
            break
    if status_idx is not None:
        import re

        lines[status_idx] = re.sub(
            r"(\*\*[^*\n]+\*\*\s*:\s*).*$",
            lambda m: m.group(1) + status_text,
            lines[status_idx],
        )
    else:
        indent = task_match.group("indent") + "  "
        bullet = lines[start][len(task_match.group("indent"))]
        lines.insert(start + 1, f"{indent}{bullet} **Status**: {status_text}")
    return "\n".join(lines)


def verify_render(mod, root: Path, relative: str, old_text: str, new_text: str, task: dict, to_status: str) -> tuple[bool, str]:
    """Re-parse the rendered file in a scratch tree and prove the edit is exact."""
    with tempfile.TemporaryDirectory(prefix="roadmap-review-") as tmp:
        scratch = Path(tmp)
        # Same relative path under both roots keeps parser task ids comparable.
        after_root, before_root = scratch / "after", scratch / "before"
        for base, text in ((after_root, new_text), (before_root, old_text)):
            dest = base / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(text.encode("utf-8"))
        try:
            _after_source, after_tasks = mod.parse_roadmap(after_root / relative, after_root)
            _before_source, before_tasks = mod.parse_roadmap(before_root / relative, before_root)
        except (OSError, UnicodeError, ValueError) as exc:
            return False, f"rendered file does not parse: {type(exc).__name__}: {exc}"
        if len(after_tasks) != len(before_tasks):
            return False, f"task count changed: {len(before_tasks)} -> {len(after_tasks)}"
        target = next((t for t in after_tasks if t["id"] == task["id"]), None)
        if target is None:
            return False, "target task identity lost after render"
        if target["status"] != to_status:
            return False, f"rendered status is {target['status']}, expected {to_status}"
        before_blocks = {t["id"]: t["source"]["block_sha256"] for t in before_tasks if t["id"] != task["id"]}
        after_blocks = {t["id"]: t["source"]["block_sha256"] for t in after_tasks if t["id"] != task["id"]}
        if before_blocks != after_blocks:
            return False, "unrelated task blocks changed"
    return True, "parser confirms the transition and zero unrelated task deltas"


CONVERSATION_ID_RE = re.compile(r"[0-9a-fA-F-]{32,36}")


def render_add_task(text: str, code: str, add: dict, to_status: str) -> str:
    """Append the new task block at the end of the file. Pure function."""
    block_lines = [
        f"* [{'x' if to_status == 'completed' else ' '}] **{code} - {add['title']}**",
    ]
    if add.get("description"):
        block_lines.append(f"  * **Description**: {add['description']}")
    if add.get("links"):
        rendered = ", ".join(f"[`{entry['text']}`]({entry['url']})" for entry in add["links"])
        block_lines.append(f"  * **Links**: {rendered}")
    if add.get("conversations"):
        rendered = ", ".join(
            f"[`Conv: {entry[:8]}`](conversation://{entry})"
            if CONVERSATION_ID_RE.fullmatch(entry) else entry
            for entry in add["conversations"]
        )
        block_lines.append(f"  * **Conversation**: {rendered}")
    effort = add["effort"]
    value = effort["value"]
    value_txt = str(int(value)) if float(value) == int(value) else str(value)
    scale = effort["scale"]
    scale_txt = str(int(scale)) if float(scale) == int(scale) else str(scale)
    block_lines.append(f"  * **Effort**: `[effort: {value_txt}/{scale_txt}]`")
    block_lines.append(f"  * **Status**: {rw.STATUS_RENDER[to_status]}")
    body = text[:-1] if text.endswith("\n") else text
    if not body.endswith("\n\n"):
        body += "\n"
    return body + "\n".join(block_lines) + "\n"


def verify_render_add(mod, root: Path, relative: str, old_text: str, new_text: str,
                      code: str, to_status: str, add: dict) -> tuple[bool, str]:
    """Re-parse the rendered file in a scratch tree and prove the add is exact."""
    with tempfile.TemporaryDirectory(prefix="roadmap-review-add-") as tmp:
        scratch = Path(tmp)
        after_root, before_root = scratch / "after", scratch / "before"
        for base, text in ((after_root, new_text), (before_root, old_text)):
            dest = base / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(text.encode("utf-8"))
        try:
            _as, after_tasks = mod.parse_roadmap(after_root / relative, after_root)
            _bs, before_tasks = mod.parse_roadmap(before_root / relative, before_root)
        except (OSError, UnicodeError, ValueError) as exc:
            return False, f"rendered file does not parse: {type(exc).__name__}: {exc}"
        if len(after_tasks) != len(before_tasks) + 1:
            return False, f"task count delta is {len(after_tasks) - len(before_tasks)}, expected +1"
        before_codes = {t["code"] for t in before_tasks}
        added = [t for t in after_tasks if t["code"] not in before_codes]
        if len(added) != 1 or added[0]["code"] != code:
            return False, f"expected exactly one new task {code}, got {[t['code'] for t in added]}"
        task = added[0]
        if task["status"] != to_status:
            return False, f"rendered status is {task['status']}, expected {to_status}"
        want_effort = {"value": float(add["effort"]["value"]), "scale": float(add["effort"]["scale"])}
        got_effort = {"value": float(task["effort"]["value"]), "scale": float(task["effort"]["scale"])}
        if got_effort != want_effort:
            return False, f"rendered effort is {task['effort']}, expected {add['effort']}"
        if add.get("description") and add["description"] not in task["description"]:
            return False, "rendered description does not carry the operation text"
        if add.get("links"):
            want_links = [(e["text"], e["url"]) for e in add["links"]]
            got_links = [(e["text"].strip("`"), e["url"]) for e in task["links"]]
            if not all(w in got_links for w in want_links):
                return False, f"rendered links are {task['links']}, expected {add['links']}"
        if add.get("conversations"):
            want_conv = {c for c in add["conversations"] if CONVERSATION_ID_RE.fullmatch(c)}
            if not want_conv.issubset(set(task["conversations"])):
                return False, f"rendered conversations are {task['conversations']}, expected {sorted(want_conv)}"
        before_blocks = {t["id"]: t["source"]["block_sha256"] for t in before_tasks}
        after_blocks = {t["id"]: t["source"]["block_sha256"] for t in after_tasks if t["id"] in before_blocks}
        if before_blocks != after_blocks:
            return False, "unrelated task blocks changed"
    return True, "parser confirms exactly one new task and zero unrelated deltas"


def render_delete_task(text: str, task: dict) -> str:
    """Remove exactly the task's block lines. Pure function."""
    lines = text.split("\n")
    start = task["source"]["line_start"] - 1
    end = task["source"]["line_end"]
    removed = lines[start:end]
    if not any("**" in line for line in removed):
        raise ValueError("refusing to delete: the pinned line range holds no task header")
    new_lines = lines[:start] + lines[end:]
    new_text = "\n".join(new_lines)
    while "\n\n\n" in new_text:
        new_text = new_text.replace("\n\n\n", "\n\n")
    return new_text


def verify_render_delete(mod, root: Path, relative: str, old_text: str, new_text: str,
                         code: str) -> tuple[bool, str]:
    """Re-parse the rendered file in a scratch tree and prove the deletion is exact."""
    with tempfile.TemporaryDirectory(prefix="roadmap-review-delete-") as tmp:
        scratch = Path(tmp)
        after_root, before_root = scratch / "after", scratch / "before"
        for base, text in ((after_root, new_text), (before_root, old_text)):
            dest = base / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(text.encode("utf-8"))
        try:
            _as, after_tasks = mod.parse_roadmap(after_root / relative, after_root)
            _bs, before_tasks = mod.parse_roadmap(before_root / relative, before_root)
        except (OSError, UnicodeError, ValueError) as exc:
            return False, f"rendered file does not parse: {type(exc).__name__}: {exc}"
        if len(after_tasks) != len(before_tasks) - 1:
            return False, f"task count delta is {len(after_tasks) - len(before_tasks)}, expected -1"
        after_codes = {t["code"] for t in after_tasks}
        removed = [t for t in before_tasks if t["code"] not in after_codes]
        if len(removed) != 1 or removed[0]["code"] != code:
            return False, f"expected exactly {code} removed, got {[t['code'] for t in removed]}"
        before_blocks = {t["id"]: t["source"]["block_sha256"] for t in before_tasks}
        after_blocks = {t["id"]: t["source"]["block_sha256"] for t in after_tasks if t["id"] in before_blocks}
        if {k: v for k, v in before_blocks.items() if k in after_blocks} != after_blocks:
            return False, "unrelated task blocks changed"
    return True, "parser confirms exactly one removed task and zero unrelated deltas"


def render_field_edit(text: str, task: dict, mod, edit: dict) -> str:
    """Render exactly one single-line field edit inside the task block. Pure.
    Byte regions that may change: the field line (replaced or, for mode clear,
    removed), or a new field line inserted directly after the task line when
    the task does not carry the field yet. A clear refuses a multiline field:
    continuation lines would reattach to the previous field."""
    field = edit["field"]
    label = rw.FIELD_LABELS[field]
    lines = text.split("\n")
    start = task["source"]["line_start"] - 1
    end = task["source"]["line_end"]
    field_idx = None
    for i in range(start + 1, min(end, len(lines))):
        field_match = mod.FIELD_RE.match(lines[i])
        if field_match and mod.field_key(field_match.group("label")) == field:
            field_idx = i
            break
    if edit["mode"] == "clear":
        if field_idx is None:
            raise rw.OperationError(f"task block has no {label} field to clear", code="RENDER_FAILED")
        following = lines[field_idx + 1] if field_idx + 1 < min(end, len(lines)) else ""
        if following.strip() and not mod.FIELD_RE.match(following) and not mod.TASK_RE.match(following):
            raise rw.OperationError(f"refusing to clear a multiline {label} field", code="RENDER_FAILED")
        del lines[field_idx]
    elif field_idx is not None:
        import re
        lines[field_idx] = re.sub(
            r"(\*\*[^*\n]+\*\*\s*:\s*).*$",
            lambda m: m.group(1) + edit["after"],
            lines[field_idx],
        )
    else:
        task_match = mod.TASK_RE.match(lines[start])
        if task_match is None:
            raise rw.OperationError("task line no longer matches the parser task pattern", code="RENDER_FAILED")
        indent = task_match.group("indent") + "  "
        bullet = lines[start][len(task_match.group("indent"))]
        lines.insert(start + 1, f"{indent}{bullet} **{label}**: {edit['after']}")
    return "\n".join(lines)


def render_description_edit(text: str, task: dict, mod, edit: dict) -> str:
    """Backwards-compatible wrapper: a description edit is a field edit."""
    return render_field_edit(text, task, mod, edit)


def verify_render_edit(mod, root: Path, relative: str, old_text: str, new_text: str,
                       code: str, edit: dict) -> tuple[bool, str]:
    """Re-parse the rendered file in a scratch tree and prove the edit is exact:
    same tasks, same statuses, only this task's description text changed."""
    with tempfile.TemporaryDirectory(prefix="roadmap-review-edit-") as tmp:
        scratch = Path(tmp)
        after_root, before_root = scratch / "after", scratch / "before"
        for base, text in ((after_root, new_text), (before_root, old_text)):
            dest = base / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(text.encode("utf-8"))
        try:
            _as, after_tasks = mod.parse_roadmap(after_root / relative, after_root)
            _bs, before_tasks = mod.parse_roadmap(before_root / relative, before_root)
        except (OSError, UnicodeError, ValueError) as exc:
            return False, f"rendered file does not parse: {type(exc).__name__}: {exc}"
        if len(after_tasks) != len(before_tasks):
            return False, f"task count changed: {len(before_tasks)} -> {len(after_tasks)}"
        before_by_id = {t["id"]: t for t in before_tasks}
        after_by_id = {t["id"]: t for t in after_tasks}
        if before_by_id.keys() != after_by_id.keys():
            return False, "task identities changed"
        edited = [t for t in after_tasks if t["code"] == code]
        if len(edited) != 1:
            return False, f"expected exactly one {code} after the edit, got {len(edited)}"
        edited = edited[0]
        prior = before_by_id[edited["id"]]
        field = edit.get("field", "description")
        if field == "description":
            after_value = edited["description"]
            prior_value = prior["description"]
        else:
            after_value = ((edited.get("fields") or {}).get(field) or "").strip() or None
            prior_value = ((prior.get("fields") or {}).get(field) or "").strip() or None
        if edit.get("mode") == "clear":
            if after_value is not None:
                return False, f"{field} field still present after clear: {after_value!r}"
        else:
            if after_value != edit["after"]:
                return False, f"{field} did not land: got {after_value!r}"
            if prior_value == edit["after"]:
                return False, f"the {field} field was already the target text (no-op)"
        if edited["status"] != prior["status"]:
            return False, f"status moved: {prior['status']} -> {edited['status']}"
        others_before = {i: t["source"]["block_sha256"] for i, t in before_by_id.items() if i != edited["id"]}
        others_after = {i: t["source"]["block_sha256"] for i, t in after_by_id.items() if i != edited["id"]}
        if others_before != others_after:
            return False, "unrelated task blocks changed"
    return True, f"parser confirms exactly one edited {edit.get('field', 'description')} field and zero unrelated deltas"


def review_delete(operation: dict, operation_path: Path, root: Path, parser_path: Path | None = None) -> int:
    """Review a delete: pins, the exact block going away, and the DELETE warning."""
    target = operation["target"]
    change = operation["change"]
    print(f"operation_id: {operation['operation_id']}")
    print(f"hash:         {rw.operation_hash(operation)}")
    print(f"actor/action: {operation['actor']} / {operation['action']}")
    print(f"created:      {operation['created_at']}  expires: {operation['expires_at']}")
    print(f"reason:       {operation['reason']}")
    print(f"target:       {target['task_id']} in {target['source_path']}")
    print(f"change:       {change['from']} -> REMOVED")
    print("-" * 72)
    print("*** DELETE WARNING ***")
    print(f"This permanently removes {target['task_id']} from the roadmap file.")
    print("There is no undo inside the roadmap itself. Recovery is practical, not")
    print("automatic: the full removed block is kept verbatim in this operation's")
    print("receipt, and a byte-for-byte backup of the whole file lands in")
    print("~/roadmap-write-inbox/backups before anything is written.")
    print("-" * 72)

    checks: list[Check] = []
    try:
        rw.check_expiry(operation)
        checks.append(Check("expiry", True, f"valid until {operation['expires_at']}", "invalid"))
    except rw.ExpiredError as exc:
        checks.append(Check("expiry", False, str(exc), "invalid"))
    try:
        rw.check_source_path(target["source_path"])
        checks.append(Check("path policy", True, "inside an allowed current project root, no archived components", "invalid"))
    except rw.PolicyError as exc:
        checks.append(Check("path policy", False, str(exc), "invalid"))
    invalid = [c for c in checks if not c.ok]
    for check in checks:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    if invalid:
        print("-" * 72)
        print("VERDICT: INVALID - quarantine this operation; it must not reach the applier.")
        return 3

    mod = rw.load_parser(parser_path)
    try:
        path, task = rw.resolve_unique_task(mod, root, operation)
        checks.append(Check("task resolution", True, f"exactly one match at {path}"))
    except rw.OperationError as exc:
        print(f"  [FAIL] task resolution: {exc}")
        print("-" * 72)
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2

    raw = path.read_bytes()
    live_file_sha = rw.hashlib.sha256(raw).hexdigest()
    live_text = raw.decode("utf-8-sig", errors="replace")
    checks.append(Check(
        "source sha256",
        live_file_sha == target["expected_source_sha256"],
        "file bytes unchanged since proposal" if live_file_sha == target["expected_source_sha256"]
        else f"file changed: expected {target['expected_source_sha256'][:12]}..., live {live_file_sha[:12]}...",
    ))
    live_block = task["source"]["block_sha256"]
    checks.append(Check(
        "task fingerprint",
        live_block == target["expected_task_fingerprint"],
        "task block unchanged since proposal" if live_block == target["expected_task_fingerprint"]
        else f"task block changed: expected {target['expected_task_fingerprint'][:12]}..., live {live_block[:12]}...",
    ))
    if "stable_id" in target:
        checks.append(Check(
            "stable id",
            task["id"] == target["stable_id"],
            "parser identity matches" if task["id"] == target["stable_id"]
            else f"identity drifted: expected {target['stable_id']}, live {task['id']}",
        ))
    checks.append(Check(
        "from-status",
        task["status"] == change["from"],
        f"live status is {task['status']}" if task["status"] == change["from"]
        else f"live status is {task['status']}, operation expects {change['from']}",
    ))
    for check in checks[2:]:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    conflicts = [c for c in checks if not c.ok]

    print("-" * 72)
    print(f"Block being removed ({target['source_path']}):")
    for line in operation["delete"]["removed_block"].split("\n"):
        print(f"  - {line}")
    print("-" * 72)
    try:
        new_text = render_delete_task(live_text, task)
        ok, detail = verify_render_delete(mod, root, target["source_path"], live_text, new_text,
                                          target["task_id"])
    except ValueError as exc:
        ok, detail = False, str(exc)
        new_text = live_text
    print(f"  [{'PASS' if ok else 'FAIL'}] render verification: {detail}")
    print("-" * 72)
    print("Proposed diff (preview only - nothing has been written):")
    print_proposed_diff(target["source_path"], live_text, new_text)
    print("-" * 72)
    if conflicts or not ok:
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2
    print("VERDICT: APPLICABLE - this removal is exactly what approval would authorize.")
    return 0


def review_edit(operation: dict, operation_path: Path, root: Path, parser_path: Path | None = None) -> int:
    """Review a description edit: pins, exact before/after text, and the diff."""
    target = operation["target"]
    change = operation["change"]
    edit = operation["edit"]
    print(f"operation_id: {operation['operation_id']}")
    print(f"hash:         {rw.operation_hash(operation)}")
    print(f"actor/action: {operation['actor']} / {operation['action']}")
    print(f"created:      {operation['created_at']}  expires: {operation['expires_at']}")
    print(f"reason:       {operation['reason']}")
    print(f"target:       {target['task_id']} in {target['source_path']}")
    print(f"edit:         {edit['field']} ({edit['mode']}) - status stays {change['from']}")
    print("-" * 72)

    checks: list[Check] = []
    try:
        rw.check_expiry(operation)
        checks.append(Check("expiry", True, f"valid until {operation['expires_at']}", "invalid"))
    except rw.ExpiredError as exc:
        checks.append(Check("expiry", False, str(exc), "invalid"))
    try:
        rw.check_source_path(target["source_path"])
        checks.append(Check("path policy", True, "inside an allowed current project root, no archived components", "invalid"))
    except rw.PolicyError as exc:
        checks.append(Check("path policy", False, str(exc), "invalid"))
    invalid = [c for c in checks if not c.ok]
    for check in checks:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    if invalid:
        print("-" * 72)
        print("VERDICT: INVALID - quarantine this operation; it must not reach the applier.")
        return 3

    mod = rw.load_parser(parser_path)
    try:
        path, task = rw.resolve_unique_task(mod, root, operation)
        checks.append(Check("task resolution", True, f"exactly one match at {path}"))
    except rw.OperationError as exc:
        print(f"  [FAIL] task resolution: {exc}")
        print("-" * 72)
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2

    raw = path.read_bytes()
    live_file_sha = rw.hashlib.sha256(raw).hexdigest()
    live_text = raw.decode("utf-8-sig", errors="replace")
    checks.append(Check(
        "source sha256",
        live_file_sha == target["expected_source_sha256"],
        "file bytes unchanged since proposal" if live_file_sha == target["expected_source_sha256"]
        else f"file changed: expected {target['expected_source_sha256'][:12]}..., live {live_file_sha[:12]}...",
    ))
    live_block = task["source"]["block_sha256"]
    checks.append(Check(
        "task fingerprint",
        live_block == target["expected_task_fingerprint"],
        "task block unchanged since proposal" if live_block == target["expected_task_fingerprint"]
        else f"task block changed: expected {target['expected_task_fingerprint'][:12]}..., live {live_block[:12]}...",
    ))
    if "stable_id" in target:
        checks.append(Check(
            "stable id",
            task["id"] == target["stable_id"],
            "parser identity matches" if task["id"] == target["stable_id"]
            else f"identity drifted: expected {target['stable_id']}, live {task['id']}",
        ))
    checks.append(Check(
        "from-status",
        task["status"] == change["from"],
        f"live status is {task['status']}" if task["status"] == change["from"]
        else f"live status is {task['status']}, operation expects {change['from']}",
    ))
    field = edit.get("field", "description")
    if field == "description":
        live_value = (task.get("description") or "").strip() or None
    else:
        live_value = ((task.get("fields") or {}).get(field) or "").strip() or None
    checks.append(Check(
        f"{field} matches proposal",
        live_value == edit["before"],
        f"live {field} matches the proposed before-text" if live_value == edit["before"]
        else f"live {field} is {live_value!r}, operation expects {edit['before']!r}",
    ))
    for check in checks[2:]:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    conflicts = [c for c in checks if not c.ok]

    print("-" * 72)
    print(f"{field} before: {edit['before'] or '(field not present)'}")
    print(f"{field} after:  {edit['after'] if edit['after'] is not None else '(field removed)'}")
    print("-" * 72)
    try:
        new_text = render_field_edit(live_text, task, mod, edit)
        ok, detail = verify_render_edit(mod, root, target["source_path"], live_text, new_text,
                                        target["task_id"], edit)
    except (ValueError, rw.OperationError) as exc:
        ok, detail = False, str(exc)
        new_text = live_text
    print(f"  [{'PASS' if ok else 'FAIL'}] render verification: {detail}")
    print("-" * 72)
    print("Proposed diff (preview only - nothing has been written):")
    print_proposed_diff(target["source_path"], live_text, new_text)
    print("-" * 72)
    if conflicts or not ok:
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2
    print("VERDICT: APPLICABLE - this edit is exactly what approval would authorize.")
    return 0


def unified_diff(relative: str, old_text: str, new_text: str) -> str:
    return "\n".join(
        difflib.unified_diff(
            old_text.split("\n"),
            new_text.split("\n"),
            fromfile=f"a/{relative}",
            tofile=f"b/{relative}",
            lineterm="",
        )
    )


def print_proposed_diff(relative: str, old_text: str, new_text: str) -> None:
    """Human-facing diff. At a terminal, git's colored --no-index presentation;
    otherwise (pipes, tests, logs) the deterministic difflib rendering.
    A git error (>1) falls back to difflib instead of aborting the review."""
    git = shutil.which("git")
    if git and sys.stdout.isatty():
        with tempfile.TemporaryDirectory(prefix="roadmap-diff-") as tmp:
            old_p = Path(tmp) / "current" / relative
            new_p = Path(tmp) / "proposed" / relative
            old_p.parent.mkdir(parents=True, exist_ok=True)
            new_p.parent.mkdir(parents=True, exist_ok=True)
            old_p.write_text(old_text)
            new_p.write_text(new_text)
            proc = subprocess.run(
                [git, "diff", "--no-index", "--color=always", "--",
                 f"current/{relative}", f"proposed/{relative}"],
                cwd=tmp, capture_output=True, text=True,
            )
            if proc.returncode <= 1:
                sys.stdout.write(proc.stdout)
                return
    print(unified_diff(relative, old_text, new_text))


def review(operation_path: Path, root: Path, parser_path: Path | None = None) -> int:
    print(f"Reviewing {operation_path}")
    print("=" * 72)

    # --- Stage 1: the operation must be well-formed, fresh and in policy.
    try:
        operation = rw.load_operation(operation_path)
    except rw.OperationError as exc:
        print(f"INVALID [{exc.code}]: {exc}")
        return 3

    if operation["action"] == rw.ACTION_ADD_TASK:
        return review_add(operation, operation_path, root, parser_path)
    if operation["action"] == rw.ACTION_DELETE_TASK:
        return review_delete(operation, operation_path, root, parser_path)
    if operation["action"] == rw.ACTION_EDIT_TASK:
        return review_edit(operation, operation_path, root, parser_path)

    target = operation["target"]
    change = operation["change"]
    print(f"operation_id: {operation['operation_id']}")
    print(f"hash:         {rw.operation_hash(operation)}")
    print(f"actor/action: {operation['actor']} / {operation['action']}")
    print(f"created:      {operation['created_at']}  expires: {operation['expires_at']}")
    print(f"reason:       {operation['reason']}")
    print(f"target:       {target['task_id']} in {target['source_path']}")
    print(f"change:       {change['from']} -> {change['to']}")
    print("-" * 72)

    checks: list[Check] = []
    try:
        rw.check_expiry(operation)
        checks.append(Check("expiry", True, f"valid until {operation['expires_at']}", "invalid"))
    except rw.ExpiredError as exc:
        checks.append(Check("expiry", False, str(exc), "invalid"))
    try:
        rw.check_source_path(target["source_path"])
        checks.append(Check("path policy", True, "inside an allowed current project root, no archived components", "invalid"))
    except rw.PolicyError as exc:
        checks.append(Check("path policy", False, str(exc), "invalid"))
    try:
        rw.check_transition(change["from"], change["to"])
        checks.append(Check("transition", True, f"{change['from']} -> {change['to']} is allowed in v1", "invalid"))
    except rw.TransitionError as exc:
        checks.append(Check("transition", False, str(exc), "invalid"))

    invalid = [c for c in checks if not c.ok and c.fatal_class == "invalid"]
    for check in checks:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    if invalid:
        print("-" * 72)
        print("VERDICT: INVALID - quarantine this operation; it must not reach the applier.")
        return 3

    # --- Stage 2: resolve the task against live bytes and compare pins.
    mod = rw.load_parser(parser_path)
    try:
        path, task = rw.resolve_unique_task(mod, root, operation)
        checks.append(Check("task resolution", True, f"exactly one match at {path}"))
    except rw.OperationError as exc:
        checks.append(Check("task resolution", False, str(exc)))
        for check in checks[3:]:
            print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
        print("-" * 72)
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2

    raw = path.read_bytes()
    live_file_sha = rw.hashlib.sha256(raw).hexdigest()
    live_text = raw.decode("utf-8-sig", errors="replace")

    checks.append(Check(
        "source sha256",
        live_file_sha == target["expected_source_sha256"],
        "file bytes unchanged since proposal" if live_file_sha == target["expected_source_sha256"]
        else f"file changed: expected {target['expected_source_sha256'][:12]}..., live {live_file_sha[:12]}...",
    ))
    live_block = task["source"]["block_sha256"]
    checks.append(Check(
        "task fingerprint",
        live_block == target["expected_task_fingerprint"],
        "task block unchanged since proposal" if live_block == target["expected_task_fingerprint"]
        else f"task block changed: expected {target['expected_task_fingerprint'][:12]}..., live {live_block[:12]}...",
    ))
    if "stable_id" in target:
        checks.append(Check(
            "stable id",
            task["id"] == target["stable_id"],
            "parser identity matches" if task["id"] == target["stable_id"]
            else f"identity drifted: expected {target['stable_id']}, live {task['id']}",
        ))
    checks.append(Check(
        "from-status",
        task["status"] == change["from"],
        f"live status is {task['status']}" if task["status"] == change["from"]
        else f"live status is {task['status']}, operation expects {change['from']}",
    ))
    for check in checks[3:]:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")

    conflicts = [c for c in checks if not c.ok]

    # --- Stage 3: render and verify the exact edit, then show it.
    print("-" * 72)
    print(f"Source excerpt ({target['source_path']}):")
    lines = live_text.split("\n")
    start = task["source"]["line_start"] - 1
    end = task["source"]["line_end"]
    for i in range(start, min(end, len(lines))):
        print(f"  {i + 1:>4} | {lines[i]}")

    new_text = render_status_edit(live_text, task, mod, change["to"])
    ok, detail = verify_render(mod, root, target["source_path"], live_text, new_text, task, change["to"])
    print("-" * 72)
    print(f"  [{'PASS' if ok else 'FAIL'}] render verification: {detail}")
    print("-" * 72)
    print("Proposed diff (preview only - nothing has been written):")
    print_proposed_diff(target["source_path"], live_text, new_text)
    print("-" * 72)

    if conflicts or not ok:
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2
    print("VERDICT: APPLICABLE - this diff is exactly what approval would authorize in M2.")
    return 0


def review_add(operation: dict, operation_path: Path, root: Path, parser_path: Path | None = None) -> int:
    """Review flow for add_task: the task must NOT exist yet; the add is rendered."""
    target = operation["target"]
    add = operation["add"]
    print(f"operation_id: {operation['operation_id']}")
    print(f"hash:         {rw.operation_hash(operation)}")
    print(f"actor/action: {operation['actor']} / {operation['action']}")
    print(f"created:      {operation['created_at']}  expires: {operation['expires_at']}")
    print(f"reason:       {operation['reason']}")
    print(f"new task:     {target['task_id']} - {add['title']}")
    print(f"into:         {target['source_path']} as {operation['change']['to']}, effort {add['effort']['value']}/{add['effort']['scale']}")
    print("-" * 72)

    checks: list[Check] = []
    try:
        rw.check_expiry(operation)
        checks.append(Check("expiry", True, f"valid until {operation['expires_at']}", "invalid"))
    except rw.ExpiredError as exc:
        checks.append(Check("expiry", False, str(exc), "invalid"))
    try:
        rw.check_source_path(target["source_path"])
        checks.append(Check("path policy", True, "inside an allowed current project root, no archived components", "invalid"))
    except rw.PolicyError as exc:
        checks.append(Check("path policy", False, str(exc), "invalid"))

    invalid = [c for c in checks if not c.ok and c.fatal_class == "invalid"]
    for check in checks:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    if invalid:
        print("-" * 72)
        print("VERDICT: INVALID - quarantine this operation; it must not reach the applier.")
        return 3

    mod = rw.load_parser(parser_path)
    relative = target["source_path"]
    path = root / relative
    if not path.is_file():
        print(f"  [FAIL] source file: not found under {root}: {relative}")
        print("-" * 72)
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2
    raw = path.read_bytes()
    live_text = raw.decode("utf-8-sig", errors="replace")
    live_sha = rw.hashlib.sha256(raw).hexdigest()
    checks.append(Check(
        "source sha256",
        live_sha == target["expected_source_sha256"],
        "file bytes unchanged since proposal" if live_sha == target["expected_source_sha256"]
        else f"file changed: expected {target['expected_source_sha256'][:12]}..., live {live_sha[:12]}...",
    ))
    existing = rw.find_task(mod, root, target["task_id"])
    checks.append(Check(
        "task code is free",
        len(existing) == 0,
        f"no existing task named {target['task_id']}" if not existing
        else f"{target['task_id']} already exists at {[str(p) for p, _t in existing]}",
    ))
    for check in checks[2:]:
        print(f"  [{'PASS' if check.ok else 'FAIL'}] {check.name}: {check.detail}")
    conflicts = [c for c in checks if not c.ok]

    print("-" * 72)
    new_text = render_add_task(live_text, target["task_id"], add, operation["change"]["to"])
    ok, detail = verify_render_add(mod, root, relative, live_text, new_text,
                                   target["task_id"], operation["change"]["to"], add)
    print(f"  [{'PASS' if ok else 'FAIL'}] render verification: {detail}")
    print("-" * 72)
    print("Proposed diff (preview only - nothing has been written):")
    print_proposed_diff(relative, live_text, new_text)
    print("-" * 72)

    if conflicts or not ok:
        print("VERDICT: CONFLICT - the source drifted from the proposal; re-propose against current bytes.")
        return 2
    print("VERDICT: APPLICABLE - this diff is exactly what approval would authorize.")
    return 0


def approve(operation_path: Path, root: Path, inbox: Path, parser_path: Path | None = None) -> int:
    """Human gate, recorded: review must pass, then approval binds to exact bytes.

    Moves (never copies) the operation into write-inbox/approved/ next to its
    approval record, so a pending file can never be applied twice.
    """
    code = review(operation_path, root, parser_path)
    if code != 0:
        print("Approval refused: only an APPLICABLE operation can be approved.")
        return code
    operation = rw.load_operation(operation_path)
    approved_dir = inbox / "approved"
    approved_dir.mkdir(parents=True, exist_ok=True)
    op_dest = approved_dir / f"{operation['operation_id']}.json"
    approval_dest = approved_dir / f"{operation['operation_id']}.approval.json"
    if op_dest.exists() or approval_dest.exists():
        print(f"REFUSED: an approval for {operation['operation_id']} already exists", file=sys.stderr)
        return 3
    record = rw.build_approval_record(operation)
    approval_dest.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(operation_path, op_dest)  # move, never copy: one approval, one attempt
    print("-" * 72)
    print(f"APPROVED: {operation['operation_id']}")
    print(f"  approval: {approval_dest}")
    print(f"  operation moved to: {op_dest}")
    print("  one approval = one apply attempt; any source drift re-conflicts it")
    return 0


def reject(operation_path: Path, inbox: Path) -> int:
    """Record a human rejection and move the operation to quarantine."""
    operation = rw.load_operation(operation_path)
    quarantine_dir = inbox / "quarantine"
    quarantine_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "schema_version": rw.SCHEMA_VERSION,
        "kind": "rejection",
        "operation_id": operation["operation_id"],
        "operation_hash": rw.operation_hash(operation),
        "rejected_at": rw.rfc3339_now(),
        "reviewer": rw.REVIEWER,
        "reason_code": "REJECTED_BY_REVIEWER",
    }
    record_path = quarantine_dir / f"{operation['operation_id']}.rejected.json"
    record_path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(operation_path, quarantine_dir / operation_path.name)
    print(f"REJECTED: {operation['operation_id']} moved to {quarantine_dir}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", type=Path, help="operation JSON file to review")
    parser.add_argument("--root", type=Path, required=True, help="roadmap root containing the project dirs")
    parser.add_argument("--parser", type=Path, default=None,
                        help=f"path to roadmap_sync.py (default {rw.DEFAULT_PARSER_PATH})")
    gate = parser.add_mutually_exclusive_group()
    gate.add_argument("--approve", action="store_true", help="record approval and move the op to write-inbox/approved/")
    gate.add_argument("--reject", action="store_true", help="record rejection and move the op to write-inbox/quarantine/")
    parser.add_argument("--inbox", type=Path, default=None, help="write-inbox directory (required for --approve/--reject)")
    args = parser.parse_args()
    if (args.approve or args.reject) and args.inbox is None:
        parser.error("--approve/--reject require --inbox")
    try:
        if args.approve:
            return approve(args.operation.expanduser(), args.root.expanduser().resolve(), args.inbox.expanduser().resolve(), args.parser)
        if args.reject:
            return reject(args.operation.expanduser(), args.inbox.expanduser().resolve())
        return review(args.operation.expanduser(), args.root.expanduser().resolve(), args.parser)
    except rw.OperationError as exc:
        print(f"error [{exc.code}]: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())

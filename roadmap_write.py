#!/usr/bin/env python3
"""Guarded roadmap writes, milestone M1: operation schema, policy, proposals.

A write request is DATA, not a command. This module defines the versioned
operation envelope, canonical hashing (so an approval can bind to exact
bytes), the fail-closed policy rules, and the `propose` command that builds
an operation file for human review. Nothing in this file modifies roadmap
Markdown; the applier is milestone M2.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

SCHEMA_VERSION = 1
ACTOR = "instinct"
ACTION_SET_STATUS = "set_status"
ACTION_ADD_TASK = "add_task"
ACTION_DELETE_TASK = "delete_task"
ACTION_EDIT_TASK = "edit_task"
ACTIONS = frozenset({ACTION_SET_STATUS, ACTION_ADD_TASK, ACTION_DELETE_TASK, ACTION_EDIT_TASK})
EDIT_MODES = ("append", "replace", "clear")
EDIT_FIELDS = ("description", "summary", "sprint", "blocked_by")
# Single-line Markdown field labels, title-cased exactly as the renderer writes them.
FIELD_LABELS = {"description": "Description", "summary": "Summary",
                "sprint": "Sprint", "blocked_by": "Blocked by"}
SPRINT_ORDER_TEXT_RE = re.compile(r"^[1-9]\d{0,3}$")
# Codes as the parser extracts them (schema pattern): uppercase-led, e.g. SYNC-1.
STRICT_TASK_CODE_RE = re.compile(r"^[A-Z]+(-[A-Za-z0-9]+)+$")


def normalize_field_text(field: str, text: str) -> str:
    """Canonical single-line text for a replace-mode field write. Fail closed."""
    text = " ".join(text.split())
    if field == "sprint":
        if not SPRINT_ORDER_TEXT_RE.match(text):
            raise PolicyError(f"sprint field text must be a positive integer (the order position), got {text!r}")
        return text
    if field == "blocked_by":
        codes = [c for c in re.split(r"[\s,]+", text) if c]
        if not codes or any(not STRICT_TASK_CODE_RE.match(c) for c in codes):
            raise PolicyError(f"blocked_by text must be task codes separated by commas/spaces, got {text!r}")
        return ", ".join(dict.fromkeys(codes))
    return text
STATUSES = ("pending", "in_progress", "completed")
# v3: any real status to any other real status. No-ops (x -> x) are refused
# at proposal time, before an operation ever exists.
ALLOWED_TRANSITIONS = frozenset(
    (a, b) for a in STATUSES for b in STATUSES if a != b
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OPERATION_ID_RE = re.compile(r"^op_[0-9a-f]{32}$")
TASK_CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.]*?(?:-[A-Za-z0-9][A-Za-z0-9_.-]*)+$")

# Exact directory names that must never be written through this system,
# matched case-insensitively on any path component. Mirrors the parser's
# archive exclusion so a proposal cannot resurrect archived roadmaps.
ARCHIVE_DENYLIST = frozenset({
    "old-archive-ragenodes-rewrite",
    "ragenodes.archive",
})
# Policy v1: writes stay inside the two current project roots.
DEFAULT_ALLOWED_PROJECTS = frozenset({
    "ragenodes.agentsdir",
    "ragenodesultimate",
})
# Directories that never hold sources of truth: demo fixtures, the guarded
# writes inbox and its roadmap backups. Mirrored in the parser patch so
# proposals, reviews and snapshots see the same tree.
EXCLUDED_NONSOURCE_DIR_NAMES = frozenset({
    "fixtures",
    "test-fixtures",
    "test_fixtures",
    "write-inbox",
    "backups",
})
DEFAULT_PARSER_PATH = Path("~/.local/lib/roadmap-sync/roadmap_sync.py")
DEFAULT_TTL_HOURS = 24

# Status text written by the (previewed) edit. Both strings normalize to the
# matching status under roadmap_sync.normalize_status.
STATUS_RENDER = {
    "pending": "⏳ Pending",
    "in_progress": "\U0001f504 In Progress",
    "completed": "✅ Completed",
}


# --------------------------------------------------------------------------
# Errors: every failure carries a stable machine-readable reason code.

class OperationError(Exception):
    code = "OPERATION_INVALID"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code is not None:
            self.code = code


class SchemaError(OperationError):
    code = "INVALID_SCHEMA"


class PolicyError(OperationError):
    code = "POLICY_VIOLATION"


class TransitionError(OperationError):
    code = "INVALID_TRANSITION"


class ExpiredError(OperationError):
    code = "EXPIRED"


class ResolveError(OperationError):
    code = "TASK_NOT_FOUND"


# --------------------------------------------------------------------------
# Canonical serialization: the hash an approval binds to.

def canonical_operation(operation: dict[str, Any]) -> bytes:
    """Canonical bytes of an operation, with approval forced to null.

    Approval is a separate fact recorded elsewhere; the hash covers exactly
    the proposal Mario reviewed, so any later edit changes the hash and
    invalidates the approval.
    """
    op = dict(operation)
    op["approval"] = None
    return json.dumps(op, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def operation_hash(operation: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_operation(operation)).hexdigest()


def parse_rfc3339(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as exc:
        raise SchemaError(f"not an RFC3339 timestamp: {value!r}") from exc
    if parsed.tzinfo is None:
        raise SchemaError(f"timestamp must carry a timezone: {value!r}")
    return parsed


def rfc3339_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------
# Validation and policy.

def validate_operation(operation: Any) -> dict[str, Any]:
    """Fail-closed schema validation. Returns the operation or raises."""
    if not isinstance(operation, dict):
        raise SchemaError("operation must be a JSON object")
    if operation.get("schema_version") != SCHEMA_VERSION:
        raise SchemaError(f"schema_version must be {SCHEMA_VERSION}")
    op_id = operation.get("operation_id")
    if not isinstance(op_id, str) or not OPERATION_ID_RE.match(op_id):
        raise SchemaError("operation_id must look like op_<32 lowercase hex>")
    created = parse_rfc3339(_require_str(operation, "created_at"))
    expires = parse_rfc3339(_require_str(operation, "expires_at"))
    if expires <= created:
        raise SchemaError("expires_at must be after created_at")
    if operation.get("actor") != ACTOR:
        raise PolicyError(f"actor must be {ACTOR!r} in v1")
    action = operation.get("action")
    if action not in ACTIONS:
        raise SchemaError(f"action must be one of {sorted(ACTIONS)}")

    target = operation.get("target")
    if not isinstance(target, dict):
        raise SchemaError("target must be an object")
    task_id = _require_str(target, "task_id")
    if not TASK_CODE_RE.match(task_id):
        raise SchemaError(f"task_id must be a task code like SYNC-1, got {task_id!r}")
    _require_str(target, "source_path")
    value = _require_str(target, "expected_source_sha256")
    if not SHA256_RE.match(value):
        raise SchemaError("expected_source_sha256 must be 64 lowercase hex chars")

    change = operation.get("change")
    if not isinstance(change, dict):
        raise SchemaError("change must be an object")

    if action == ACTION_ADD_TASK:
        # The task does not exist yet: no fingerprint or stable id to pin,
        # and change.from is null by definition.
        if target.get("expected_task_fingerprint") is not None:
            raise SchemaError("add_task carries no expected_task_fingerprint")
        if target.get("stable_id") is not None:
            raise SchemaError("add_task carries no stable_id")
        if change.get("from") is not None:
            raise SchemaError("add_task change.from must be null")
        if change.get("to") not in STATUSES:
            raise SchemaError(f"add_task change.to must be one of {STATUSES}")
        add = operation.get("add")
        if not isinstance(add, dict):
            raise SchemaError("add_task requires an add object")
        title = add.get("title")
        if not isinstance(title, str) or not title.strip():
            raise SchemaError("add.title must be a non-empty string")
        if "**" in title or "\n" in title:
            raise SchemaError("add.title must be a single line without markup")
        effort = add.get("effort")
        if not isinstance(effort, dict):
            raise SchemaError("add.effort must be an object")
        val, scale = effort.get("value"), effort.get("scale")
        if not (isinstance(val, (int, float)) and isinstance(scale, (int, float)) and scale > 0 and 0 <= val <= scale):
            raise SchemaError("add.effort needs 0 <= value <= scale")
        description = add.get("description")
        if description is not None and (not isinstance(description, str) or "\n" in description):
            raise SchemaError("add.description must be a single line when present")
        links = add.get("links")
        if links is not None:
            if not isinstance(links, list):
                raise SchemaError("add.links must be a list when present")
            for entry in links:
                if (not isinstance(entry, dict) or set(entry) != {"text", "url"}
                        or not all(isinstance(v, str) and v.strip() and "\n" not in v for v in entry.values())):
                    raise SchemaError("add.links entries are {text, url} single-line strings")
        conversations = add.get("conversations")
        if conversations is not None:
            if not isinstance(conversations, list) or not conversations:
                raise SchemaError("add.conversations must be a non-empty list when present")
            for entry in conversations:
                if not isinstance(entry, str) or not entry.strip() or "\n" in entry:
                    raise SchemaError("add.conversations entries must be single-line strings")
    elif action == ACTION_DELETE_TASK:
        value = _require_str(target, "expected_task_fingerprint")
        if not SHA256_RE.match(value):
            raise SchemaError("expected_task_fingerprint must be 64 lowercase hex chars")
        stable_id = target.get("stable_id")
        if stable_id is not None and (not isinstance(stable_id, str) or not stable_id.startswith("task_")):
            raise SchemaError("stable_id must look like task_<hex> when present")
        from_status = change.get("from")
        if from_status not in STATUSES:
            raise SchemaError(f"delete_task change.from must be one of {STATUSES}")
        if change.get("to") is not None:
            raise SchemaError("delete_task change.to must be null")
        delete = operation.get("delete")
        if not isinstance(delete, dict):
            raise SchemaError("delete_task requires a delete object")
        block = delete.get("removed_block")
        if not isinstance(block, str) or not block.strip():
            raise SchemaError("delete.removed_block must carry the verbatim task block")
        title = delete.get("title")
        if not isinstance(title, str) or not title.strip():
            raise SchemaError("delete.title must be a non-empty string")
    elif action == ACTION_EDIT_TASK:
        value = _require_str(target, "expected_task_fingerprint")
        if not SHA256_RE.match(value):
            raise SchemaError("expected_task_fingerprint must be 64 lowercase hex chars")
        stable_id = target.get("stable_id")
        if stable_id is not None and (not isinstance(stable_id, str) or not stable_id.startswith("task_")):
            raise SchemaError("stable_id must look like task_<hex> when present")
        from_status = change.get("from")
        if from_status not in STATUSES:
            raise SchemaError(f"edit_task change.from must be one of {STATUSES}")
        if change.get("to") != from_status:
            raise SchemaError("edit_task change.to must equal change.from (status is unchanged)")
        edit = operation.get("edit")
        if not isinstance(edit, dict):
            raise SchemaError("edit_task requires an edit object")
        field = edit.get("field")
        if field not in EDIT_FIELDS:
            raise SchemaError(f"edit.field must be one of {list(EDIT_FIELDS)}")
        mode = edit.get("mode")
        if mode not in EDIT_MODES:
            raise SchemaError(f"edit.mode must be one of {list(EDIT_MODES)}")
        if mode == "append" and field != "description":
            raise SchemaError("edit.mode append applies to the description only")
        if mode == "clear" and field == "description":
            raise SchemaError("the description cannot be cleared")
        text = edit.get("text")
        if mode == "clear":
            if text not in (None, ""):
                raise SchemaError("edit.text must be empty for a clear")
        elif not isinstance(text, str) or not text.strip() or "\n" in text:
            raise SchemaError("edit.text must be a single non-empty line")
        before = edit.get("before")
        if before is not None and (not isinstance(before, str) or "\n" in before):
            raise SchemaError("edit.before must be a single line or null")
        after = edit.get("after")
        if mode == "clear":
            if after is not None:
                raise SchemaError("edit.after must be null for a clear")
            if before is None:
                raise SchemaError("edit is a no-op: the field is not present to clear")
        else:
            if not isinstance(after, str) or not after.strip() or "\n" in after:
                raise SchemaError("edit.after must be a single non-empty line")
            if field == "description":
                if after != render_edit_after(mode, before, text):
                    raise SchemaError("edit.after must equal the rendered result of mode+text over before")
            elif after != normalize_field_text(field, text):
                raise SchemaError("edit.after must equal the normalized field text")
            if after == (before or ""):
                raise SchemaError("edit is a no-op: the field would not change")
    else:
        value = _require_str(target, "expected_task_fingerprint")
        if not SHA256_RE.match(value):
            raise SchemaError("expected_task_fingerprint must be 64 lowercase hex chars")
        stable_id = target.get("stable_id")
        if stable_id is not None and (not isinstance(stable_id, str) or not stable_id.startswith("task_")):
            raise SchemaError("stable_id must look like task_<hex> when present")
        from_status = change.get("from")
        to_status = change.get("to")
        if from_status not in STATUSES or to_status not in STATUSES:
            raise SchemaError(f"change.from/to must be one of {STATUSES}")
        check_transition(from_status, to_status)

    reason = operation.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise SchemaError("reason must be a non-empty string")
    if operation.get("approval") is not None:
        # M1 has no approval machinery; a non-null approval is never valid yet.
        raise SchemaError("approval must be null in milestone M1")
    return operation


def _require_str(mapping: dict[str, Any], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        raise SchemaError(f"{key} must be a non-empty string")
    return value


def check_transition(from_status: str, to_status: str) -> None:
    if (from_status, to_status) not in ALLOWED_TRANSITIONS:
        allowed = ", ".join(f"{a} -> {b}" for a, b in sorted(ALLOWED_TRANSITIONS))
        raise TransitionError(
            f"transition {from_status} -> {to_status} is not allowed in v1 (allowed: {allowed})"
        )


def check_expiry(operation: dict[str, Any], now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if parse_rfc3339(operation["expires_at"]) <= now:
        raise ExpiredError(f"operation {operation['operation_id']} expired at {operation['expires_at']}")


def check_source_path(source_path: str, allowed_projects: frozenset[str] = DEFAULT_ALLOWED_PROJECTS) -> PurePosixPath:
    """Policy v1 for the target path. Returns the parsed relative path."""
    if "\\" in source_path:
        raise PolicyError(f"backslashes are not allowed in source_path: {source_path!r}")
    rel = PurePosixPath(source_path)
    if rel.is_absolute():
        raise PolicyError(f"source_path must be relative to the roadmap root: {source_path!r}")
    parts = rel.parts
    if any(part in ("..", ".", "") for part in parts):
        raise PolicyError(f"path traversal is not allowed in source_path: {source_path!r}")
    lowered = [part.casefold() for part in parts]
    denied = [part for part in lowered if part in ARCHIVE_DENYLIST]
    if denied:
        raise PolicyError(f"archived tree component {denied[0]!r} is denied: {source_path!r}")
    if not parts or lowered[0] not in allowed_projects:
        raise PolicyError(
            f"source_path must live under one of {sorted(allowed_projects)}: {source_path!r}"
        )
    name = parts[-1].casefold()
    if not name.endswith(".md") or "roadmap" not in name:
        raise PolicyError(f"target must be a roadmap Markdown file the parser would discover: {source_path!r}")
    return rel


# --------------------------------------------------------------------------
# Parser reuse: the existing read-only parser stays the only parser.

def load_parser(parser_path: Path | None = None):
    path = Path(parser_path or DEFAULT_PARSER_PATH).expanduser()
    if not path.is_file():
        raise OperationError(f"parser not found at {path}", code="PARSER_MISSING")
    spec = importlib.util.spec_from_file_location("roadmap_sync", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def iter_roadmap_files(root: Path) -> list[Path]:
    """Same discovery and archive pruning as the deployed parser."""
    found: list[Path] = []
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        dirnames[:] = [
            name for name in dirnames
            if name.casefold() not in ARCHIVE_DENYLIST
            and name.casefold() not in EXCLUDED_NONSOURCE_DIR_NAMES
            and not (Path(current) / name).is_symlink()
        ]
        for filename in filenames:
            if filename.casefold().endswith(".md") and "roadmap" in filename.casefold():
                found.append(Path(current) / filename)
    return sorted(found, key=lambda p: p.as_posix().casefold())


def find_task(mod, root: Path, task_code: str) -> list[tuple[Path, dict[str, Any]]]:
    """Resolve a task code across the tree. Returns (path, task) matches."""
    matches: list[tuple[Path, dict[str, Any]]] = []
    parse_errors: list[str] = []
    for path in iter_roadmap_files(root):
        try:
            _source, tasks = mod.parse_roadmap(path, root)
        except (OSError, UnicodeError, ValueError) as exc:
            parse_errors.append(f"{path}: {type(exc).__name__}: {exc}")
            continue
        for task in tasks:
            if task.get("code") == task_code:
                matches.append((path, task))
    if parse_errors:
        # Fail closed: a tree that does not parse cleanly is not safe to write.
        raise OperationError(
            "parse errors in current sources; fix before proposing writes: " + "; ".join(parse_errors),
            code="PARSE_ERROR",
        )
    return matches


def resolve_unique_task(mod, root: Path, operation: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    target = operation["target"]
    matches = find_task(mod, root, target["task_id"])
    if not matches:
        raise ResolveError(f"no task with code {target['task_id']!r} under {root}")
    if len(matches) > 1:
        locations = ", ".join(str(path) for path, _task in matches)
        raise ResolveError(f"duplicate task code {target['task_id']!r}: {locations}", code="DUPLICATE_TASK")
    path, task = matches[0]
    relative = path.relative_to(root).as_posix()
    if relative != target["source_path"]:
        raise ResolveError(
            f"task {target['task_id']!r} lives at {relative}, not {target['source_path']}",
            code="SOURCE_PATH_MISMATCH",
        )
    return path, task


# --------------------------------------------------------------------------
# Proposal creation.

def build_operation(
    mod,
    root: Path,
    task_code: str,
    to_status: str,
    reason: str,
    ttl_hours: int = DEFAULT_TTL_HOURS,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Resolve a live task and build a fully pinned operation envelope."""
    now = now or datetime.now(timezone.utc)
    matches = find_task(mod, root, task_code)
    if not matches:
        raise ResolveError(f"no task with code {task_code!r} under {root}")
    if len(matches) > 1:
        locations = ", ".join(str(path) for path, _task in matches)
        raise ResolveError(f"duplicate task code {task_code!r}: {locations}", code="DUPLICATE_TASK")
    path, task = matches[0]
    relative = path.relative_to(root).as_posix()
    check_source_path(relative)
    from_status = task["status"]
    check_transition(from_status, to_status)
    created = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    expires = (now + timedelta(hours=ttl_hours)).isoformat(timespec="seconds").replace("+00:00", "Z")
    operation = {
        "schema_version": SCHEMA_VERSION,
        "operation_id": "op_" + uuid.uuid4().hex,
        "created_at": created,
        "expires_at": expires,
        "actor": ACTOR,
        "action": ACTION_SET_STATUS,
        "target": {
            "task_id": task_code,
            "stable_id": task["id"],
            "source_path": relative,
            "expected_source_sha256": task["source"]["file_sha256"],
            "expected_task_fingerprint": task["source"]["block_sha256"],
        },
        "change": {"from": from_status, "to": to_status},
        "reason": reason.strip(),
        "approval": None,
    }
    validate_operation(operation)
    return operation


def build_add_operation(
    mod,
    root: Path,
    source_path: str,
    task_code: str,
    title: str,
    effort_value: float,
    to_status: str,
    reason: str,
    ttl_hours: int = DEFAULT_TTL_HOURS,
    now: datetime | None = None,
    description: str | None = None,
    links: list[dict[str, str]] | None = None,
    conversations: list[str] | None = None,
) -> dict[str, Any]:
    """Pin a new-task operation to the live bytes of one roadmap file."""
    now = now or datetime.now(timezone.utc)
    relative = check_source_path(source_path).as_posix()
    path = root / relative
    if not path.is_file():
        raise ResolveError(f"source file not found under {root}: {relative}", code="SOURCE_NOT_FOUND")
    if find_task(mod, root, task_code):
        raise ResolveError(f"task code {task_code!r} already exists under {root}", code="TASK_EXISTS")
    raw = path.read_bytes()
    created = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    expires = (now + timedelta(hours=ttl_hours)).isoformat(timespec="seconds").replace("+00:00", "Z")
    operation = {
        "schema_version": SCHEMA_VERSION,
        "operation_id": "op_" + uuid.uuid4().hex,
        "created_at": created,
        "expires_at": expires,
        "actor": ACTOR,
        "action": ACTION_ADD_TASK,
        "target": {
            "task_id": task_code,
            "source_path": relative,
            "expected_source_sha256": hashlib.sha256(raw).hexdigest(),
            "expected_task_fingerprint": None,
        },
        "change": {"from": None, "to": to_status},
        "add": {
            "title": title.strip(),
            "effort": {"value": effort_value, "scale": 10.0},
            "description": (description or "").strip() or None,
            "links": links or None,
            "conversations": conversations or None,
        },
        "reason": reason.strip(),
        "approval": None,
    }
    validate_operation(operation)
    return operation


def render_edit_after(mode: str, before: str | None, text: str) -> str:
    """The exact description text after the edit. Single source of truth used by
    the builder, the schema validator and the reviewer."""
    text = " ".join(text.split())
    if mode == "replace" or not before:
        return text
    return " ".join(before.split()) + " " + text


def build_edit_operation(
    mod,
    root: Path,
    task_code: str,
    mode: str,
    text: str,
    reason: str,
    field: str = "description",
    ttl_hours: int = DEFAULT_TTL_HOURS,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Pin a field edit to the live bytes of one task block."""
    if mode not in EDIT_MODES:
        raise PolicyError(f"edit mode must be one of {list(EDIT_MODES)}")
    if field not in EDIT_FIELDS:
        raise PolicyError(f"edit field must be one of {list(EDIT_FIELDS)}")
    if mode == "append" and field != "description":
        raise PolicyError("append mode applies to the description only")
    if mode == "clear" and field == "description":
        raise PolicyError("the description cannot be cleared")
    if mode == "clear":
        text = ""
    elif not text or not text.strip() or "\n" in text:
        raise PolicyError("edit text must be a single non-empty line")
    now = now or datetime.now(timezone.utc)
    matches = find_task(mod, root, task_code)
    if not matches:
        raise ResolveError(f"no task with code {task_code!r} under {root}", code="TASK_NOT_FOUND")
    if len(matches) > 1:
        locations = ", ".join(str(path) for path, _task in matches)
        raise ResolveError(f"duplicate task code {task_code!r}: {locations}", code="DUPLICATE_TASK")
    path, task = matches[0]
    relative = path.relative_to(root).as_posix()
    check_source_path(relative)
    if field == "description":
        before = (task.get("description") or "").strip() or None
        after = render_edit_after(mode, before, text)
    else:
        raw = ((task.get("fields") or {}).get(field) or "").strip()
        before = raw or None
        after = None if mode == "clear" else normalize_field_text(field, text)
    if mode == "clear" and before is None:
        raise ResolveError(f"{task_code}: no {field} field to clear", code="NO_OP")
    if after is not None and after == (before or ""):
        raise ResolveError(f"{task_code}: the {field} field already says exactly that", code="NO_OP")
    created = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    expires = (now + timedelta(hours=ttl_hours)).isoformat(timespec="seconds").replace("+00:00", "Z")
    operation = {
        "schema_version": SCHEMA_VERSION,
        "operation_id": "op_" + uuid.uuid4().hex,
        "created_at": created,
        "expires_at": expires,
        "actor": ACTOR,
        "action": ACTION_EDIT_TASK,
        "target": {
            "task_id": task_code,
            "stable_id": task["id"],
            "source_path": relative,
            "expected_source_sha256": task["source"]["file_sha256"],
            "expected_task_fingerprint": task["source"]["block_sha256"],
        },
        "change": {"from": task["status"], "to": task["status"]},
        "edit": {
            "field": field,
            "mode": mode,
            "text": " ".join(text.split()),
            "before": before,
            "after": after,
        },
        "reason": reason.strip(),
        "approval": None,
    }
    validate_operation(operation)
    return operation


def build_delete_operation(
    mod,
    root: Path,
    task_code: str,
    reason: str,
    ttl_hours: int = DEFAULT_TTL_HOURS,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Pin a delete operation to the live bytes of one task block."""
    now = now or datetime.now(timezone.utc)
    matches = find_task(mod, root, task_code)
    if not matches:
        raise ResolveError(f"no task with code {task_code!r} under {root}", code="TASK_NOT_FOUND")
    if len(matches) > 1:
        locations = ", ".join(str(path) for path, _task in matches)
        raise ResolveError(f"duplicate task code {task_code!r}: {locations}", code="DUPLICATE_TASK")
    path, task = matches[0]
    relative = path.relative_to(root).as_posix()
    check_source_path(relative)
    lines = path.read_text(encoding="utf-8-sig", errors="replace").split("\n")
    start = task["source"]["line_start"] - 1
    end = task["source"]["line_end"]
    removed_block = "\n".join(lines[start:end])
    created = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    expires = (now + timedelta(hours=ttl_hours)).isoformat(timespec="seconds").replace("+00:00", "Z")
    operation = {
        "schema_version": SCHEMA_VERSION,
        "operation_id": "op_" + uuid.uuid4().hex,
        "created_at": created,
        "expires_at": expires,
        "actor": ACTOR,
        "action": ACTION_DELETE_TASK,
        "target": {
            "task_id": task_code,
            "stable_id": task["id"],
            "source_path": relative,
            "expected_source_sha256": task["source"]["file_sha256"],
            "expected_task_fingerprint": task["source"]["block_sha256"],
        },
        "change": {"from": task["status"], "to": None},
        "delete": {
            "title": task["title"],
            "status": task["status"],
            "removed_block": removed_block,
        },
        "reason": reason.strip(),
        "approval": None,
    }
    validate_operation(operation)
    return operation


def write_operation(operation: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{operation['operation_id']}.json"
    if path.exists():
        raise OperationError(f"refusing to overwrite existing operation {path}", code="REPLAYED_OPERATION")
    payload = json.dumps(operation, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.write_text(payload, encoding="utf-8")
    return path


def load_operation(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SchemaError(f"cannot read operation {path}: {exc}") from exc
    return validate_operation(raw)


# --------------------------------------------------------------------------
# Approval records: Mario's sign-off, bound to exact operation bytes.

APPROVAL_KIND = "approval"
REVIEWER = "mario-local"


def build_approval_record(operation: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Create the approval fact for an operation Mario just reviewed."""
    now = now or datetime.now(timezone.utc)
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": APPROVAL_KIND,
        "operation_id": operation["operation_id"],
        "operation_hash": operation_hash(operation),
        "approved_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "reviewer": REVIEWER,
    }


def validate_approval_record(record: Any, operation: dict[str, Any]) -> dict[str, Any]:
    """An approval authorizes one exact operation, nothing near it."""
    if not isinstance(record, dict):
        raise SchemaError("approval record must be a JSON object")
    if record.get("schema_version") != SCHEMA_VERSION:
        raise SchemaError(f"approval schema_version must be {SCHEMA_VERSION}")
    if record.get("kind") != APPROVAL_KIND:
        raise SchemaError(f"approval kind must be {APPROVAL_KIND!r}")
    if record.get("operation_id") != operation["operation_id"]:
        raise OperationError("approval binds to a different operation_id", code="APPROVAL_MISMATCH")
    if record.get("operation_hash") != operation_hash(operation):
        raise OperationError(
            "approval hash does not match the canonical operation hash; the operation changed after review",
            code="APPROVAL_MISMATCH",
        )
    parse_rfc3339(_require_str(record, "approved_at"))
    if record.get("reviewer") != REVIEWER:
        raise PolicyError(f"approval reviewer must be {REVIEWER!r}")
    return record


# --------------------------------------------------------------------------
# Fixture generator for the M1 demo and manual review practice.

FIXTURE_AGENTS_MD = """# Antigravity CLI Roadmap

## Active Work

* [ ] **DEMO-1 - Fixture in-progress task**
  * **Description**: Stands in for a task currently being worked.
  * **Effort**: `[effort: 8/10]`
  * **Status**: \U0001f504 In Progress
* [ ] **DEMO-2 - Fixture pending task**
  * **Description**: Stands in for a task not yet started.
  * **Effort**: `[effort: 2/10]`
  * **Status**: ⏳ Pending
* [x] **DEMO-3 - Fixture completed task**
  * **Description**: Stands in for a finished task.
  * **Effort**: `[effort: 1/10]`
  * **Status**: ✅ Completed
* [ ] **DEMO-4 - Fixture task without a status field**
  * **Description**: Exercises the insert-a-status-line path.
  * **Effort**: `[effort: 3/10]`
"""

FIXTURE_ULT_MD = """# ragenodesultimate Features Roadmap

## Next Up

* [ ] **ULT-1 - Fixture pending feature**
  * **Description**: Pending task in the second project root.
  * **Effort**: `[effort: 5/10]`
  * **Status**: ⏳ Pending
"""

FIXTURE_ARCHIVE_MD = """# Old Archive Roadmap

* [ ] **OLD-1 - Archived task that must stay untouchable**
  * **Status**: ⏳ Pending
"""

FIXTURE_FILES = {
    "ragenodes.agentsdir/ANTIGRAVITY_CLI_ROADMAP.md": FIXTURE_AGENTS_MD,
    "ragenodesultimate/FEATURES_ROADMAP.md": FIXTURE_ULT_MD,
    "OLD-ARCHIVE-RAGENODES-REWRITE/OLD_ROADMAP.md": FIXTURE_ARCHIVE_MD,
}


def init_fixtures(out_dir: Path, mod, projects_root: Path | None = None) -> list[Path]:
    """Materialize a fixture tree plus sample operations against it.

    The tree contains roadmap Markdown, so it must never land inside the
    directory the live sync scans. Resolve the path fully and refuse any
    location under ~/projects.
    """
    out_dir = out_dir.expanduser().resolve()
    projects_root = (projects_root or Path("~/projects")).expanduser().resolve()
    if out_dir == projects_root or projects_root in out_dir.parents:
        raise OperationError(
            f"fixture root {out_dir} is inside {projects_root}; the live sync would ingest it. "
            "Use the default (~/roadmap-sync-fixtures) or any path outside ~/projects.",
            code="FIXTURE_INSIDE_PROJECTS",
        )
    inbox = out_dir / "write-inbox"
    if inbox.exists():
        shutil.rmtree(inbox)  # repeatable demo: drop old receipts/backups
    for relative, content in FIXTURE_FILES.items():
        path = out_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    pending_dir = out_dir / "write-inbox" / "pending"
    written: list[Path] = []

    def save(name: str, operation: dict[str, Any]) -> None:
        pending_dir.mkdir(parents=True, exist_ok=True)
        path = pending_dir / name
        path.write_text(json.dumps(operation, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written.append(path)

    valid_start = build_operation(mod, out_dir, "DEMO-2", "in_progress", "Fixture: start work on DEMO-2.")
    save("valid-start-demo2.json", valid_start)
    valid_complete = build_operation(mod, out_dir, "DEMO-1", "completed", "Fixture: mark DEMO-1 complete.")
    save("valid-complete-demo1.json", valid_complete)
    valid_insert = build_operation(mod, out_dir, "DEMO-4", "in_progress", "Fixture: start DEMO-4 (no Status field yet).")
    save("valid-start-demo4-nofield.json", valid_insert)

    bad_hash = dict(valid_complete)
    bad_hash["target"] = dict(valid_complete["target"], expected_source_sha256="0" * 64)
    bad_hash["operation_id"] = "op_" + uuid.uuid4().hex
    save("conflict-bad-source-hash.json", bad_hash)

    expired = build_operation(mod, out_dir, "ULT-1", "in_progress", "Fixture: already expired.")
    expired["created_at"] = "2000-01-01T00:00:00Z"
    expired["expires_at"] = "2000-01-02T00:00:00Z"
    expired["operation_id"] = "op_" + uuid.uuid4().hex
    save("invalid-expired.json", expired)

    denied = dict(valid_start)
    denied["target"] = dict(valid_start["target"], source_path="OLD-ARCHIVE-RAGENODES-REWRITE/OLD_ROADMAP.md")
    denied["operation_id"] = "op_" + uuid.uuid4().hex
    save("invalid-archive-path.json", denied)

    bad_transition = dict(valid_complete)
    bad_transition["change"] = {"from": "completed", "to": "completed"}  # no-op: never allowed
    bad_transition["operation_id"] = "op_" + uuid.uuid4().hex
    save("invalid-transition.json", bad_transition)
    return written


# --------------------------------------------------------------------------
# CLI.

def _add_parser_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--parser", type=Path, default=None,
                        help=f"path to roadmap_sync.py (default {DEFAULT_PARSER_PATH})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    propose_cmd = commands.add_parser("propose", help="build an operation file for review")
    propose_cmd.add_argument("--root", type=Path, required=True, help="roadmap root containing the project dirs")
    propose_cmd.add_argument("--task", required=True, help="task code, e.g. SYNC-1")
    propose_cmd.add_argument("--to", required=True, choices=sorted(STATUSES))
    propose_cmd.add_argument("--reason", required=True)
    propose_cmd.add_argument("--ttl-hours", type=int, default=DEFAULT_TTL_HOURS)
    propose_cmd.add_argument("--out", type=Path, required=True, help="write-inbox/pending directory")
    _add_parser_arg(propose_cmd)

    add_cmd = commands.add_parser("propose-add", help="build a new-task operation file for review")
    add_cmd.add_argument("--root", type=Path, required=True, help="roadmap root containing the project dirs")
    add_cmd.add_argument("--file", required=True, help="source path relative to the root, e.g. ragenodesultimate/FEATURES_ROADMAP.md")
    add_cmd.add_argument("--task", required=True, help="new task code, e.g. ULT-2")
    add_cmd.add_argument("--title", required=True)
    add_cmd.add_argument("--effort", type=float, required=True, help="effort value on a 0-10 scale")
    add_cmd.add_argument("--status", default="pending", choices=sorted(STATUSES))
    add_cmd.add_argument("--description", default=None)
    add_cmd.add_argument("--links", default=None,
                         help='JSON list of {"text", "url"} link objects for a **Links** line')
    add_cmd.add_argument("--conversations", default=None,
                         help="JSON list of conversation references (ids or origin text), chronological order")
    add_cmd.add_argument("--reason", required=True)
    add_cmd.add_argument("--ttl-hours", type=int, default=DEFAULT_TTL_HOURS)
    add_cmd.add_argument("--out", type=Path, required=True, help="write-inbox/pending directory")
    _add_parser_arg(add_cmd)

    del_cmd = commands.add_parser("propose-delete", help="build a delete-task operation file for review")
    del_cmd.add_argument("--root", type=Path, required=True, help="roadmap root containing the project dirs")
    del_cmd.add_argument("--task", required=True, help="task code to delete, e.g. TEST-1")
    del_cmd.add_argument("--reason", required=True)
    del_cmd.add_argument("--ttl-hours", type=int, default=DEFAULT_TTL_HOURS)
    del_cmd.add_argument("--out", type=Path, required=True, help="write-inbox/pending directory")
    _add_parser_arg(del_cmd)

    edit_cmd = commands.add_parser("propose-edit", help="build a field-edit operation file for review")
    edit_cmd.add_argument("--root", type=Path, required=True, help="roadmap root containing the project dirs")
    edit_cmd.add_argument("--task", required=True, help="task code to edit, e.g. SYNC-1")
    edit_cmd.add_argument("--mode", required=True, choices=list(EDIT_MODES),
                          help="append: tack text onto the current description; replace: swap the whole description")
    edit_cmd.add_argument("--field", default="description", choices=list(EDIT_FIELDS),
                          help="which task field to edit (default description)")
    edit_cmd.add_argument("--text", default="", help="single line of text (appended or replacement); empty for clear")
    edit_cmd.add_argument("--reason", required=True)
    edit_cmd.add_argument("--ttl-hours", type=int, default=DEFAULT_TTL_HOURS)
    edit_cmd.add_argument("--out", type=Path, required=True, help="write-inbox/pending directory")
    _add_parser_arg(edit_cmd)

    validate_cmd = commands.add_parser("validate", help="validate an operation file")
    validate_cmd.add_argument("operation", type=Path)

    hash_cmd = commands.add_parser("hash", help="print the canonical operation hash")
    hash_cmd.add_argument("operation", type=Path)

    fixtures_cmd = commands.add_parser("init-fixtures", help="write a demo fixture tree plus sample operations")
    # Default lives OUTSIDE ~/projects so the live sync never ingests it.
    fixtures_cmd.add_argument("--out", type=Path, default=Path("~/roadmap-sync-fixtures"))
    fixtures_cmd.add_argument("--force", action="store_true", help="allow a fixture root inside ~/projects (not recommended)")
    _add_parser_arg(fixtures_cmd)

    args = parser.parse_args()
    try:
        if args.command == "propose":
            mod = load_parser(args.parser)
            operation = build_operation(mod, args.root.expanduser().resolve(), args.task, args.to, args.reason, args.ttl_hours)
            path = write_operation(operation, args.out.expanduser())
            print(f"operation: {path}")
            print(f"hash:      {operation_hash(operation)}")
            print(f"change:    {operation['change']['from']} -> {operation['change']['to']} on {operation['target']['task_id']}")
            print("next:      review it with roadmap_review.py before anything is allowed to write")
        elif args.command == "propose-delete":
            mod = load_parser(args.parser)
            operation = build_delete_operation(
                mod, args.root.expanduser().resolve(), args.task, args.reason, args.ttl_hours,
            )
            path = write_operation(operation, args.out.expanduser())
            print(f"operation: {path}")
            print(f"hash:      {operation_hash(operation)}")
            print(f"delete:    {operation['target']['task_id']} ({operation['delete']['title']}) "
                  f"from {operation['change']['from']} in {operation['target']['source_path']}")
            print("WARNING:   delete is permanent in the roadmap itself - recovery is via the "
                  "byte backup + the block kept in the receipt")
            print("next:      review it with roadmap_review.py before anything is allowed to write")
        elif args.command == "propose-edit":
            mod = load_parser(args.parser)
            operation = build_edit_operation(
                mod, args.root.expanduser().resolve(), args.task, args.mode, args.text,
                args.reason, field=args.field, ttl_hours=args.ttl_hours,
            )
            path = write_operation(operation, args.out.expanduser())
            print(f"operation: {path}")
            print(f"hash:      {operation_hash(operation)}")
            print(f"edit:      {operation['target']['task_id']} {operation['edit']['field']} ({operation['edit']['mode']}) "
                  f"in {operation['target']['source_path']}")
            print(f"  before:  {operation['edit']['before'] or '(field not present)'}")
            print(f"  after:   {operation['edit']['after'] if operation['edit']['after'] is not None else '(field removed)'}")
            print("next:      review it with roadmap_review.py before anything is allowed to write")
        elif args.command == "propose-add":
            mod = load_parser(args.parser)
            try:
                links = json.loads(args.links) if args.links else None
                conversations = json.loads(args.conversations) if args.conversations else None
            except json.JSONDecodeError as exc:
                print(f"error: --links/--conversations must be valid JSON: {exc}")
                return 2
            operation = build_add_operation(
                mod, args.root.expanduser().resolve(), args.file, args.task, args.title,
                args.effort, args.status, args.reason, args.ttl_hours, description=args.description,
                links=links, conversations=conversations,
            )
            path = write_operation(operation, args.out.expanduser())
            print(f"operation: {path}")
            print(f"hash:      {operation_hash(operation)}")
            print(f"add:       {operation['target']['task_id']} ({operation['add']['title']}) -> {operation['change']['to']} in {operation['target']['source_path']}")
            print("next:      review it with roadmap_review.py before anything is allowed to write")
        elif args.command == "validate":
            operation = load_operation(args.operation.expanduser())
            check_expiry(operation)
            check_source_path(operation["target"]["source_path"])
            print(f"valid: {args.operation}")
        elif args.command == "hash":
            print(operation_hash(load_operation(args.operation.expanduser())))
        elif args.command == "init-fixtures":
            mod = load_parser(args.parser)
            out_dir = args.out.expanduser().resolve()
            if args.force:
                written = init_fixtures(out_dir, mod, projects_root=Path("/nonexistent-no-guard"))
            else:
                written = init_fixtures(out_dir, mod)
            print(f"fixture tree: {out_dir}")
            for path in written:
                print(f"  {path.name}")
    except OperationError as exc:
        print(f"error [{exc.code}]: {exc}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

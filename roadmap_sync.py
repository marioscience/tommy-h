#!/usr/bin/env python3
"""Read-only Antigravity roadmap scanner and normalized JSON exporter."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
TASK_RE = re.compile(r"^(?P<indent>\s*)[-*+]\s+\[(?P<check>[ xX])\]\s+\*\*(?P<label>.+?)\*\*\s*$")
FIELD_RE = re.compile(r"^(?P<indent>\s*)[-*+]\s+\*\*(?P<label>[^*\n]+)\*\*\s*:\s*(?P<value>.*)$")
HEADING_RE = re.compile(r"^(?P<level>#{1,6})\s+(?P<title>.+?)\s*$")
CODE_TITLE_RE = re.compile(r"^(?P<code>[A-Za-z0-9][A-Za-z0-9_.]*?(?:-[A-Za-z0-9][A-Za-z0-9_.-]*)+)\s+-\s+(?P<title>.+)$")
EFFORT_RE = re.compile(r"(?:effort\s*:\s*)?(?P<value>\d+(?:\.\d+)?)\s*/\s*(?P<scale>\d+(?:\.\d+)?)", re.I)
CONVERSATION_RE = re.compile(r"conversation://([^\s)>]+)", re.I)
CODE_REF_RE = re.compile(r"\b[A-Z][A-Z0-9]*(?:-[A-Z0-9][A-Z0-9-]*)+\b")
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
EXCLUDED_PROJECT_DIR_NAMES = frozenset({
    "old-archive-ragenodes-rewrite",
    "ragenodes.archive",
})


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def clean_inline(value: str) -> str:
    return value.strip()


def normalize_status(raw: str, checked: bool) -> str:
    if checked:
        return "completed"
    text = raw.casefold()
    if any(word in text for word in ("complete", "completed", "done", "resolved", "verified", "deployed")):
        return "completed"
    if any(word in text for word in ("in progress", "in-progress", "active", "doing", "started")):
        return "in_progress"
    if any(word in text for word in ("blocked", "on hold", "paused")):
        return "blocked"
    if any(word in text for word in ("pending", "todo", "to do", "backlog", "planned", "open")):
        return "pending"
    return "pending"  # an unchecked Markdown task is pending unless its field says otherwise


def parse_effort(raw: str) -> dict[str, float] | None:
    match = EFFORT_RE.search(raw)
    if not match:
        return None
    return {"value": float(match.group("value")), "scale": float(match.group("scale"))}


def parse_task_label(label: str) -> tuple[str | None, str]:
    match = CODE_TITLE_RE.match(label.strip())
    if match:
        return match.group("code"), match.group("title").strip()
    return None, label.strip()


def field_key(label: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")
    return key or "field"


def is_task_start(line: str) -> bool:
    return TASK_RE.match(line) is not None


def parse_fields(lines: list[str]) -> dict[str, str]:
    """Parse labeled task fields, retaining indented multiline Markdown."""
    fields: dict[str, str] = {}
    current_key: str | None = None
    current_indent = -1
    chunks: list[str] = []

    def flush() -> None:
        nonlocal chunks
        if current_key is not None:
            value = "\n".join(chunks).strip()
            if current_key in fields and value:
                fields[current_key] = fields[current_key] + "\n" + value
            else:
                fields[current_key] = value
        chunks = []

    for line in lines:
        match = FIELD_RE.match(line)
        if match:
            flush()
            current_key = field_key(match.group("label"))
            current_indent = len(match.group("indent"))
            chunks = [match.group("value").rstrip()]
        elif current_key is not None:
            # Keep nested bullets, details, and code fences that belong to this field.
            if line.strip() == "" or len(line) - len(line.lstrip()) > current_indent:
                chunks.append(line.strip() if line.strip() else "")
            else:
                flush()
                current_key = None
                current_indent = -1
    flush()
    return fields


def parse_roadmap(path: Path, root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    stat = path.stat()
    source_sha = sha256_bytes(raw)
    relative = path.relative_to(root).as_posix()
    project = Path(relative).parts[0] if len(Path(relative).parts) > 1 else "."
    headings: list[tuple[int, str]] = []
    document_title = path.stem
    tasks: list[dict[str, Any]] = []

    # Examples inside fenced code blocks are documentation, not live tasks.
    in_fence = False
    starts: list[int] = []
    for i, line in enumerate(lines):
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            continue
        if not in_fence and is_task_start(line):
            starts.append(i)
    start_set = set(starts)
    for i, line in enumerate(lines):
        heading = HEADING_RE.match(line)
        if heading:
            level = len(heading.group("level"))
            title = heading.group("title").strip()
            if level == 1:
                document_title = title
            headings = [(n, t) for n, t in headings if n < level]
            headings.append((level, title))
        if i not in start_set:
            continue
        match = TASK_RE.match(line)
        assert match
        end = next((n for n in starts if n > i), len(lines))
        block = lines[i:end]
        code, title = parse_task_label(match.group("label"))
        fields = parse_fields(block[1:])
        checked = match.group("check").casefold() == "x"
        raw_status = fields.get("status", "")
        status = normalize_status(raw_status, checked)
        effort = parse_effort(fields.get("effort", ""))
        description = fields.get("description") or fields.get("scope") or ""
        conversations = sorted(set(CONVERSATION_RE.findall("\n".join(block))))
        links = [{"text": t, "url": u} for t, u in MARKDOWN_LINK_RE.findall("\n".join(block))]
        defect_text = "\n".join(fields.get(k, "") for k in ("tracked_defects", "resolved_defects", "related_defects"))
        defect_codes = sorted(set(CODE_REF_RE.findall(defect_text)))
        block_text = "\n".join(block).rstrip() + "\n"
        identity_seed = f"{relative}\0{code or title.casefold()}".encode()
        task_id = "task_" + hashlib.sha256(identity_seed).hexdigest()[:24]
        task: dict[str, Any] = {
            "id": task_id,
            "code": code,
            "title": title,
            "status": status,
            "checked": checked,
            "description": description,
            "effort": effort,
            "section": " > ".join(t for level, t in headings if level >= 2),
            "conversations": conversations,
            "defect_codes": defect_codes,
            "links": links,
            "fields": fields,
            "source": {
                "path": str(path),
                "relative_path": relative,
                "project": project,
                "line_start": i + 1,
                "line_end": end,
                "file_sha256": source_sha,
                "block_sha256": sha256_bytes(block_text.encode()),
                "raw_task_line": line,
            },
        }
        warnings: list[str] = []
        if code is None:
            warnings.append("task label has no recognized code")
        if checked and raw_status and status != "completed":
            warnings.append("checkbox and explicit status disagree")
        if not checked and status == "completed":
            warnings.append("unchecked checkbox and explicit completed status disagree")
        if warnings:
            task["warnings"] = warnings
        tasks.append(task)

    source = {
        "path": str(path),
        "relative_path": relative,
        "project": project,
        "document_title": document_title,
        "sha256": source_sha,
        "size_bytes": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "task_count": len(tasks),
    }
    return source, tasks


def discover(root: Path) -> list[Path]:
    """Find roadmap Markdown files while pruning invalid archived projects."""
    found: list[Path] = []
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        # Mutating dirnames in top-down mode prevents os.walk from entering these
        # trees, so archived files never reach parsing or snapshot generation.
        dirnames[:] = [
            name for name in dirnames
            if name.casefold() not in EXCLUDED_PROJECT_DIR_NAMES
        ]
        current_path = Path(current)
        for name in filenames:
            path = current_path / name
            if path.suffix.casefold() == ".md" and "roadmap" in name.casefold():
                found.append(path)
    return sorted(found, key=lambda p: p.as_posix().casefold())


def build_snapshot(root: Path) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for path in discover(root):
        try:
            source, parsed = parse_roadmap(path, root)
            sources.append(source)
            tasks.extend(parsed)
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append({"path": str(path), "error": f"{type(exc).__name__}: {exc}"})
    counts: dict[str, int] = {}
    for task in tasks:
        counts[task["status"]] = counts.get(task["status"], 0) + 1
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "read_only": True,
        "summary": {"source_count": len(sources), "task_count": len(tasks), "status_counts": counts, "error_count": len(errors)},
        "sources": sources,
        "tasks": tasks,
        "errors": errors,
    }


def atomic_write_json(output: Path, snapshot: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, output)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/home/mario/projects"))
    parser.add_argument("--output", type=Path, default=Path.home() / ".local/share/roadmap-sync/roadmap-status.json")
    parser.add_argument("--stdout", action="store_true", help="write snapshot to stdout instead of a file")
    parser.add_argument("--strict", action="store_true", help="exit nonzero if any matching file cannot be parsed")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"root is not a directory: {root}")
    snapshot = build_snapshot(root)
    if args.stdout:
        json.dump(snapshot, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
        print()
    else:
        output = args.output.expanduser().resolve()
        atomic_write_json(output, snapshot)
        print(f"Wrote {snapshot['summary']['task_count']} tasks from {snapshot['summary']['source_count']} files to {output}")
    return 2 if args.strict and snapshot["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Chat-approved roadmap operation batches: canonical form, Ed25519 signature, verification.

The chat approval replaces the interactive y/N gate for the timer-driven flow
(m4.2). Mario approves one itemized list in WhatsApp; the agent signs the exact
batch bytes (every op, in order) with the chat-approval private key; this module
verifies that signature on his machine before anything is allowed to write.
The public key ships in the release; the private key never does.

A signed batch is still only data: after verification the poller builds each
operation fresh against the live tree at its turn, the normal review gate must
say APPLICABLE, the standard applier does the write (lock, byte backup, atomic
write, receipt, rollback on verify failure), and a final snapshot delta check
must show exactly the approved set of changes and nothing else.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATUSES = {"pending", "in_progress", "completed"}
DEFAULT_TTL_HOURS = 24
MAX_TTL_HOURS = 48
MAX_OPS_PER_BATCH = 20
SIGNER_ID = "instinct-chat-approval-ed25519"
KIND_SET = "set_status"
KIND_ADD = "add_task"
KIND_DEL = "delete_task"
KIND_EDIT = "edit_task"
EDIT_MODES = ("append", "replace")


class ChatOpError(Exception):
    def __init__(self, msg: str, code: str = "MALFORMED"):
        super().__init__(msg)
        self.code = code


def canonical_bytes(obj) -> bytes:
    """The exact bytes the signature binds. Key order and spacing are fixed and
    array order is preserved, so the op sequence is part of the signed content."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def batch_sha256(batch: dict) -> str:
    return hashlib.sha256(canonical_bytes(batch)).hexdigest()


def _parse_ts(value) -> datetime:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise ChatOpError(f"unparseable timestamp: {value!r}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _require(cond: bool, msg: str, code: str = "MALFORMED"):
    if not cond:
        raise ChatOpError(msg, code=code)


def validate_request(request) -> dict:
    _require(isinstance(request, dict), "each op must be a JSON object")
    kind = request.get("kind")
    _require(kind in (KIND_SET, KIND_ADD, KIND_DEL, KIND_EDIT), f"unknown kind: {kind!r}")
    code = request.get("code")
    _require(isinstance(code, str) and code.strip(), "op.code missing")
    if kind == KIND_SET:
        to = request.get("to")
        _require(to in STATUSES, f"op.to must be one of {sorted(STATUSES)}, got {to!r}")
        frm = request.get("from")
        _require(frm is None or frm in STATUSES, f"op.from must be a status or absent, got {frm!r}")
    elif kind == KIND_DEL:
        frm = request.get("from")
        _require(frm is None or frm in STATUSES, f"op.from must be a status or absent, got {frm!r}")
    elif kind == KIND_EDIT:
        mode = request.get("mode")
        _require(mode in EDIT_MODES, f"op.mode must be one of {list(EDIT_MODES)}, got {mode!r}")
        text = request.get("text")
        _require(isinstance(text, str) and text.strip() and "\n" not in text,
                 "op.text must be a single non-empty line")
        frm = request.get("from")
        _require(frm is None or frm in STATUSES, f"op.from must be a status or absent, got {frm!r}")
    else:
        sp = request.get("source_path")
        _require(isinstance(sp, str) and sp.strip(), "op.source_path missing")
        _require(not sp.startswith("/") and ".." not in sp.split("/"),
                 f"source_path must stay inside the root: {sp!r}")
        _require(isinstance(request.get("title"), str) and request["title"].strip(),
                 "op.title missing")
        effort = request.get("effort")
        _require(isinstance(effort, (int, float)) and not isinstance(effort, bool)
                 and 0 <= effort <= 10, f"op.effort must be 0..10, got {effort!r}")
        _require(request.get("status") in STATUSES,
                 f"op.status must be one of {sorted(STATUSES)}")
        links = request.get("links")
        if links is not None:
            _require(isinstance(links, list), "op.links must be a list")
            for entry in links:
                _require(isinstance(entry, dict) and set(entry) == {"text", "url"}
                         and all(isinstance(v, str) and v.strip() and "\n" not in v
                                 for v in entry.values()),
                         f"op.links entries are {{text, url}} single-line strings: {entry!r}")
        conversations = request.get("conversations")
        if conversations is not None:
            _require(isinstance(conversations, list) and conversations
                     and all(isinstance(v, str) and v.strip() and "\n" not in v
                             for v in conversations),
                     "op.conversations must be a non-empty list of single-line strings")
    return request


def validate_batch(batch) -> dict:
    _require(isinstance(batch, dict), "batch must be a JSON object")
    _require(isinstance(batch.get("batch_id"), str) and batch["batch_id"].strip(),
             "batch.batch_id missing")
    _parse_ts(batch.get("created_at", ""))
    ops = batch.get("ops")
    _require(isinstance(ops, list) and 1 <= len(ops) <= MAX_OPS_PER_BATCH,
             f"batch.ops must hold 1..{MAX_OPS_PER_BATCH} operations")
    seen = set()
    for i, op in enumerate(ops):
        validate_request(op)
        code = op["code"]
        _require(code not in seen, f"duplicate code in batch: {code} (op #{i + 1})")
        seen.add(code)
    return batch


def validate_approval(approval) -> dict:
    _require(isinstance(approval, dict), "approval must be a JSON object")
    digest = approval.get("batch_sha256")
    _require(isinstance(digest, str) and len(digest) == 64
             and all(c in "0123456789abcdef" for c in digest),
             "approval.batch_sha256 must be a lowercase sha256 hex")
    _require(isinstance(approval.get("signature"), str) and approval["signature"],
             "approval.signature missing")
    _parse_ts(approval.get("approved_at", ""))
    return approval


def load_chat_batch(path: Path) -> tuple[dict, dict]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ChatOpError(f"cannot parse {Path(path).name}: {exc}")
    _require(isinstance(data, dict), "file must hold one JSON object")
    batch = validate_batch(data.get("batch"))
    approval = validate_approval(data.get("approval"))
    return batch, approval


def check_ttl(approval: dict, now: datetime | None = None):
    now = now or utc_now()
    approved_at = _parse_ts(approval["approved_at"])
    _require(approved_at <= now + timedelta(minutes=5),
             f"approval timestamp is in the future: {approval['approved_at']}")
    ttl = approval.get("ttl_hours", DEFAULT_TTL_HOURS)
    _require(isinstance(ttl, (int, float)) and not isinstance(ttl, bool)
             and 0 < ttl <= MAX_TTL_HOURS, f"ttl_hours out of range: {ttl!r}")
    if now - approved_at > timedelta(hours=ttl):
        raise ChatOpError(f"approval is older than its {ttl}h ttl", code="EXPIRED")


def _openssl(*args: str) -> subprocess.CompletedProcess:
    if shutil.which("openssl") is None:
        raise ChatOpError("openssl not found on PATH", code="NO_OPENSSL")
    return subprocess.run(["openssl", *args], capture_output=True)


def sign_batch(batch: dict, key_path: Path, message_ref: str,
               approved_via: str = "whatsapp", now: datetime | None = None) -> dict:
    """Agent side: sign the canonical batch bytes; returns the approval object.
    One signature covers every op in the batch, in order."""
    validate_batch(batch)
    now = now or utc_now()
    data = canonical_bytes(batch)
    with tempfile.NamedTemporaryFile() as tmp:
        tmp.write(data)
        tmp.flush()
        proc = _openssl("pkeyutl", "-sign", "-inkey", str(key_path), "-rawin", "-in", tmp.name)
    if proc.returncode != 0:
        raise ChatOpError(f"openssl sign failed: {proc.stderr.decode(errors='replace').strip()}",
                          code="SIGN_FAILED")
    return {
        "batch_sha256": batch_sha256(batch),
        "signature": base64.b64encode(proc.stdout).decode("ascii"),
        "signer": SIGNER_ID,
        "approved_at": now.isoformat(timespec="seconds"),
        "approved_via": approved_via,
        "message_ref": message_ref,
        "ttl_hours": DEFAULT_TTL_HOURS,
    }


def verify_signature(batch: dict, approval: dict, pubkey_path: Path):
    """Local side: the batch it is about to run must be byte-identical to what
    was approved in chat, and the signature must verify against the shipped
    public key."""
    digest = batch_sha256(batch)
    if digest != approval.get("batch_sha256"):
        raise ChatOpError("approval hash does not match the batch bytes", code="HASH_MISMATCH")
    try:
        sig = base64.b64decode(approval["signature"], validate=True)
    except (ValueError, TypeError):
        raise ChatOpError("approval.signature is not valid base64", code="BAD_SIGNATURE")
    data = canonical_bytes(batch)
    with tempfile.NamedTemporaryFile() as msg, tempfile.NamedTemporaryFile() as sigf:
        msg.write(data)
        msg.flush()
        sigf.write(sig)
        sigf.flush()
        proc = _openssl("pkeyutl", "-verify", "-pubin", "-inkey", str(pubkey_path),
                        "-rawin", "-in", msg.name, "-sigfile", sigf.name)
    if proc.returncode != 0:
        raise ChatOpError("signature verification failed", code="BAD_SIGNATURE")


def verify_chat_batch(path: Path, pubkey_path: Path) -> tuple[dict, dict]:
    batch, approval = load_chat_batch(path)
    check_ttl(approval)
    verify_signature(batch, approval, pubkey_path)
    return batch, approval


def check_delta(before_path: Path, after_path: Path,
                sets: list[tuple[str, str]], adds: list[tuple[str, str]],
                dels: list[str] | None = None,
                edits: list[tuple[str, str]] | None = None) -> bool:
    """Batch generalization of the single-delta check: the observed delta across
    the whole tree must be exactly the approved set of changes, nothing else.
    Statuses AND descriptions are compared, so a description edit is a delta."""
    before = {t["code"]: (t["status"], t.get("description") or "")
              for t in json.loads(Path(before_path).read_text())["tasks"]}
    after = {t["code"]: (t["status"], t.get("description") or "")
             for t in json.loads(Path(after_path).read_text())["tasks"]}
    edits = edits or []
    edit_codes = {c for c, _ in edits}
    # status delta, excluding pure description edits
    changed = {c: (before.get(c, (None,))[0], after.get(c, (None,))[0])
               for c in set(before) | set(after)
               if before.get(c, (None,))[0] != after.get(c, (None,))[0]}
    expected: dict = {}
    for code, to in sets:
        expected[code] = (before.get(code, (None,))[0], to)
    for code, to in adds:
        expected[code] = (None, to)
    for code in dels or []:
        expected[code] = (before.get(code, (None,))[0], None)
    desc_changed = {c: (before.get(c, (None, ""))[1], after.get(c, (None, ""))[1])
                    for c in set(before) & set(after)
                    if before[c][1] != after[c][1]}
    expected_desc = {c: (before.get(c, (None, ""))[1], txt) for c, txt in edits}
    ok = (changed == expected and desc_changed == expected_desc
          and all(c in before for c, _ in sets)
          and all(c in before for c in dels or [])
          and all(c in before and c in after for c in edit_codes)
          and not edit_codes & {c for c, _ in sets}
          and not edit_codes & {c for c, _ in adds}
          and not edit_codes & set(dels or []))
    total = len(expected) + len(expected_desc)
    if ok:
        print(f"exactly the approved {total} change(s): "
              + ", ".join([f"{c} {f} -> {t}" for c, (f, t) in expected.items()]
                          + [f"{c} description edited" for c in expected_desc]))
    else:
        print(f"FAIL: expected status delta {expected}, observed {changed}; "
              f"expected description delta {expected_desc}, observed {desc_changed}", file=sys.stderr)
    return ok


def _tsv_safe(value) -> str:
    return " ".join(str(value).split())


EMPTY = "-"  # sentinel: consecutive tabs would collapse as IFS whitespace


def op_lines(batch: dict, approval: dict) -> str:
    """One TSV line per op, in signed order:
    idx  kind  code  to  from  source_path  title  effort  status  description  message_ref
    Empty fields carry the EMPTY sentinel so the shell read keeps alignment."""
    ref = approval.get("message_ref") or EMPTY
    lines = []
    for i, op in enumerate(batch["ops"]):
        if op["kind"] == KIND_EDIT:
            row = [i + 1, KIND_EDIT, op["code"], op["mode"], op.get("from") or EMPTY,
                   EMPTY, EMPTY, EMPTY, EMPTY, _tsv_safe(op["text"])]
        elif op["kind"] == KIND_DEL:
            row = [i + 1, KIND_DEL, op["code"], EMPTY, op.get("from") or EMPTY,
                   EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]
        elif op["kind"] == KIND_SET:
            row = [i + 1, KIND_SET, op["code"], op["to"], op.get("from") or EMPTY,
                   EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]
        else:
            row = [i + 1, KIND_ADD, op["code"], EMPTY, EMPTY,
                   op["source_path"], _tsv_safe(op["title"]), str(op["effort"]),
                   op["status"], _tsv_safe(op.get("description") or EMPTY)]
        lines.append("\t".join(str(v) for v in [*row, ref]))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    sign_cmd = commands.add_parser("sign", help="agent side: sign a batch JSON ({batch_id, created_at, ops:[...]})")
    sign_cmd.add_argument("--batch", type=Path, required=True)
    sign_cmd.add_argument("--key", type=Path, required=True)
    sign_cmd.add_argument("--message-ref", required=True,
                          help="the chat message id of Mario's yes (user evidence)")
    sign_cmd.add_argument("--approved-via", default="whatsapp")
    sign_cmd.add_argument("--out", type=Path, required=True)

    verify_cmd = commands.add_parser("verify", help="local side: verify a combined chat batch")
    verify_cmd.add_argument("file", type=Path)
    verify_cmd.add_argument("--pubkey", type=Path, required=True)

    ops_cmd = commands.add_parser("ops", help="print one TSV line per op, in signed order")
    ops_cmd.add_argument("file", type=Path)

    delta_cmd = commands.add_parser("check-delta", help="assert the snapshot delta is exactly the approved set")
    delta_cmd.add_argument("--before", type=Path, required=True)
    delta_cmd.add_argument("--after", type=Path, required=True)
    delta_cmd.add_argument("--set", dest="sets", action="append", default=[],
                           metavar="CODE:TO", help="expected status flip; repeatable")
    delta_cmd.add_argument("--add", dest="adds", action="append", default=[],
                           metavar="CODE:STATUS", help="expected added task; repeatable")
    delta_cmd.add_argument("--del", dest="dels", action="append", default=[],
                           metavar="CODE", help="expected removed task; repeatable")
    delta_cmd.add_argument("--edit", dest="edits", action="append", default=[],
                           metavar="CODE:AFTER", help="expected description edit: code plus the exact full "
                           "description text after the edit; repeatable")

    args = parser.parse_args()
    try:
        if args.command == "sign":
            batch = validate_batch(json.loads(args.batch.read_text(encoding="utf-8")))
            approval = sign_batch(batch, args.key, args.message_ref, args.approved_via)
            combined = {"batch": batch, "approval": approval}
            args.out.write_text(json.dumps(combined, indent=2, ensure_ascii=False) + "\n",
                                encoding="utf-8")
            print(f"signed: {args.out}")
            print(f"hash:   {approval['batch_sha256']}")
            print(f"ops:    {len(batch['ops'])}")
            return 0
        if args.command == "verify":
            batch, _ = verify_chat_batch(args.file, args.pubkey)
            print(f"verified: signature valid, approval fresh, {len(batch['ops'])} op(s)")
            return 0
        if args.command == "ops":
            batch, approval = load_chat_batch(args.file)
            print(op_lines(batch, approval))
            return 0
        if args.command == "check-delta":
            def split(pair):
                code, _, to = pair.partition(":")
                if not code or not to:
                    raise ChatOpError(f"bad --set/--add value: {pair!r}")
                return code, to
            sets = [split(p) for p in args.sets]
            adds = [split(p) for p in args.adds]
            dels = [c for c in args.dels if c]
            edits = []
            for pair in args.edits:
                code, _, txt = pair.partition(":")
                if not code or not txt:
                    raise ChatOpError(f"bad --edit value: {pair!r}")
                edits.append((code, txt))
            if not sets and not adds and not dels and not edits:
                raise ChatOpError("check-delta needs at least one --set, --add, --del or --edit")
            return 0 if check_delta(args.before, args.after, sets, adds, dels, edits) else 1
    except ChatOpError as exc:
        print(f"error [{exc.code}]: {exc}", file=sys.stderr)
        return {"EXPIRED": 4, "HASH_MISMATCH": 2, "BAD_SIGNATURE": 2}.get(exc.code, 3)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

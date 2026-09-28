#!/usr/bin/env python3
"""Suite for the chat-approval layer (m4.2): canonicalization, signature
roundtrip, tamper and expiry rejection, batch schema rules, and the batch
delta check. Uses a throwaway Ed25519 keypair generated per run."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import contextlib
import io
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

import importlib.util  # noqa: E402
import os  # noqa: E402

_LIB = Path(os.environ.get("ROADMAP_SYNC_LIB", "~/.local/lib/roadmap-sync")).expanduser()
_CANDIDATES = [_LIB / "chat_ops.py", Path(__file__).resolve().parent / "chat_ops.py"]
_PATH = next((p for p in _CANDIDATES if p.is_file()), _CANDIDATES[-1])
_spec = importlib.util.spec_from_file_location("chat_ops", _PATH)
co = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(co)


def sample_batch() -> dict:
    return {
        "batch_id": "batch-test-1",
        "created_at": "2026-09-22T22:00:00+00:00",
        "ops": [
            {"kind": "add_task", "source_path": "proj/ROADMAP.md", "code": "TEST-1",
             "title": "Throwaway", "effort": 0, "status": "pending",
             "description": "safe to ignore"},
            {"kind": "set_status", "code": "SYNC-1", "to": "completed", "from": "in_progress"},
            {"kind": "set_status", "code": "HOBBY-01", "to": "in_progress"},
        ],
    }


def check_delta_quiet(*args):
    """check_delta prints FAIL:/exactly-the-approved diagnostics for the ops
    log; in the suite the return value is the assertion, and the FAIL: lines
    from negative cases read exactly like real test failures. Keep them quiet."""
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return co.check_delta(*args)


class CanonicalTests(unittest.TestCase):
    def test_key_order_invariant(self):
        a = {"b": 1, "a": {"y": 2, "x": 1}}
        b = {"a": {"x": 1, "y": 2}, "b": 1}
        self.assertEqual(co.canonical_bytes(a), co.canonical_bytes(b))

    def test_array_order_is_content(self):
        a = co.canonical_bytes({"ops": [1, 2]})
        b = co.canonical_bytes({"ops": [2, 1]})
        self.assertNotEqual(a, b)

    def test_hash_stable(self):
        self.assertEqual(co.batch_sha256(sample_batch()), co.batch_sha256(sample_batch()))


class SchemaTests(unittest.TestCase):
    def test_valid_batch_passes(self):
        co.validate_batch(sample_batch())

    def test_duplicate_code_rejected(self):
        b = sample_batch()
        b["ops"].append({"kind": "set_status", "code": "SYNC-1", "to": "pending"})
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_empty_batch_rejected(self):
        with self.assertRaises(co.ChatOpError):
            co.validate_batch({"batch_id": "x", "created_at": "2026-01-01T00:00:00+00:00", "ops": []})

    def test_bad_status_rejected(self):
        b = sample_batch()
        b["ops"][1]["to"] = "done-ish"
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_effort_range(self):
        b = sample_batch()
        b["ops"][0]["effort"] = 11
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_source_path_traversal_rejected(self):
        b = sample_batch()
        b["ops"][0]["source_path"] = "../outside/ROADMAP.md"
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)
        b["ops"][0]["source_path"] = "/abs/ROADMAP.md"
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_from_must_be_status(self):
        b = sample_batch()
        b["ops"][1]["from"] = "wherever"
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)


@unittest.skipIf(shutil.which("openssl") is None, "openssl required")
class SignatureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="chat-ops-test-"))
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519",
                        "-out", str(self.tmp / "priv.pem")],
                       check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(self.tmp / "priv.pem"),
                        "-pubout", "-out", str(self.tmp / "pub.pem")],
                       check=True, capture_output=True)

    def test_roundtrip(self):
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        co.verify_signature(batch, approval, self.tmp / "pub.pem")

    def test_tampered_op_rejected(self):
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        batch["ops"][1]["to"] = "pending"   # attacker flips the approved target
        with self.assertRaises(co.ChatOpError) as ctx:
            co.verify_signature(batch, approval, self.tmp / "pub.pem")
        self.assertEqual(ctx.exception.code, "HASH_MISMATCH")

    def test_reordered_ops_rejected(self):
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        batch["ops"] = list(reversed(batch["ops"]))
        with self.assertRaises(co.ChatOpError):
            co.verify_signature(batch, approval, self.tmp / "pub.pem")

    def test_forged_signature_rejected(self):
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        raw = bytearray(base64.b64decode(approval["signature"]))
        raw[0] ^= 0xFF
        approval["signature"] = base64.b64encode(bytes(raw)).decode()
        with self.assertRaises(co.ChatOpError) as ctx:
            co.verify_signature(batch, approval, self.tmp / "pub.pem")
        self.assertEqual(ctx.exception.code, "BAD_SIGNATURE")

    def test_wrong_key_rejected(self):
        other = self.tmp / "other"
        other.mkdir()
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519",
                        "-out", str(other / "priv.pem")], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(other / "priv.pem"),
                        "-pubout", "-out", str(other / "pub.pem")], check=True, capture_output=True)
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        with self.assertRaises(co.ChatOpError):
            co.verify_signature(batch, approval, other / "pub.pem")

    def test_combined_file_roundtrip_and_expiry(self):
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        combined = self.tmp / "op.json"
        combined.write_text(json.dumps({"batch": batch, "approval": approval}))
        co.verify_chat_batch(combined, self.tmp / "pub.pem")

        stale = dict(approval)
        stale["approved_at"] = (co.utc_now() - timedelta(hours=25)).isoformat(timespec="seconds")
        combined.write_text(json.dumps({"batch": batch, "approval": stale}))
        with self.assertRaises(co.ChatOpError) as ctx:
            co.verify_chat_batch(combined, self.tmp / "pub.pem")
        self.assertEqual(ctx.exception.code, "EXPIRED")

    def test_verify_cli_exit_codes(self):
        batch = sample_batch()
        approval = co.sign_batch(batch, self.tmp / "priv.pem", "wamid.TEST")
        good = self.tmp / "good.json"
        good.write_text(json.dumps({"batch": batch, "approval": approval}))
        rc = co.main.__wrapped__ if hasattr(co.main, "__wrapped__") else None
        out = subprocess.run([sys.executable, str(Path(co.__file__)), "verify", str(good),
                              "--pubkey", str(self.tmp / "pub.pem")], capture_output=True)
        self.assertEqual(out.returncode, 0, out.stderr.decode())
        bad = self.tmp / "bad.json"
        bad.write_text(json.dumps({"batch": {**batch, "batch_id": "swapped"},
                                   "approval": approval}))
        out = subprocess.run([sys.executable, str(Path(co.__file__)), "verify", str(bad),
                              "--pubkey", str(self.tmp / "pub.pem")], capture_output=True)
        self.assertEqual(out.returncode, 2, out.stderr.decode())


class DeltaTests(unittest.TestCase):
    def _write(self, tasks):
        fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"tasks": [{"code": c, "status": s} for c, s in tasks]}, fh)
        fh.close()
        return Path(fh.name)

    def test_batch_delta_ok(self):
        before = self._write([("A", "pending"), ("B", "in_progress"), ("C", "pending")])
        after = self._write([("A", "completed"), ("B", "in_progress"), ("C", "pending"),
                             ("NEW-1", "pending")])
        self.assertTrue(check_delta_quiet(before, after, [("A", "completed")], [("NEW-1", "pending")]))

    def test_extra_change_fails(self):
        before = self._write([("A", "pending"), ("B", "in_progress")])
        after = self._write([("A", "completed"), ("B", "pending")])
        self.assertFalse(check_delta_quiet(before, after, [("A", "completed")], []))

    def test_missing_change_fails(self):
        before = self._write([("A", "pending"), ("B", "in_progress")])
        after = self._write([("A", "pending"), ("B", "in_progress")])
        self.assertFalse(check_delta_quiet(before, after, [("A", "completed")], []))

    def test_partial_batch_delta(self):
        # two of three approved ops applied: the check runs on the applied set
        before = self._write([("A", "pending"), ("B", "pending"), ("C", "pending")])
        after = self._write([("A", "completed"), ("B", "completed"), ("C", "pending")])
        self.assertTrue(check_delta_quiet(before, after, [("A", "completed"), ("B", "completed")], []))


class OpLinesTests(unittest.TestCase):
    def test_order_and_shape(self):
        batch = sample_batch()
        approval = {"message_ref": "wamid.X"}
        lines = co.op_lines(batch, approval).splitlines()
        self.assertEqual(len(lines), 3)
        first = lines[0].split("\t")
        self.assertEqual(first[1], "add_task")
        self.assertEqual(first[2], "TEST-1")
        self.assertEqual(first[5], "proj/ROADMAP.md")
        second = lines[1].split("\t")
        self.assertEqual(second[1], "set_status")
        self.assertEqual(second[2], "SYNC-1")
        self.assertEqual(second[3], "completed")
        self.assertEqual(second[4], "in_progress")
        self.assertEqual(second[-1], "wamid.X")

    def test_no_empty_fields(self):
        # consecutive tabs collapse under shell IFS - every field must be non-empty
        batch = sample_batch()
        batch["ops"][0]["description"] = None
        batch["ops"][2]["from"] = None
        co.validate_batch(batch)
        for line in co.op_lines(batch, {}).splitlines():
            fields = line.split("\t")
            self.assertEqual(len(fields), 11)
            for f in fields:
                self.assertTrue(f, "empty field would break shell parsing")


class DeleteTests(unittest.TestCase):
    def test_delete_op_valid(self):
        b = sample_batch()
        b["ops"].append({"kind": "delete_task", "code": "OLD-7", "from": "pending"})
        co.validate_batch(b)

    def test_delete_from_must_be_status(self):
        b = sample_batch()
        b["ops"].append({"kind": "delete_task", "code": "TEST-9", "from": "gone"})
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_delete_duplicate_code_rejected(self):
        b = sample_batch()
        b["ops"].append({"kind": "delete_task", "code": "SYNC-1"})
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_op_lines_delete_row(self):
        batch = {"batch_id": "b", "created_at": "2026-01-01T00:00:00+00:00",
                 "ops": [{"kind": "delete_task", "code": "GONE-1", "from": "pending"}]}
        co.validate_batch(batch)
        fields = co.op_lines(batch, {"message_ref": "wamid.Y"}).splitlines()[0].split("\t")
        self.assertEqual(len(fields), 11)
        self.assertEqual(fields[1], "delete_task")
        self.assertEqual(fields[2], "GONE-1")
        self.assertEqual(fields[3], "-")          # no `to`
        self.assertEqual(fields[4], "pending")    # from pin
        self.assertEqual(fields[-1], "wamid.Y")
        for f in fields:
            self.assertTrue(f)

    def test_delta_with_delete(self):
        h = DeltaTests()
        before = h._write([("A", "pending"), ("B", "pending")])
        after = h._write([("A", "pending")])
        self.assertTrue(check_delta_quiet(before, after, [], [], ["B"]))
        self.assertFalse(check_delta_quiet(before, after, [], [], []))
        self.assertFalse(check_delta_quiet(before, after, [], [], ["NOPE"]))


class EditTaskTests(unittest.TestCase):
    def test_edit_op_valid(self):
        b = sample_batch()
        b["ops"].append({"kind": "edit_task", "code": "OLD-3", "mode": "append",
                         "text": "documented caveat"})
        co.validate_batch(b)

    def test_edit_bad_mode_rejected(self):
        b = sample_batch()
        b["ops"].append({"kind": "edit_task", "code": "OLD-3", "mode": "tweak", "text": "x"})
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_edit_text_must_be_single_line(self):
        b = sample_batch()
        b["ops"].append({"kind": "edit_task", "code": "OLD-3", "mode": "replace", "text": "a\nb"})
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)
        b["ops"][-1]["text"] = "   "
        with self.assertRaises(co.ChatOpError):
            co.validate_batch(b)

    def test_op_lines_edit_row(self):
        batch = {"batch_id": "b", "created_at": "2026-01-01T00:00:00+00:00",
                 "ops": [{"kind": "edit_task", "code": "SYNC-9", "mode": "append",
                          "text": "note about backups"}]}
        co.validate_batch(batch)
        fields = co.op_lines(batch, {"message_ref": "wamid.Z"}).splitlines()[0].split("\t")
        self.assertEqual(len(fields), 11)
        self.assertEqual(fields[1], "edit_task")
        self.assertEqual(fields[2], "SYNC-9")
        self.assertEqual(fields[3], "append")          # mode rides the to-slot
        self.assertEqual(fields[9], "note about backups")
        for f in fields:
            self.assertTrue(f)

    def test_delta_with_edit(self):
        h = DeltaTests()
        before = h._write([("A", "pending"), ("B", "pending")])
        after = h._write([("A", "pending"), ("B", "pending")])
        import json as _json
        # description-only change on B
        b_tasks = _json.loads(before.read_text()); a_tasks = _json.loads(after.read_text())
        b_tasks["tasks"][1]["description"] = "old text"
        a_tasks["tasks"][1]["description"] = "old text plus caveat"
        before.write_text(_json.dumps(b_tasks)); after.write_text(_json.dumps(a_tasks))
        self.assertTrue(check_delta_quiet(before, after, [], [], [], [("B", "old text plus caveat")]))
        self.assertFalse(check_delta_quiet(before, after, [], [], [], []))
        self.assertFalse(check_delta_quiet(before, after, [], [], [], [("B", "wrong text")]))
        # an edit must not double as a set
        self.assertFalse(check_delta_quiet(before, after, [("B", "pending")], [], [],
                                        [("B", "old text plus caveat")]))


    def test_add_with_links_and_conversations_validates(self):
        batch = {
            "batch_id": "b1",
            "created_at": "2026-09-23T08:00:00Z",
            "ops": [{
                "kind": "add_task", "code": "X-1", "source_path": "proj/A_ROADMAP.md",
                "title": "t", "effort": 2, "status": "pending",
                "links": [{"text": "Y-1", "url": "file:///x/Y_ROADMAP.md"}],
                "conversations": ["123e4567-e89b-42d3-a456-426614174000"],
            }],
        }
        co.validate_batch(batch)

    def test_add_with_bad_links_rejected(self):
        for bad in ([{"text": "no-url"}], [{"text": "a", "url": "b", "extra": 1}],
                    [{"text": "a\nb", "url": "u"}]):
            batch = {
                "batch_id": "b1", "created_at": "2026-09-23T08:00:00Z",
                "ops": [{"kind": "add_task", "code": "X-1", "source_path": "p/A_ROADMAP.md",
                         "title": "t", "effort": 2, "status": "pending", "links": bad}],
            }
            with self.assertRaises(co.ChatOpError):
                co.validate_batch(batch)

    def test_add_with_bad_conversations_rejected(self):
        for bad in ([], ["two\nlines"], [""], "not-a-list"):
            batch = {
                "batch_id": "b1", "created_at": "2026-09-23T08:00:00Z",
                "ops": [{"kind": "add_task", "code": "X-1", "source_path": "p/A_ROADMAP.md",
                         "title": "t", "effort": 2, "status": "pending", "conversations": bad}],
            }
            with self.assertRaises(co.ChatOpError):
                co.validate_batch(batch)

if __name__ == "__main__":
    unittest.main(verbosity=2)

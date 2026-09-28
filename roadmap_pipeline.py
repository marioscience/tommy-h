import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
from datetime import datetime, timezone
from pathlib import Path

# Load roadmap-sync libraries
LIB_DIR = Path(os.environ.get("ROADMAP_SYNC_LIB", "~/.local/lib/roadmap-sync")).expanduser()
sys.path.insert(0, str(LIB_DIR))
import chat_ops as co
import roadmap_apply as ap
import roadmap_review as rv
import roadmap_sync as sync
import roadmap_write as rw

CONFIG_FILE = "roadmap-apply.toml"
LEDGER_FILE = "ops/state.json"

def get_config(root: Path):
    config_path = root / CONFIG_FILE
    if not config_path.exists():
        return {
            "schema_version": 1,
            "inbox_dir": str(root / "ops/inbox"),
            "archive_dir": str(root / "ops/archive"),
            "receipt_dir": str(root / "ops/receipts"),
            "backup_dir": str(root / "ops/backups"),
            "snapshot_path": str(root / "ops/snapshot.json"),
            "signing": True,
            "key_path": "~/.local/lib/roadmap-sync/keys/agent.key",
            "git_auto_commit": True,
            "drive_push": True,
            "post_apply_hooks": [],
            "drive_remote": "gdrive:Antigravity-Roadmap-Sync/chat-ops-inbox"
        }
    with open(config_path, "rb") as f:
        conf = tomllib.load(f)
    # validate keys
    allowed_keys = {
        "schema_version", "inbox_dir", "archive_dir", "receipt_dir", "backup_dir", 
        "snapshot_path", "signing", "key_path", "git_auto_commit", "drive_push", "post_apply_hooks",
        "drive_remote"
    }
    unknown = set(conf.keys()) - allowed_keys
    if unknown:
        print(f"Validation error: Unknown config keys: {unknown}", file=sys.stderr)
        sys.exit(2)
    return conf

def ensure_dirs(conf, root: Path):
    for k in ["inbox_dir", "archive_dir", "receipt_dir", "backup_dir"]:
        path = conf.get(k, str(root / f"ops/{k.split('_')[0]}"))
        Path(path).mkdir(parents=True, exist_ok=True)
    (root / LEDGER_FILE).parent.mkdir(parents=True, exist_ok=True)

def load_ledger(root: Path):
    ledger_path = root / LEDGER_FILE
    if not ledger_path.exists():
        return {}
    try:
        with open(ledger_path, "r") as f:
            data = json.load(f)
        if "schema_version" not in data:
            print(f"Migrating legacy ledger {ledger_path.name} to v1...")
            shutil.copy2(ledger_path, str(ledger_path) + ".bak")
            v1_data = {"schema_version": 1, "state": data}
            write_ledger(v1_data, root)
            return v1_data["state"]
        return data.get("state", {})
    except json.JSONDecodeError:
        print("Fatal: corrupt ledger", file=sys.stderr)
        sys.exit(3)

def write_ledger(state_dict, root: Path):
    ledger_path = root / LEDGER_FILE
    tmp = str(ledger_path) + ".tmp"
    v1_data = state_dict if state_dict.get("schema_version") == 1 else {"schema_version": 1, "state": state_dict}
    with open(tmp, "w") as f:
        json.dump(v1_data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, ledger_path)

def batch_sha256(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()

def pull_ops(conf, quiet=False):
    remote = conf.get("drive_remote", "drive:roadmap-ops/inbox")
    if not quiet:
        print(f"Pulling ops from {remote}...")
    subprocess.run(["rclone", "copy", remote, conf["inbox_dir"]], check=False)

def run_verify(conf, root: Path):
    print("Verifying state...")
    # regenerate snapshot
    snap = sync.build_snapshot(root)
    # compare snap against markdown parse
    # Actually just building snapshot does this.
    print(f"Snapshot tasks: {snap['summary']['task_count']}")
    
def do_apply_batch(batch_bytes: bytes, file_path: Path, conf: dict, root: Path, dry_run=False, yes=False, quiet=False):
    batch_hash = batch_sha256(batch_bytes)
    ledger = load_ledger(root)
    if batch_hash in ledger:
        if not quiet:
            print(f"Skipping {file_path.name}: already applied.")
        return True

    batch = json.loads(batch_bytes)
    # validate schema
    try:
        co.validate_batch(batch)
    except Exception as e:
        print(f"Validation error in {file_path.name}: {e}", file=sys.stderr)
        # quarantine
        quarantine_dir = root / Path("ops/quarantine")
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        os.replace(file_path, quarantine_dir / file_path.name)
        return False

    # build single operations
    ops = []
    mod = sync
    try:
        for request in batch["ops"]:
            # dry run diff building happens via rv.preview
            code = request["code"]
            if request["kind"] == "add_task":
                op = rw.build_add_operation(mod, root, request["source_path"], code, request["title"], request["effort"], request["status"], "pipeline add", description=request.get("description"))
            elif request["kind"] == "delete_task":
                op = rw.build_delete_operation(mod, root, code, "pipeline delete")
            elif request["kind"] == "edit_task":
                op = rw.build_edit_operation(mod, root, code, request["mode"], request["text"], "pipeline edit")
            elif request["kind"] == "set_status":
                op = rw.build_operation(mod, root, code, request["to"], "pipeline set status")
            ops.append(op)
    except Exception as e:
        print(f"Validation failure building ops: {e}", file=sys.stderr)
        return False

    # dry-run diff
    diffs = []
    for op in ops:
        try:
            old_text = (root / op["target"]["source_path"]).read_text(encoding="utf-8")
            if op["action"] == rw.ACTION_ADD_TASK:
                new_text = rv.render_add_task(old_text, op["target"]["task_id"], op["add"], op["change"]["to"])
            elif op["action"] == rw.ACTION_DELETE_TASK:
                _, task = rw.resolve_unique_task(mod, root, op)
                new_text = rv.render_delete_task(old_text, task)
            elif op["action"] == rw.ACTION_EDIT_TASK:
                _, task = rw.resolve_unique_task(mod, root, op)
                new_text = rv.render_field_edit(old_text, task, mod, op["edit"])
            else:
                _, task = rw.resolve_unique_task(mod, root, op)
                new_text = rv.render_status_edit(old_text, task, mod, op["change"]["to"])
            diffs.append((op["target"]["source_path"], old_text, new_text))
        except Exception as e:
            print(f"Dry-run diff failed: {e}", file=sys.stderr)
            return False

    for p, old, new in diffs:
        print(f"Diff for {p}:")
        for line in rv.unified_diff(old, new, str(p)):
            print(line)

    if dry_run:
        return True

    if not yes:
        ans = input("Approve this batch? [y/N] ")
        if ans.lower() != "y":
            print("Aborted.")
            return False

    # signature
    sig = None
    if conf.get("signing", True):
        key_path = Path(conf["key_path"]).expanduser()
        if key_path.exists():
            with tempfile.NamedTemporaryFile() as tmp:
                tmp.write(co.canonical_bytes(batch))
                tmp.flush()
                proc = co._openssl("pkeyutl", "-sign", "-inkey", str(key_path), "-rawin", "-in", tmp.name)
                if proc.returncode == 0:
                    sig = base64.b64encode(proc.stdout).decode("ascii")

    # write ops and approvals to a tmp inbox
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_inbox = Path(tmpdir)
        (tmp_inbox / "approved").mkdir()
        for op in ops:
            op_path = tmp_inbox / "approved" / f"{op['operation_id']}.json"
            op_path.write_text(json.dumps(op, indent=2))
            app = rw.build_approval_record(op)
            if sig:
                app["signature"] = sig
            app_path = tmp_inbox / "approved" / f"{op['operation_id']}.approval.json"
            app_path.write_text(json.dumps(app, indent=2))
        
        # apply
        receipts = ap.apply_all(tmp_inbox, root, parser_path=LIB_DIR / "roadmap_sync.py")
        
        # move receipts back to our receipts dir
        for rec in receipts:
            if rec["outcome"] in ("applied", "conflicted", "quarantined", "rolled_back"):
                rec_path = tmp_inbox / "receipts" / f"{rec['operation_id']}.receipt.json"
                if rec_path.exists():
                    shutil.copy(rec_path, Path(conf["receipt_dir"]) / rec_path.name)
            if rec["backup_path"]:
                back_path = tmp_inbox / "backups" / rec["backup_path"]
                if back_path.exists():
                    shutil.copy(back_path, Path(conf["backup_dir"]) / back_path.name)
                    
        success = all(r["outcome"] == "applied" for r in receipts)
        if success:
            ledger[batch_hash] = {
                "receipt_ids": [r["operation_id"] for r in receipts],
                "apply_timestamp": datetime.now(timezone.utc).isoformat()
            }
            write_ledger(ledger, root)
            shutil.move(file_path, Path(conf["archive_dir"]) / file_path.name)
            
            # sync + verify
            snap = sync.build_snapshot(root)
            snap_path = Path(conf["snapshot_path"])
            snap_path.parent.mkdir(parents=True, exist_ok=True)
            sync.atomic_write_json(snap_path, snap)
            
            if conf.get("drive_push", True):
                subprocess.run(["rclone", "copy", str(snap_path.parent), conf.get("drive_remote", "drive:roadmap-ops/snapshot")], check=False)
            if conf.get("git_auto_commit", True):
                subprocess.run(["git", "add", "."], cwd=root, check=False)
                subprocess.run(["git", "commit", "-m", f"roadmap apply: {file_path.name}"], cwd=root, check=False)
            for hook in conf.get("post_apply_hooks", []):
                subprocess.run(hook, shell=True, cwd=root)
                
            return True
        else:
            print("Apply failed for some ops in the batch.", file=sys.stderr)
            return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pull", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--root", type=Path, default=Path("."))
    args = parser.parse_args()

    conf = get_config(args.root)
    ensure_dirs(conf, args.root)

    ledger_path = args.root / LEDGER_FILE
    snapshot_path = Path(conf["snapshot_path"])
    if not snapshot_path.is_absolute():
        snapshot_path = args.root / snapshot_path

    if args.pull:
        pull_ops(conf, quiet=not args.verbose)
    
    # Trigger version-tolerant readers for migration
    load_ledger(args.root)
    if snapshot_path.exists():
        try:
            with open(snapshot_path, "r") as f:
                snap_data = json.load(f)
            if "schema_version" not in snap_data:
                print(f"Migrating legacy snapshot {snapshot_path.name} to v1...")
                shutil.copy2(snapshot_path, str(snapshot_path) + ".bak")
                snap_data["schema_version"] = 1
                sync.atomic_write_json(snapshot_path, snap_data)
        except json.JSONDecodeError:
            print(f"Fatal: corrupt snapshot {snapshot_path.name}", file=sys.stderr)
            sys.exit(3)

    if args.verify:
        run_verify(conf, args.root)
        if not args.pull and not args.dry_run and not Path(conf["inbox_dir"]).exists():
            return

    inbox = Path(conf["inbox_dir"])
    if not inbox.exists():
        return

    ops_files = sorted(inbox.glob("*.json"))
    for f in ops_files:
        if f.name in (Path(LEDGER_FILE).name, snapshot_path.name):
            continue
        try:
            raw = f.read_bytes()
            do_apply_batch(raw, f, conf, args.root, dry_run=args.dry_run, yes=args.yes, quiet=not args.verbose)
        except Exception as e:
            print(f"Error processing {f.name}: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()

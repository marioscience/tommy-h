import os
import sys
import json
import argparse
import tomllib
import hashlib
import re
from pathlib import Path
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import roadmap_sync as sync

SCOPES = ['https://www.googleapis.com/auth/tasks']
CREDS_DIR = Path.home() / ".config" / "roadmap-tasks"

def get_google_tasks_service():
    creds = None
    token_path = CREDS_DIR / "token.json"
    credentials_path = CREDS_DIR / "credentials.json"
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not credentials_path.exists():
                print(f"Error: missing Google OAuth credentials at {credentials_path}", file=sys.stderr)
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
            creds = flow.run_local_server(port=0)
        CREDS_DIR.mkdir(parents=True, exist_ok=True)
        with open(token_path, "w") as token:
            token.write(creds.to_json())
    return build('tasks', 'v1', credentials=creds)

def load_config(root: Path) -> dict:
    config_path = root / "roadmap-tasks.toml"
    if not config_path.exists():
        print(f"Error: Missing config {config_path}", file=sys.stderr)
        sys.exit(1)
    with open(config_path, "rb") as f:
        conf = tomllib.load(f)
    if conf.get("schema_version") != 1:
        print("Error: roadmap-tasks.toml must have schema_version = 1", file=sys.stderr)
        sys.exit(1)
    seen_paths = set()
    for rm in conf.get("roadmaps", []):
        if rm["path"] in seen_paths:
            print(f"Error: Duplicate path in config: {rm['path']}", file=sys.stderr)
            sys.exit(1)
        seen_paths.add(rm["path"])
    return conf

def load_state(repo_root: Path, state_path_str: str) -> dict:
    state_path = repo_root / state_path_str
    if not state_path.exists():
        return {"schema_version": 1, "google_account": None, "entries": {}, "cursors": {}}
    with open(state_path, "r") as f:
        data = json.load(f)
    if data.get("schema_version") != 1:
        print("Error: Invalid ID map schema version", file=sys.stderr)
        sys.exit(1)
    return data

def save_state(repo_root: Path, state_path_str: str, state: dict):
    state_path = repo_root / state_path_str
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(state_path) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, state_path)

def load_proposals(repo_root: Path, proposal_path_str: str) -> list[dict]:
    p = repo_root / proposal_path_str
    if not p.exists():
        return []
    res = []
    with open(p, "r") as f:
        for line in f:
            if line.strip():
                res.append(json.loads(line))
    return res

def append_proposal(repo_root: Path, proposal_path_str: str, proposal: dict):
    p = repo_root / proposal_path_str
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a") as f:
        f.write(json.dumps(proposal) + "\n")

def fetch_all_tasks(service, list_id: str):
    tasks = []
    page_token = None
    while True:
        resp = service.tasks().list(tasklist=list_id, showCompleted=True, showHidden=True, showDeleted=True, maxResults=100, pageToken=page_token).execute()
        tasks.extend(resp.get("items", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return tasks

def build_notes(rtask: dict) -> str:
    notes = []
    fields = rtask.get("fields", {})
    desc = rtask.get("description", "")
    if desc:
        notes.append(desc)
        
    notes.append("\n[roadmap-mirror:v1]")
    if "origin" in fields:
        notes.append(f"origin={fields['origin']}")
    lane = rtask.get("section")
    if lane:
        notes.append(f"lane={lane}")
    if "status" in fields:
        notes.append(f"status={fields['status']}")
    if "dates" in fields:
        notes.append(f"dates={fields['dates']}")
    notes.append(f"source_path={rtask['source']['relative_path']}")
    notes.append("parser_version=1")
    notes.append(f"checksum={rtask['source']['block_sha256']}")
    
    known = {"description", "scope", "status", "effort", "origin", "dates", "next", "next_step"}
    unknown = {k: v for k, v in fields.items() if k not in known}
    for k, v in unknown.items():
        notes.append(f"field_{k}={v}")
        
    return "\n".join(notes)

def build_google_task_body(rtask: dict) -> dict:
    code = rtask.get("code")
    title = rtask.get("title", "")
    g_title = f"[{code}] {title}"
    if len(g_title) > 1024:
        g_title = g_title[:1021] + "..."
    notes = build_notes(rtask)
    status = "completed" if rtask.get("status") == "completed" else "needsAction"
    body = {"title": g_title, "notes": notes, "status": status}
    
    due = rtask["fields"].get("due") or rtask["fields"].get("due_date")
    if due:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", due)
        if m:
            body["due"] = f"{m.group(1)}T00:00:00.000Z"
    return body

def build_google_task_chunks(body: dict, code: str) -> list[dict]:
    notes = body["notes"]
    if len(notes) <= 8192:
        return [body]
    parts = []
    chunk_size = 7500
    for i in range(0, len(notes), chunk_size):
        parts.append(notes[i:i+chunk_size])
    parent = body.copy()
    parent["notes"] = f"Notes too large. See child tasks [META {code} 1..{len(parts)}].\n\n[roadmap-mirror:v1]\nparts={len(parts)}"
    chunks = [parent]
    for i, part in enumerate(parts, 1):
        child = {"title": f"[META {code} {i}/{len(parts)}]", "notes": f"{part}\n\n[roadmap-mirror:v1]\nparent={code}\npart={i}\nof={len(parts)}", "status": body["status"]}
        chunks.append(child)
    return chunks

def extract_syncable_fields(gtask: dict) -> dict:
    return {
        "title": gtask.get("title", ""),
        "notes": gtask.get("notes", ""),
        "status": gtask.get("status", "needsAction"),
        "due": gtask.get("due")
    }

def hash_dict(d: dict) -> str:
    s = json.dumps(extract_syncable_fields(d), sort_keys=True)
    return hashlib.sha256(s.encode()).hexdigest()

def extract_composite_hash(parent_gtask: dict, children_gtasks: list[dict]) -> str:
    combined = extract_syncable_fields(parent_gtask)
    child_notes = [extract_syncable_fields(c)["notes"] for c in children_gtasks]
    s = json.dumps({"parent": combined, "children": child_notes}, sort_keys=True)
    return hashlib.sha256(s.encode()).hexdigest()

def do_sync(conf, state, service, repo_root: Path, dry_run=True, verbose=False):
    lists_resp = service.tasklists().list().execute()
    all_lists = lists_resp.get("items", [])
    
    stats = {"create": 0, "update": 0, "no-op": 0, "conflict": 0, "proposals": 0, "inbound_checkoff": 0}
    proposals = load_proposals(repo_root, conf["proposal_path"])
    existing_proposal_ids = {p["proposal_id"] for p in proposals}
    
    for rm in conf.get("roadmaps", []):
        path_str = rm["path"]
        p = repo_root / path_str
        if not p.exists():
            continue
            
        list_name = rm["list_name"]
        list_id = rm.get("list_id")
        if not list_id:
            for lst in all_lists:
                if lst["title"] == list_name:
                    list_id = lst["id"]
                    rm["list_id"] = list_id
                    break
            if not list_id:
                if dry_run:
                    print(f"Would create task list: {list_name}")
                    list_id = f"dry_run_{list_name}"
                else:
                    resp = service.tasklists().insert(body={"title": list_name}).execute()
                    list_id = resp["id"]
                    rm["list_id"] = list_id
                    
        _, rtasks = sync.parse_roadmap(p, repo_root)
        remote_tasks = [] if list_id.startswith("dry_run_") else fetch_all_tasks(service, list_id)
        remote_by_id = {t["id"]: t for t in remote_tasks}
        seen_codes = set()
        
        for rtask in rtasks:
            code = rtask.get("code")
            if not code:
                continue
            seen_codes.add(code)
                
            entry_key = f"{path_str}::{code}"
            entry = state["entries"].get(entry_key)
            body = build_google_task_body(rtask)
            chunks = build_google_task_chunks(body, code)
            parent_body = chunks[0]
            
            source_hash = rtask["source"]["block_sha256"]
            
            if not entry:
                stats["create"] += 1
                if verbose:
                    print(f"[OUTBOUND CREATE] {code}: {parent_body['title']}")
                if not dry_run:
                    resp = service.tasks().insert(tasklist=list_id, body=parent_body).execute()
                    task_id = resp["id"]
                    child_ids = []
                    for child in chunks[1:]:
                        c_resp = service.tasks().insert(tasklist=list_id, body=child).execute()
                        child_ids.append(c_resp["id"])
                    
                    state["entries"][entry_key] = {
                        "list_id": list_id,
                        "task_id": task_id,
                        "child_ids": child_ids,
                        "source_hash": source_hash,
                        "remote_hash": extract_composite_hash(parent_body, chunks[1:]),
                        "last_write_hash": extract_composite_hash(parent_body, chunks[1:]),
                        "last_write_at": datetime.now(timezone.utc).isoformat()
                    }
                    save_state(repo_root, conf["state_path"], state)
            else:
                # INBOUND CHECK first
                remote_task = remote_by_id.get(entry["task_id"])
                inbound_conflict = False
                if remote_task and not remote_task.get("deleted") and not remote_task.get("hidden"):
                    remote_child_tasks = [remote_by_id[cid] for cid in entry.get("child_ids", []) if cid in remote_by_id]
                    current_remote_hash = extract_composite_hash(remote_task, remote_child_tasks)
                    if current_remote_hash != entry.get("last_write_hash"):
                        # Remote has changed!
                        inbound_conflict = True
                        
                        # Check if ONLY the parent status changed to completed
                        fake_parent = remote_task.copy()
                        fake_parent["status"] = parent_body["status"]  # Reset status to what we expect
                        simulated_composite = extract_composite_hash(fake_parent, remote_child_tasks)
                        
                        if simulated_composite == entry.get("last_write_hash") and rtask["status"] != "completed" and remote_task.get("status") == "completed":
                            # It's a pure inbound check-off!
                            if source_hash == entry["source_hash"]:
                                stats["inbound_checkoff"] += 1
                                if verbose:
                                    print(f"[INBOUND CHECKOFF] {code}")
                                if not dry_run:
                                    # Atomic mutate! We will implement rw.build_status_operation later
                                    # But for now we just log it and apply later
                                    pass
                            else:
                                # Markdown changed too -> conflict proposal
                                stats["conflict"] += 1
                                if verbose:
                                    print(f"[CONFLICT] {code}: checkoff but source changed")
                        else:
                            # Other inbound edit -> proposal
                            proposal_id = f"prop_{code}_{current_remote_hash}"
                            if proposal_id not in existing_proposal_ids:
                                stats["proposals"] += 1
                                if verbose:
                                    print(f"[INBOUND PROPOSAL] {code}: remote edit")
                                if not dry_run:
                                    prop = {
                                        "proposal_id": proposal_id,
                                        "source_path": path_str,
                                        "code": code,
                                        "list_id": list_id,
                                        "task_id": entry["task_id"],
                                        "google_value": extract_syncable_fields(remote_task),
                                        "roadmap_value": extract_syncable_fields(parent_body),
                                        "state": "pending",
                                        "observed_at": datetime.now(timezone.utc).isoformat()
                                    }
                                    append_proposal(repo_root, conf["proposal_path"], prop)
                                    existing_proposal_ids.add(proposal_id)
                
                # OUTBOUND UPDATE (if no inbound conflict, or roadmap wins)
                if source_hash != entry.get("source_hash"):
                    if inbound_conflict:
                        # Conflict! Roadmap wins for outbound rep, log as conflict, suppress overwrite until reviewed
                        stats["conflict"] += 1
                        if verbose:
                            print(f"[CONFLICT SUPPRESSED] {code}: roadmap and google both changed")
                    else:
                        stats["update"] += 1
                        if verbose:
                            print(f"[OUTBOUND UPDATE] {code}: {parent_body['title']}")
                        if not dry_run:
                            current = service.tasks().get(tasklist=list_id, task=entry["task_id"]).execute()
                            if current.get("deleted") or current.get("hidden"):
                                print(f"Warning: {code} is deleted/hidden in Google Tasks. Suppressing update.")
                                continue
                            parent_body["id"] = entry["task_id"]
                            service.tasks().update(tasklist=list_id, task=entry["task_id"], body=parent_body).execute()
                            
                            child_ids = entry.get("child_ids", [])
                            for i, child_body in enumerate(chunks[1:]):
                                if i < len(child_ids):
                                    child_body["id"] = child_ids[i]
                                    service.tasks().update(tasklist=list_id, task=child_ids[i], body=child_body).execute()
                                else:
                                    c_resp = service.tasks().insert(tasklist=list_id, body=child_body).execute()
                                    child_ids.append(c_resp["id"])
                                    
                            # Clear deprecated chunks instead of deleting
                            for i in range(len(chunks)-1, len(child_ids)):
                                deprecated = {"id": child_ids[i], "title": f"[META {code} DEPRECATED]", "notes": "", "status": "completed"}
                                service.tasks().update(tasklist=list_id, task=child_ids[i], body=deprecated).execute()
                            
                            entry["child_ids"] = child_ids
                            entry["source_hash"] = source_hash
                            entry["remote_hash"] = extract_composite_hash(parent_body, chunks[1:])
                            entry["last_write_hash"] = extract_composite_hash(parent_body, chunks[1:])
                            entry["last_write_at"] = datetime.now(timezone.utc).isoformat()
                            save_state(repo_root, conf["state_path"], state)
                else:
                    if not inbound_conflict:
                        stats["no-op"] += 1
                        
        # Quarantine mismatch for deleted markdown blocks
        for entry_key, entry in list(state["entries"].items()):
            try:
                e_path, e_code = entry_key.split("::", 1)
            except ValueError:
                continue
            if e_path == path_str and e_code not in seen_codes:
                proposal_id = f"quarantine_{e_code}_{entry['task_id']}"
                if proposal_id not in existing_proposal_ids:
                    stats["proposals"] += 1
                    if verbose:
                        print(f"[QUARANTINE] {e_code}: disappeared from Markdown")
                    if not dry_run:
                        prop = {
                            "proposal_id": proposal_id,
                            "source_path": path_str,
                            "code": e_code,
                            "list_id": entry["list_id"],
                            "task_id": entry["task_id"],
                            "reason": "Markdown block disappeared; remote task not deleted automatically.",
                            "state": "pending",
                            "observed_at": datetime.now(timezone.utc).isoformat()
                        }
                        append_proposal(repo_root, conf["proposal_path"], prop)
                        existing_proposal_ids.add(proposal_id)
                    
    print(f"Sync plan: {stats['create']} creates, {stats['update']} updates, {stats['no-op']} no-ops, {stats['conflict']} conflicts, {stats['inbound_checkoff']} auto-checkoffs, {stats['proposals']} proposals.")
    if dry_run and (stats['create'] > 0 or stats['update'] > 0 or stats['inbound_checkoff'] > 0):
        print("Run with --apply to execute changes.")

def main():
    parser = argparse.ArgumentParser(description="Google Tasks mirror for roadmap system")
    parser.add_argument("--apply", action="store_true", help="Apply changes to Google Tasks and Markdown")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show detailed diffs")
    parser.add_argument("--root", type=Path, default=Path("."), help="Path to InstinctConnector repo root")
    args = parser.parse_args()

    conf = load_config(args.root)
    repo_root = Path(conf["repo_root"])
    state = load_state(repo_root, conf["state_path"])
    service = get_google_tasks_service()
    do_sync(conf, state, service, repo_root, dry_run=not args.apply, verbose=args.verbose)

if __name__ == "__main__":
    main()

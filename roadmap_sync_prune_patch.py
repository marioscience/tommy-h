#!/usr/bin/env python3
"""One-shot patch: teach roadmap_sync.py to prune non-source trees.

The live sync scans ~/projects, so demo fixtures and guarded-writes inbox
content (including roadmap backups, which are roadmap-named .md files) get
ingested as phantom tasks. This patch prunes those directory names during
discovery, exactly like the existing archive pruning, before os.walk
descends into them.

Idempotent: safe to run twice. Aborts without writing if the target does
not look like the deployed archive-pruned parser.

Usage:
    python3 roadmap_sync_prune_patch.py
    python3 roadmap_sync_prune_patch.py --target ~/.local/lib/roadmap-sync/roadmap_sync.py
"""
from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

DEFAULT_TARGET = Path("~/.local/lib/roadmap-sync/roadmap_sync.py")

EXCLUSION_BLOCK = '''
# Directories that never contain roadmap sources of truth: demo/test fixtures,
# the guarded-writes inbox and its roadmap backups. Pruned exactly like the
# archive projects above, before os.walk descends into them.
EXCLUDED_NONSOURCE_DIR_NAMES = frozenset({
    "fixtures",
    "test-fixtures",
    "test_fixtures",
    "write-inbox",
    "backups",
})
'''

NEW_DISCOVER = '''def discover(root: Path) -> list[Path]:
    """Find roadmap Markdown files while pruning archived and non-source trees."""
    found: list[Path] = []
    excluded = EXCLUDED_PROJECT_DIR_NAMES | EXCLUDED_NONSOURCE_DIR_NAMES
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        # Mutating dirnames in top-down mode prevents os.walk from entering these
        # trees, so archived, fixture and write-inbox files never reach parsing
        # or snapshot generation.
        dirnames[:] = [
            name for name in dirnames
            if name.casefold() not in excluded and not (Path(current) / name).is_symlink()
        ]
        for filename in filenames:
            if filename.casefold().endswith(".md") and "roadmap" in filename.casefold():
                found.append(Path(current) / filename)
    return sorted(found, key=lambda p: p.as_posix().casefold())


'''


def patch(target: Path) -> int:
    if not target.is_file():
        print(f"error: parser not found at {target}", file=sys.stderr)
        return 3
    text = target.read_text(encoding="utf-8")
    if "EXCLUDED_NONSOURCE_DIR_NAMES" in text:
        print(f"already patched: {target}")
        return 0
    if "EXCLUDED_PROJECT_DIR_NAMES" not in text:
        print(
            "error: this parser predates the archive-pruning deployment; aborting without changes",
            file=sys.stderr,
        )
        return 3

    # 1. Add the non-source exclusion set right after the archive set.
    anchor = text.index("EXCLUDED_PROJECT_DIR_NAMES = frozenset({")
    close = text.index("})", anchor) + 2
    text = text[:close] + "\n" + EXCLUSION_BLOCK.rstrip("\n") + text[close:]

    # 2. Replace discover() wholesale so the pruning style matches exactly.
    text, count = re.subn(
        r"def discover\(root: Path\) -> list\[Path\]:.*?(?=\ndef )",
        NEW_DISCOVER,
        text,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        print("error: could not locate discover() to replace; aborting without changes", file=sys.stderr)
        return 3

    ast.parse(text)  # never write a broken parser

    backup = target.with_suffix(target.suffix + ".bak-prune")
    if not backup.exists():
        backup.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
    target.write_text(text, encoding="utf-8")
    print(f"patched: {target}")
    print(f"backup:  {backup}")
    print("pruned dir names: fixtures, test-fixtures, test_fixtures, write-inbox, backups")
    print("next: cd ~/projects/InstinctConnector && python3 tests/test_roadmap_sync_pruning.py -v")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    args = parser.parse_args()
    return patch(args.target.expanduser())


if __name__ == "__main__":
    raise SystemExit(main())

with open("roadmap_cli.py", "r") as f:
    lines = f.readlines()

patch = """
    # -- apply --
    ap_parser = sub.add_parser("apply", help="unified roadmap apply command")
    ap_parser.add_argument("--pull", action="store_true")
    ap_parser.add_argument("--verify", action="store_true")
    ap_parser.add_argument("--dry-run", action="store_true")
    ap_parser.add_argument("--yes", action="store_true")
    ap_parser.add_argument("-v", "--verbose", action="store_true")
    ap_parser.set_defaults(func=cmd_apply)
"""

top_patch = """
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

"""

# find insertion points
for i, line in enumerate(lines):
    if 'def build_parser()' in line:
        lines.insert(i, top_patch)
        break

with open("roadmap_cli.py", "w") as f:
    f.writelines(lines)

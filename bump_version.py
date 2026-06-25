#!/usr/bin/env python3
"""
GhostProofJob — version bump tool.

Keeps the THREE deploy markers in sync so a deploy actually pushes an update:
  • sw.js        const CACHE_VERSION = 'gpj-vNN'   (triggers the new-version banner)
  • index.html   const APP_VERSION  = 'vNN'        (drives the What's New popup)
  • index.html   <span id="build-stamp">vNN</span> (visible footer truth-teller)
…and mirrors the same into GhostProofJob.html.

USAGE
  python3 bump_version.py                 # check current versions (no changes)
  python3 bump_version.py --next          # bump all to the next number (NN -> NN+1)
  python3 bump_version.py --set 45        # set all to a specific number
  python3 bump_version.py --next --note "Fixed X" "Added Y"   # also add a CHANGELOG entry

It REFUSES to bump if the files are already out of sync (so you fix drift first),
and verifies all markers match after writing.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SW    = os.path.join(HERE, 'sw.js')
INDEX = os.path.join(HERE, 'index.html')
MIRROR= os.path.join(HERE, 'GhostProofJob.html')

PAT = {
    'cache':  (re.compile(r"(const CACHE_VERSION\s*=\s*'gpj-v)(\d+)(')"),        'sw.js / CACHE_VERSION'),
    'app':    (re.compile(r"(const APP_VERSION = 'v)(\d+)(')"),                  'APP_VERSION'),
    'stamp':  (re.compile(r"(id=\"build-stamp\">v)(\d+)(</span>)"),             'build-stamp'),
}

def read(p):
    with open(p, encoding='utf-8') as f: return f.read()
def write(p, s):
    with open(p, 'w', encoding='utf-8') as f: f.write(s)

def find_ver(text, key):
    m = PAT[key][0].search(text)
    return int(m.group(2)) if m else None

def current_versions():
    sw, idx, mir = read(SW), read(INDEX), read(MIRROR)
    return {
        'sw.js CACHE_VERSION':         find_ver(sw,  'cache'),
        'index.html APP_VERSION':      find_ver(idx, 'app'),
        'index.html build-stamp':      find_ver(idx, 'stamp'),
        'GhostProofJob APP_VERSION':   find_ver(mir, 'app'),
        'GhostProofJob build-stamp':   find_ver(mir, 'stamp'),
    }

def bump_text(text, key, newver):
    rx, _ = PAT[key]
    return rx.sub(lambda m: m.group(1) + str(newver) + m.group(3), text)

def add_changelog(idx_text, newver, notes):
    """Insert a CHANGELOG entry for the new version (idempotent-ish)."""
    if not notes: return idx_text, False
    entry_key = f"'v{newver}':"
    if entry_key in idx_text:  # already has an entry for this version
        return idx_text, False
    arr = '[' + ','.join("'" + n.replace("'", "\\'") + "'" for n in notes) + ']'
    needle = 'const CHANGELOG = {\n'
    if needle not in idx_text:
        return idx_text, False
    return idx_text.replace(needle, needle + f"  'v{newver}':{arr},\n", 1), True

def main():
    args = sys.argv[1:]
    cur = current_versions()
    vals = set(v for v in cur.values() if v is not None)
    missing = [k for k, v in cur.items() if v is None]

    print("Current version markers:")
    for k, v in cur.items():
        print(f"  {k:30s} = v{v}" if v is not None else f"  {k:30s} = (NOT FOUND)")
    if missing:
        print("\n⚠ Could not find:", ', '.join(missing), "— check the file patterns.")
        sys.exit(1)

    in_sync = (len(vals) == 1)
    print(f"\nIn sync: {'✓ yes' if in_sync else '✗ NO — drift detected!'} (current = v{sorted(vals)})")

    if not args:
        print("\nNo action requested. Use --next or --set NN to bump.")
        sys.exit(0 if in_sync else 2)

    if not in_sync:
        print("\n✗ Refusing to bump while versions are out of sync. Fix drift first "
              "(or use --set NN to force them all to the same number).")
        if '--set' not in args:
            sys.exit(2)

    # determine target version
    notes = []
    if '--note' in args:
        i = args.index('--note')
        notes = args[i+1:]
        args = args[:i]
    if '--set' in args:
        target = int(args[args.index('--set')+1])
    elif '--next' in args:
        target = max(vals) + 1
    else:
        print("\nUnknown args. Use --next, --set NN, optionally --note \"...\".")
        sys.exit(1)

    # write all files
    sw  = bump_text(read(SW),    'cache', target)
    idx = read(INDEX)
    idx = bump_text(idx, 'app',   target)
    idx = bump_text(idx, 'stamp', target)
    idx, added = add_changelog(idx, target, notes)
    mir = read(MIRROR)
    mir = bump_text(mir, 'app',   target)
    mir = bump_text(mir, 'stamp', target)
    # mirror gets the same changelog if index did
    if added:
        mir, _ = add_changelog(mir, target, notes)

    write(SW, sw); write(INDEX, idx); write(MIRROR, mir)

    # verify
    after = current_versions()
    ok = (set(after.values()) == {target})
    print(f"\n→ Bumped all markers to v{target}.")
    if notes:
        print(f"  CHANGELOG entry {'added' if added else 'skipped (already existed)'}: {notes}")
    for k, v in after.items():
        print(f"  {k:30s} = v{v}")
    print(f"\n{'✓ All markers verified in sync at v'+str(target) if ok else '✗ VERIFY FAILED — markers do not match!'}")
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()

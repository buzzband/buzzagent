#!/usr/bin/env bash
# Bump the app version everywhere — safely.
#
# Why not sed: the Cargo.lock lists packages alphabetically, and a naive
# `sed -i '0,/^version = "X"/s//…/'` once hit whichever package sorted before
# buzzagent, silently corrupting the lockfile (the 0.1.7 incident, where
# android_system_properties got pinned to a nonexistent version). This script
# targets the buzzagent blocks explicitly, in every file.
set -euo pipefail
cd "$(dirname "$0")/.."
NEW="${1:?usage: scripts/bump-version.sh 0.1.9}"

python3 - "$NEW" << 'PY'
import json, re, sys

new = sys.argv[1]

def sub(pattern, repl, path, flags=0):
    src = open(path, encoding="utf-8").read()
    out, n = re.subn(pattern, repl, src, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f"pattern not found in {path}: {pattern}")
    open(path, "w", encoding="utf-8").write(out)
    print(f"  {path}: ok")

# package.json / tauri.conf.json — the top-level "version" field.
for path in ("package.json", "src-tauri/tauri.conf.json"):
    old = json.load(open(path))["version"]
    sub(rf'"version": "{re.escape(old)}"', f'"version": "{new}"', path)

# Cargo.toml — the [package] version (first version line in the file).
sub(r'^version = "[0-9.]+"', f'version = "{new}"', "src-tauri/Cargo.toml", re.M)

# Cargo.lock — ONLY inside the [[package]] name = "buzzagent" block.
lock = open("src-tauri/Cargo.lock", encoding="utf-8").read()
block = re.compile(r'(\[\[package\]\]\nname = "buzzagent"\nversion = ")[0-9.]+(")')
out, n = block.subn(rf"\g<1>{new}\g<2>", lock, count=1)
if n != 1:
    raise SystemExit("buzzagent block not found in Cargo.lock")
open("src-tauri/Cargo.lock", "w", encoding="utf-8").write(out)
print("  src-tauri/Cargo.lock: ok (buzzagent block only)")
print(f"Version bumped to {new}")
PY

#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path
from shutil import which

ROOT = Path(__file__).resolve().parent.parent
JS_FILES = [
    "src/timeline.js",
    "src/fileLoad.js",
    "src/db.js",
    "src/players.js",
    "src/editor.js",
    "src/player.js",
    "src/htmlExport.js",
]
WINDOWS_NODE = Path("/mnt/c/Program Files/nodejs/node.exe")


def main():
    node = find_node()
    if not node:
        print("Node.js was not found. Install Node in WSL or Windows.", file=sys.stderr)
        return 1

    print(f"Using Node: {node}")
    failures = 0
    for relative_path in JS_FILES:
        path = ROOT / relative_path
        result = subprocess.run([str(node), "--check", node_readable_path(node, path)], cwd=ROOT)
        if result.returncode == 0:
            print(f"OK {relative_path}")
        else:
            failures += 1

    return 1 if failures else 0


def find_node():
    local_node = which("node")
    if local_node:
        return Path(local_node)
    if WINDOWS_NODE.exists():
        return WINDOWS_NODE
    return None


def node_readable_path(node, path):
    if node == WINDOWS_NODE:
        return subprocess.check_output(["wslpath", "-w", str(path)], text=True).strip()
    return str(path)


if __name__ == "__main__":
    raise SystemExit(main())

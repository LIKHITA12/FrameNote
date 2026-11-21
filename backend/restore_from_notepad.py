#!/usr/bin/env python3
"""Recreate the project's folders and files from CODE_NOTEPAD.md.

File name: restore_from_notepad.py

Usage:
    python3 restore_from_notepad.py OUTPUT_DIR [--notepad CODE_NOTEPAD.md] [--force]

Each block in the notepad looks like:

    ---------
    path/to/file.ext

    ```
    file contents
    ```

Binary files, lockfiles and git-ignored files (.env, databases, uploads) are not
stored in the notepad, so they are not restored. Run `npm install` in frontend/
and recreate backend/.env yourself afterwards.
"""

import argparse
import sys
from pathlib import Path

SEPARATOR = "---------"
SKIPPED_HEADER = "Skipped files"


def parse_notepad(text):
    """Return a list of (relative_path, contents) tuples."""
    lines = text.split("\n")
    files = []
    i = 0
    while i < len(lines):
        if lines[i] != SEPARATOR:
            i += 1
            continue
        path = lines[i + 1] if i + 1 < len(lines) else ""
        if path.startswith(SKIPPED_HEADER):
            break
        fence = lines[i + 3] if i + 3 < len(lines) else ""
        if lines[i + 2] != "" or not fence.startswith("```"):
            raise ValueError(f"Malformed block for {path!r} at line {i + 1}")
        # The fence is longer than any backtick run inside the file, so the
        # first line equal to it closes the block.
        start = i + 4
        end = start
        while end < len(lines) and lines[end] != fence:
            end += 1
        if end == len(lines):
            raise ValueError(f"Unclosed code block for {path!r} at line {i + 1}")
        files.append((path, "\n".join(lines[start:end])))
        i = end + 1
    return files


def safe_target(root, rel_path):
    target = (root / rel_path).resolve()
    if rel_path.startswith("/") or not target.is_relative_to(root):
        raise ValueError(f"Refusing to write outside output dir: {rel_path!r}")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output_dir", help="Folder to create the project in")
    parser.add_argument("--notepad", default=str(Path(__file__).with_name("CODE_NOTEPAD.md")),
                        help="Path to the notepad file (default: CODE_NOTEPAD.md next to this script)")
    parser.add_argument("--force", action="store_true", help="Overwrite files that already exist")
    args = parser.parse_args()

    files = parse_notepad(Path(args.notepad).read_text(encoding="utf-8"))
    root = Path(args.output_dir).resolve()
    targets = [(safe_target(root, p), body) for p, body in files]

    existing = [t for t, _ in targets if t.exists()]
    if existing and not args.force:
        print(f"{len(existing)} file(s) already exist in {root}, e.g. {existing[0]}", file=sys.stderr)
        print("Use an empty folder, or pass --force to overwrite.", file=sys.stderr)
        sys.exit(1)

    for target, body in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        # The notepad trims trailing newlines; restore a single one (empty files stay empty).
        target.write_text(body + "\n" if body else "", encoding="utf-8")

    print(f"Restored {len(targets)} files into {root}")


if __name__ == "__main__":
    main()

"""Folder watcher — drop an export in, get a primer out.

Polls a folder (default: the user's session_to_session folder) for new or
changed conversation files and auto-converts each into a capsule + a
ready-to-paste primer. Stdlib only (no watchdog dependency); polling is more
than fast enough for this human-paced workflow.

Layout created under the watched folder:
    inbox/      <- you drop exports / pasted .txt here
    capsules/   <- generated <name>.capsule.json
    primers/    <- generated <name>.<target>.primer.txt

Usage:
    python -m s2s.cli watch                       # watch default folder
    python -m s2s.cli watch ~/Documents/foo --to claude --interval 3
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from .adapters import detect_and_load
from .compress import compress
from .rehydrate import build_primer
from .summarize import smart_summary

WATCH_EXTS = {".json", ".jsonl", ".txt", ".md"}


def _process_file(path: Path, out_capsules: Path, out_primers: Path,
                  target: str, offline: bool, full: bool) -> Optional[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if not text.strip():
        return None

    # .txt / .md are treated as pasted conversations; json/jsonl auto-detected
    hint = "paste" if path.suffix.lower() in (".txt", ".md") else None
    try:
        cap = detect_and_load(text, hint=hint)
    except ValueError:
        cap = detect_and_load(text, hint="paste")

    summarizer = None if offline else (lambda c: smart_summary(c))
    compress(cap, summarizer=summarizer) if summarizer else compress(cap)
    cap.include_full_transcript = full

    stem = path.stem
    cap_path = out_capsules / f"{stem}.capsule.json"
    primer_path = out_primers / f"{stem}.{target}.primer.txt"
    cap_path.write_text(cap.to_json(), encoding="utf-8")
    primer_path.write_text(build_primer(cap, target=target), encoding="utf-8")
    return (f"{path.name}  ->  capsules/{cap_path.name}, "
            f"primers/{primer_path.name}  [{cap.source_platform}]")


def watch(folder: str, target: str = "claude", interval: float = 3.0,
          offline: bool = False, full: bool = False, once: bool = False):
    base = Path(folder).expanduser()
    inbox = base / "inbox"
    capsules = base / "capsules"
    primers = base / "primers"
    for d in (inbox, capsules, primers):
        d.mkdir(parents=True, exist_ok=True)

    print(f"[s2s] watching {inbox}  (target={target}, "
          f"interval={interval}s){'  [single pass]' if once else ''}")
    print(f"[s2s] drop conversation exports or pasted .txt files into: {inbox}")

    seen: dict[str, float] = {}
    try:
        while True:
            for path in sorted(inbox.iterdir()):
                if not path.is_file() or path.suffix.lower() not in WATCH_EXTS:
                    continue
                mtime = path.stat().st_mtime
                if seen.get(str(path)) == mtime:
                    continue           # unchanged since last pass
                seen[str(path)] = mtime
                msg = _process_file(path, capsules, primers, target,
                                    offline, full)
                if msg:
                    print(f"[s2s] {msg}")
            if once:
                break
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[s2s] stopped.")

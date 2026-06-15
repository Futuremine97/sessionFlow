"""s2s command-line interface.

Commands
--------
  import    vendor export        -> capsule.json   (normalize only)
  compress  capsule.json|export  -> capsule.json   (add memory/context)
  primer    capsule.json|export  -> primer.txt     (rehydrate for a target)
  transfer  export               -> primer.txt     (one-shot: do it all)
  inspect   capsule.json         -> human summary

Examples
--------
  python -m s2s.cli transfer chat.json --to claude -o primer.txt
  python -m s2s.cli transfer chat.json --to gemini --full -o primer.txt
  python -m s2s.cli import chat.json --from chatgpt -o capsule.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .adapters import detect_and_load, ADAPTERS
from .capsule import Capsule
from .compress import compress, heuristic_summary
from .rehydrate import build_primer
from .summarize import smart_summary, active_provider

TARGETS = ["claude", "chatgpt", "gemini", "generic"]


def _summarizer(a):
    """Choose summarizer: heuristic if --offline, else LLM-with-fallback."""
    if getattr(a, "offline", False):
        return heuristic_summary
    return lambda cap: smart_summary(cap, verbose=True)


def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _load_capsule(path: str, src_hint: str | None) -> Capsule:
    """Accept either a saved capsule.json or a raw vendor export."""
    text = _read(path)
    try:
        cap = Capsule.from_json(text)
        if cap.schema_version and (cap.transcript or cap.context.summary
                                   or cap.extra.get("detection")):
            return cap
    except Exception:
        pass
    return detect_and_load(text, hint=src_hint)


def _out(text: str, out_path: str | None):
    if out_path:
        Path(out_path).write_text(text, encoding="utf-8")
        print(f"wrote {out_path}", file=sys.stderr)
    else:
        sys.stdout.write(text)


# --------------------------------------------------------------------------- #
def cmd_import(a):
    cap = detect_and_load(_read(a.input), hint=a.src)
    _out(cap.to_json(), a.output)


def cmd_compress(a):
    cap = _load_capsule(a.input, a.src)
    compress(cap, summarizer=_summarizer(a))
    _out(cap.to_json(), a.output)


def cmd_primer(a):
    cap = _load_capsule(a.input, a.src)
    if not cap.context.summary:
        compress(cap, summarizer=_summarizer(a))
    cap.include_full_transcript = a.full
    _out(build_primer(cap, target=a.to), a.output)


def cmd_paste(a):
    """Read a pasted conversation from a file or stdin -> primer."""
    if a.input and a.input != "-":
        text = _read(a.input)
    else:
        text = sys.stdin.read()
    cap = detect_and_load(text, hint="paste")
    compress(cap, summarizer=_summarizer(a))
    cap.include_full_transcript = a.full
    _out(build_primer(cap, target=a.to), a.output)
    if a.capsule:
        Path(a.capsule).write_text(cap.to_json(), encoding="utf-8")
        print(f"wrote capsule {a.capsule}", file=sys.stderr)


def cmd_transfer(a):
    cap = detect_and_load(_read(a.input), hint=a.src)
    compress(cap, summarizer=_summarizer(a))
    cap.include_full_transcript = a.full
    primer = build_primer(cap, target=a.to)
    _out(primer, a.output)
    if a.capsule:
        Path(a.capsule).write_text(cap.to_json(), encoding="utf-8")
        print(f"wrote capsule {a.capsule}", file=sys.stderr)


def cmd_watch(a):
    from .watch import watch
    watch(a.folder, target=a.to, interval=a.interval,
          offline=a.offline, full=a.full, once=a.once)


def cmd_inspect(a):
    cap = _load_capsule(a.input, a.src)
    if not cap.context.summary:
        compress(cap, summarizer=_summarizer(a))
    c = cap.context
    print(f"Source      : {cap.source_platform} / {cap.source_model}")
    print(f"Title       : {cap.title}")
    turns = len(cap.transcript) or cap.extra.get("transcript_turn_count", 0)
    print(f"Turns       : {turns}")
    print(f"Detection   : {cap.extra.get('detection')}")
    print(f"Summarizer  : {cap.extra.get('summarizer')} "
          f"(active provider: {active_provider() or 'none -> heuristic'})")
    print(f"~tokens(ctx): {c.token_estimate}")
    print(f"Facts       : {len(c.key_facts)}")
    print(f"Decisions   : {len(c.decisions)}")
    print(f"Open threads: {len(c.open_threads)}")
    print(f"Artifacts   : {len(cap.artifacts)}")
    print(f"\nSummary:\n{c.summary}")


# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="s2s", description="Transfer AI session context between sessions.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_common(sp, need_to=False, need_full=False):
        sp.add_argument("input", help="vendor export or capsule.json")
        sp.add_argument("--from", dest="src", choices=list(ADAPTERS),
                        help="force source platform (else auto-detect)")
        sp.add_argument("-o", "--output", help="output file (default: stdout)")
        if need_to:
            sp.add_argument("--to", default="generic", choices=TARGETS,
                            help="target platform to tune the primer for")
        if need_full:
            sp.add_argument("--full", action="store_true",
                            help="append the verbatim full transcript (opt-in)")
        sp.add_argument("--offline", action="store_true",
                        help="force heuristic summary (ignore any LLM API key)")

    sp = sub.add_parser("import", help="normalize export -> capsule")
    add_common(sp)
    sp.set_defaults(func=cmd_import)

    sp = sub.add_parser("compress", help="add compressed context to a capsule")
    add_common(sp)
    sp.set_defaults(func=cmd_compress)

    sp = sub.add_parser("primer", help="rehydrate capsule -> handoff primer")
    add_common(sp, need_to=True, need_full=True)
    sp.set_defaults(func=cmd_primer)

    sp = sub.add_parser("transfer", help="export -> compress -> primer (1 shot)")
    add_common(sp, need_to=True, need_full=True)
    sp.add_argument("--capsule", help="also save the intermediate capsule.json")
    sp.set_defaults(func=cmd_transfer)

    sp = sub.add_parser(
        "paste", help="pasted conversation text (stdin or file) -> primer")
    sp.add_argument("input", nargs="?", default="-",
                    help="text file, or '-'/omitted to read stdin")
    sp.add_argument("-o", "--output", help="output file (default: stdout)")
    sp.add_argument("--to", default="generic", choices=TARGETS,
                    help="target platform to tune the primer for")
    sp.add_argument("--full", action="store_true",
                    help="append the verbatim full transcript (opt-in)")
    sp.add_argument("--offline", action="store_true",
                    help="force heuristic summary (ignore any LLM API key)")
    sp.add_argument("--capsule", help="also save the intermediate capsule.json")
    sp.set_defaults(func=cmd_paste)

    sp = sub.add_parser("inspect", help="print a human summary of a capsule")
    add_common(sp)
    sp.set_defaults(func=cmd_inspect)

    sp = sub.add_parser(
        "watch", help="auto-convert exports dropped into a folder's inbox/")
    sp.add_argument("folder", nargs="?",
                    default=str(Path.home() / "Documents" / "session_to_session"),
                    help="folder to watch (creates inbox/capsules/primers)")
    sp.add_argument("--to", default="claude", choices=TARGETS,
                    help="target platform to tune primers for")
    sp.add_argument("--interval", type=float, default=3.0,
                    help="poll interval in seconds")
    sp.add_argument("--full", action="store_true",
                    help="include verbatim transcript in primers")
    sp.add_argument("--offline", action="store_true",
                    help="force heuristic summary")
    sp.add_argument("--once", action="store_true",
                    help="single pass then exit (no continuous polling)")
    sp.set_defaults(func=cmd_watch)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    main()

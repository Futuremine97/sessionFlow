"""Auto-detect which adapter understands a given export file."""

from __future__ import annotations

import json
from typing import Any, Optional

from .claude_adapter import ClaudeAdapter
from .chatgpt_adapter import ChatGPTAdapter
from .gemini_adapter import GeminiAdapter
from .paste_adapter import PasteAdapter
from ..capsule import Capsule

ADAPTERS = {
    "claude": ClaudeAdapter,
    "chatgpt": ChatGPTAdapter,
    "gemini": GeminiAdapter,
}


def load_paste(text: str) -> Capsule:
    """Parse pasted plain-text conversation (no export file needed)."""
    return PasteAdapter.load(None, text)


def _maybe_jsonl(text: str) -> Optional[list]:
    """Parse newline-delimited JSON (Claude Code sessions)."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    objs = []
    for ln in lines:
        try:
            objs.append(json.loads(ln))
        except json.JSONDecodeError:
            return None
    return objs


def load_raw(text: str) -> Any:
    """Parse export text into a Python object, trying JSON then JSONL."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        jl = _maybe_jsonl(text)
        if jl is not None:
            return jl
        raise ValueError("Input is neither valid JSON nor JSONL.")


def detect_and_load(text: str, hint: Optional[str] = None) -> Capsule:
    """Return a normalized Capsule, picking the best adapter.

    `hint` (one of ADAPTERS keys, or "paste") forces a specific adapter.
    Plain text that is neither JSON nor JSONL is treated as a pasted
    conversation automatically.
    """
    if hint == "paste":
        return load_paste(text)

    try:
        raw = load_raw(text)
    except ValueError:
        # not JSON/JSONL -> treat as pasted conversation text
        return load_paste(text)

    if hint:
        adapter = ADAPTERS.get(hint.lower())
        if not adapter:
            raise ValueError(f"Unknown platform hint: {hint}")
        return adapter.load(raw, text)

    scored = sorted(
        ((a.sniff(raw, text), name, a) for name, a in ADAPTERS.items()),
        key=lambda x: x[0], reverse=True,
    )
    best_score, best_name, best_adapter = scored[0]
    if best_score <= 0:
        raise ValueError(
            "Could not detect platform. Pass an explicit --from "
            "(claude|chatgpt|gemini)."
        )
    cap = best_adapter.load(raw, text)
    cap.extra["detection"] = {
        "chosen": best_name,
        "confidence": round(best_score, 2),
        "scores": {n: round(s, 2) for s, n, _ in scored},
    }
    return cap

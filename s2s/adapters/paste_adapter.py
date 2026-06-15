"""Paste adapter — the friction-free input.

Instead of asking the user to request a vendor data-export (email, zip,
wait), this adapter parses conversation text that the user simply *pastes*:
selected straight from the ChatGPT / Claude / Gemini web UI, or typed by
hand. It recognizes the common turn markers each UI / human uses and splits
the blob into roles.

Recognized speaker markers (case-insensitive), English + Korean:
    user:        You, User, Me, Human, 사용자, 나, 질문
    assistant:   ChatGPT, Claude, Gemini, Assistant, AI, Bot, 답변, 어시스턴트
    "ChatGPT said:", "Claude said:" style labels are also handled.

If no markers are found at all, the whole blob becomes a single user turn —
still useful, because the compressor and rehydrator can work from it.
"""

from __future__ import annotations

import re
from typing import Any

from .base import BaseAdapter
from ..capsule import Capsule, Turn

_USER_WORDS = ["you", "user", "me", "human", "prompt", "q",
               "사용자", "나", "질문", "유저"]
_ASST_WORDS = ["chatgpt", "claude", "gemini", "assistant", "ai", "bot",
               "gpt", "model", "답변", "어시스턴트", "에이아이"]

# matches a line that begins a new turn, e.g. "You:", "ChatGPT said:", "## User"
_MARKER = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?P<who>[A-Za-z가-힣][\w가-힣 ]{0,24}?)"
    r"(?:\s+said)?\s*[:：]\s*(?P<rest>.*)$",
    re.IGNORECASE)

# platform hint from the pasted text
_PLATFORM_HINT = [
    ("chatgpt", re.compile(r"chatgpt|openai|gpt-?\d", re.I)),
    ("claude", re.compile(r"\bclaude\b|anthropic", re.I)),
    ("gemini", re.compile(r"\bgemini\b|bard|google ai", re.I)),
]


def _classify(who: str) -> str | None:
    w = who.strip().lower()
    for word in _USER_WORDS:
        if w == word or w.startswith(word + " ") or w == word + " said":
            return "user"
    for word in _ASST_WORDS:
        if w == word or w.startswith(word) :
            return "assistant"
    return None


class PasteAdapter(BaseAdapter):
    platform = "paste"

    @classmethod
    def sniff(cls, raw: Any, text: str) -> float:
        # only used as an explicit choice; detection prefers structured JSON.
        # give a low non-zero score so it can be a last resort for plain text.
        if isinstance(raw, (dict, list)):
            return 0.0
        return 0.15

    @classmethod
    def load(cls, raw: Any, text: str) -> Capsule:
        # `raw` is ignored; paste input is always plain text
        blob = text if isinstance(text, str) else str(raw)
        turns = cls._parse(blob)
        platform = "paste"
        for name, pat in _PLATFORM_HINT:
            if pat.search(blob):
                platform = name
                break
        return Capsule(
            source_platform=platform,
            title="Pasted session",
            transcript=turns,
            extra={"ingest": "paste"},
        )

    @classmethod
    def _parse(cls, blob: str) -> list[Turn]:
        lines = blob.splitlines()
        turns: list[Turn] = []
        cur_role: str | None = None
        buf: list[str] = []

        def flush():
            if cur_role and buf:
                body = "\n".join(buf).strip()
                if body:
                    turns.append(Turn(role=cur_role, content=body))

        for line in lines:
            m = _MARKER.match(line)
            role = _classify(m.group("who")) if m else None
            if role:
                flush()
                cur_role = role
                buf = [m.group("rest")] if m.group("rest").strip() else []
            else:
                if cur_role is None:
                    cur_role = "user"   # text before any marker = user context
                buf.append(line)
        flush()

        # no markers detected -> whole blob is one user turn
        if not turns and blob.strip():
            turns = [Turn(role="user", content=blob.strip())]
        # collapse alternation noise: drop empty
        return [t for t in turns if t.content.strip()]

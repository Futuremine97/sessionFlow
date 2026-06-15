"""Claude adapter.

Handles three shapes:

1. Claude.ai data export `conversations.json`: list of conversations, each
   with `chat_messages: [{sender, text/content, created_at}]`.

2. Claude Code session JSONL (one JSON object per line, each with `type`
   and `message: {role, content}`), passed in already-parsed as a list.

3. Anthropic API messages array: [{"role", "content"}] where content may be
   a string or a list of content blocks ({"type": "text", "text": ...}).
"""

from __future__ import annotations

from typing import Any

from .base import BaseAdapter
from ..capsule import Capsule, Turn


class ClaudeAdapter(BaseAdapter):
    platform = "claude"

    @classmethod
    def sniff(cls, raw: Any, text: str) -> float:
        score = 0.0
        if isinstance(raw, list) and raw and isinstance(raw[0], dict):
            keys = set(raw[0].keys())
            if "chat_messages" in keys:
                score = 0.95
            elif "sender" in keys:                       # message-level export
                score = 0.8
            elif raw[0].get("type") in ("user", "assistant") and \
                    "message" in raw[0]:                 # Claude Code JSONL
                score = 0.85
        if isinstance(raw, dict) and "chat_messages" in raw:
            score = 0.9
        low = text.lower()
        if "claude" in low or "anthropic" in low or "claude-" in low:
            score = max(score, 0.6)
        return score

    @classmethod
    def load(cls, raw: Any, text: str) -> Capsule:
        # 1. conversations.json (list of convs with chat_messages)
        if isinstance(raw, dict) and "chat_messages" in raw:
            return cls._load_conv(raw)
        if isinstance(raw, list) and raw and isinstance(raw[0], dict):
            if "chat_messages" in raw[0]:
                conv = max(raw, key=lambda c: c.get("updated_at") or "")
                return cls._load_conv(conv)
            if "sender" in raw[0]:
                return cls._load_message_records(raw)
            if raw[0].get("type") in ("user", "assistant") and \
                    "message" in raw[0]:
                return cls._load_claude_code(raw)
            if {"role", "content"} <= set(raw[0].keys()):
                return cls._load_api(raw)
        return Capsule(source_platform=cls.platform, transcript=[])

    # --- loaders ---------------------------------------------------------- #
    @classmethod
    def _load_conv(cls, conv: dict) -> Capsule:
        turns = cls._load_message_records(conv.get("chat_messages", []),
                                          ret_turns=True)
        return Capsule(
            source_platform=cls.platform,
            source_model=conv.get("model"),
            title=conv.get("name") or conv.get("title") or "Claude session",
            transcript=turns,
        )

    @classmethod
    def _load_message_records(cls, records: list, ret_turns: bool = False):
        turns: list[Turn] = []
        for m in records:
            if not isinstance(m, dict):
                continue
            body = m.get("text")
            if not body and isinstance(m.get("content"), list):
                body = "\n".join(
                    b.get("text", "") for b in m["content"]
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            turns.append(Turn(
                role=cls._norm_role(m.get("sender") or m.get("role", "user")),
                content=(body or "").strip(),
                timestamp=m.get("created_at"),
            ))
        turns = [t for t in turns if t.content]
        if ret_turns:
            return turns
        return Capsule(source_platform=cls.platform,
                       title="Claude session", transcript=turns)

    @classmethod
    def _load_claude_code(cls, raw: list) -> Capsule:
        turns: list[Turn] = []
        for line in raw:
            msg = line.get("message") or {}
            role = cls._norm_role(line.get("type") or msg.get("role", "user"))
            content = msg.get("content")
            if isinstance(content, list):
                body = "\n".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            else:
                body = content or ""
            body = (body or "").strip()
            if body:
                turns.append(Turn(role=role, content=body,
                                  timestamp=line.get("timestamp")))
        return Capsule(source_platform=cls.platform,
                       source_model="claude-code",
                       title="Claude Code session", transcript=turns)

    @classmethod
    def _load_api(cls, raw: list) -> Capsule:
        turns = []
        for m in raw:
            content = m.get("content")
            if isinstance(content, list):
                body = "\n".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            else:
                body = content or ""
            turns.append(Turn(role=cls._norm_role(m.get("role", "user")),
                              content=(body or "").strip()))
        return Capsule(source_platform=cls.platform,
                       title="Claude API session",
                       transcript=[t for t in turns if t.content])

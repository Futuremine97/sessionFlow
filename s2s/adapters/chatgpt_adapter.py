"""ChatGPT adapter.

Handles the two shapes OpenAI exports show up in:

1. The official data-export `conversations.json`: a list of conversations,
   each with a `mapping` of node-id -> {message: {author, content}, parent,
   children}. Order is recovered by walking parent links / create_time.

2. A plain API-style messages array: [{"role": ..., "content": ...}, ...]
   (what you'd copy out of a playground or the API).
"""

from __future__ import annotations

from typing import Any

from .base import BaseAdapter
from ..capsule import Capsule, Turn


class ChatGPTAdapter(BaseAdapter):
    platform = "chatgpt"

    @classmethod
    def sniff(cls, raw: Any, text: str) -> float:
        score = 0.0
        if isinstance(raw, list) and raw and isinstance(raw[0], dict):
            if "mapping" in raw[0]:
                score = 0.95
            elif {"role", "content"} <= set(raw[0].keys()):
                score = 0.4  # generic; could be anyone's messages array
        if isinstance(raw, dict) and "mapping" in raw:
            score = 0.9
        if "openai" in text.lower() or "gpt-" in text.lower():
            score = max(score, 0.6)
        return score

    @classmethod
    def load(cls, raw: Any, text: str) -> Capsule:
        if isinstance(raw, dict) and "mapping" in raw:
            convs = [raw]
        elif isinstance(raw, list) and raw and isinstance(raw[0], dict) \
                and "mapping" in raw[0]:
            convs = raw
        else:
            return cls._load_messages_array(raw)

        # take the most recent conversation by default
        conv = max(convs, key=lambda c: c.get("update_time") or 0)
        title = conv.get("title", "ChatGPT session")
        model = None
        turns: list[Turn] = []

        nodes = conv.get("mapping", {})
        ordered = cls._linearize(nodes)
        for node in ordered:
            msg = node.get("message")
            if not msg:
                continue
            author = (msg.get("author") or {}).get("role", "user")
            meta = msg.get("metadata") or {}
            model = model or meta.get("model_slug")
            content = msg.get("content") or {}
            ctype = content.get("content_type", "text")
            if ctype == "text":
                body = cls._coalesce_text(content.get("parts"))
            else:
                body = cls._coalesce_text(content.get("parts")) or \
                       content.get("text", "")
            body = (body or "").strip()
            if not body:
                continue
            turns.append(Turn(
                role=cls._norm_role(author),
                content=body,
                name=(msg.get("author") or {}).get("name"),
            ))

        return Capsule(
            source_platform=cls.platform,
            source_model=model,
            title=title,
            transcript=turns,
        )

    # --- helpers ---------------------------------------------------------- #
    @classmethod
    def _linearize(cls, nodes: dict) -> list[dict]:
        """Walk the node tree into chronological order.

        Strategy: find the root (no parent), then DFS following the first
        child chain. Real exports are mostly linear; for branched trees we
        fall back to sorting by message.create_time.
        """
        if not nodes:
            return []
        roots = [n for nid, n in nodes.items() if not n.get("parent")]
        ordered: list[dict] = []
        if roots:
            stack = [roots[0]]
            seen = set()
            while stack:
                node = stack.pop()
                nid = id(node)
                if nid in seen:
                    continue
                seen.add(nid)
                ordered.append(node)
                children = node.get("children", []) or []
                # push in reverse so first child is processed first
                for cid in reversed(children):
                    if cid in nodes:
                        stack.append(nodes[cid])
        if not ordered or len(ordered) < len(nodes) // 2:
            ordered = sorted(
                (n for n in nodes.values() if n.get("message")),
                key=lambda n: (n.get("message") or {}).get("create_time") or 0,
            )
        return ordered

    @classmethod
    def _load_messages_array(cls, raw: Any) -> Capsule:
        turns = []
        if isinstance(raw, list):
            for m in raw:
                if not isinstance(m, dict):
                    continue
                turns.append(Turn(
                    role=cls._norm_role(m.get("role", "user")),
                    content=cls._coalesce_text(m.get("content")),
                    name=m.get("name"),
                ))
        return Capsule(source_platform=cls.platform,
                       title="ChatGPT session", transcript=turns)

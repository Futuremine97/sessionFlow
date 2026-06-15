"""Gemini adapter.

Handles:

1. Gemini / Vertex `contents` array: [{"role": "user"|"model",
   "parts": [{"text": ...}]}].

2. A wrapper object {"contents": [...]} or {"messages": [...]}.

Google Takeout's "My Activity" HTML export is intentionally out of scope for
the prototype (it is presentation HTML, not structured turns); the design
doc notes it as a follow-up adapter.
"""

from __future__ import annotations

from typing import Any

from .base import BaseAdapter
from ..capsule import Capsule, Turn


class GeminiAdapter(BaseAdapter):
    platform = "gemini"

    @classmethod
    def sniff(cls, raw: Any, text: str) -> float:
        score = 0.0
        contents = cls._extract_contents(raw)
        if contents and isinstance(contents[0], dict):
            keys = set(contents[0].keys())
            if "parts" in keys and "role" in keys:
                score = 0.9
            elif "parts" in keys:
                score = 0.7
        low = text.lower()
        if "gemini" in low or '"model"' in low and '"parts"' in low:
            score = max(score, 0.65)
        return score

    @classmethod
    def load(cls, raw: Any, text: str) -> Capsule:
        contents = cls._extract_contents(raw)
        model = None
        if isinstance(raw, dict):
            model = raw.get("model") or raw.get("modelVersion")
        turns: list[Turn] = []
        for c in contents:
            if not isinstance(c, dict):
                continue
            body = cls._coalesce_text(c.get("parts"))
            body = (body or "").strip()
            if body:
                turns.append(Turn(role=cls._norm_role(c.get("role", "user")),
                                  content=body))
        title = "Gemini session"
        if isinstance(raw, dict):
            title = raw.get("title", title)
        return Capsule(source_platform=cls.platform, source_model=model,
                       title=title, transcript=turns)

    @staticmethod
    def _extract_contents(raw: Any) -> list:
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("contents") or raw.get("messages") or []
        return []

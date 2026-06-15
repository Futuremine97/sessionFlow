"""Base adapter contract.

Every adapter takes a raw parsed export object (already json.loaded or a raw
string) plus the original text, decides whether it can handle it
(`sniff`), and produces a normalized Capsule (`load`). Adapters NEVER
compress — they only normalize transcripts and pull obvious metadata. The
compressor is a separate, platform-neutral stage.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..capsule import Capsule, Turn


class BaseAdapter(ABC):
    platform: str = "unknown"

    # confidence in [0, 1] that this adapter understands `raw`
    @classmethod
    @abstractmethod
    def sniff(cls, raw: Any, text: str) -> float:
        ...

    @classmethod
    @abstractmethod
    def load(cls, raw: Any, text: str) -> Capsule:
        ...

    # -- shared helpers ---------------------------------------------------- #
    @staticmethod
    def _norm_role(role: str) -> str:
        role = (role or "").lower()
        if role in ("user", "human"):
            return "user"
        if role in ("assistant", "model", "ai", "bot"):
            return "assistant"
        if role in ("system", "developer"):
            return "system"
        if role in ("tool", "function"):
            return "tool"
        return role or "user"

    @staticmethod
    def _coalesce_text(parts: Any) -> str:
        """ChatGPT/Gemini store content as a list of parts; flatten to text."""
        if parts is None:
            return ""
        if isinstance(parts, str):
            return parts
        if isinstance(parts, list):
            out = []
            for p in parts:
                if isinstance(p, str):
                    out.append(p)
                elif isinstance(p, dict):
                    # gemini: {"text": ...}; chatgpt content parts vary
                    out.append(p.get("text") or p.get("content") or "")
            return "\n".join(x for x in out if x)
        if isinstance(parts, dict):
            return parts.get("text") or parts.get("content") or ""
        return str(parts)

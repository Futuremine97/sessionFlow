"""Session Capsule — the platform-neutral interchange format.

A Capsule is the single source of truth that every adapter imports *into*
and every rehydrator exports *from*. Nothing in here is specific to Claude,
ChatGPT or Gemini: that is the whole point. Adapters translate a vendor
export into a Capsule; rehydrators translate a Capsule into a primer tuned
for a target platform.

The format is intentionally JSON-serializable and human-readable so it can
be inspected, diffed in git, and hand-edited.
"""

from __future__ import annotations

import json
import dataclasses
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

SCHEMA_VERSION = "1.0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Leaf records
# --------------------------------------------------------------------------- #
@dataclass
class Turn:
    """One message in the normalized transcript."""
    role: str                      # "user" | "assistant" | "system" | "tool"
    content: str
    timestamp: Optional[str] = None
    name: Optional[str] = None     # tool name / author label, if any

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Decision:
    """A choice that was made and should survive the handoff."""
    statement: str
    rationale: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Artifact:
    """A file / code object / deliverable produced or referenced in session."""
    path: str
    kind: str = "file"             # file | code | url | doc | data
    status: str = "referenced"     # created | modified | referenced | deleted
    summary: Optional[str] = None
    language: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


# --------------------------------------------------------------------------- #
# Compressed context (the "memory" that travels light)
# --------------------------------------------------------------------------- #
@dataclass
class CompressedContext:
    summary: str = ""                                  # narrative recap
    key_facts: list[str] = field(default_factory=list)
    decisions: list[Decision] = field(default_factory=list)
    open_threads: list[str] = field(default_factory=list)   # unfinished work
    glossary: dict[str, str] = field(default_factory=dict)  # project terms
    user_profile: dict[str, str] = field(default_factory=dict)  # prefs/role
    token_estimate: int = 0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["decisions"] = [x.to_dict() if isinstance(x, Decision) else x
                          for x in self.decisions]
        return d


# --------------------------------------------------------------------------- #
# The Capsule
# --------------------------------------------------------------------------- #
@dataclass
class Capsule:
    # provenance
    source_platform: str = "unknown"     # claude | chatgpt | gemini | ...
    source_model: Optional[str] = None
    title: str = "Untitled session"
    created_at: str = field(default_factory=_now)
    captured_at: str = field(default_factory=_now)

    # payload
    transcript: list[Turn] = field(default_factory=list)   # full, lossless
    context: CompressedContext = field(default_factory=CompressedContext)
    artifacts: list[Artifact] = field(default_factory=list)

    # toggles / meta
    include_full_transcript: bool = False  # off by default per requirement
    schema_version: str = SCHEMA_VERSION
    extra: dict[str, Any] = field(default_factory=dict)

    # ---- serialization ---------------------------------------------------- #
    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "source_platform": self.source_platform,
            "source_model": self.source_model,
            "title": self.title,
            "created_at": self.created_at,
            "captured_at": self.captured_at,
            "context": self.context.to_dict(),
            "artifacts": [a.to_dict() for a in self.artifacts],
            "include_full_transcript": self.include_full_transcript,
            "transcript": [t.to_dict() for t in self.transcript]
                          if self.include_full_transcript else [],
            "transcript_turn_count": len(self.transcript),
            "extra": self.extra,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @classmethod
    def from_dict(cls, d: dict) -> "Capsule":
        ctx_d = d.get("context", {})
        extra = dict(d.get("extra", {}))
        # preserve the original turn count even when the verbatim transcript
        # was dropped (include_full_transcript=False) on serialization
        if not d.get("transcript") and d.get("transcript_turn_count"):
            extra.setdefault("transcript_turn_count",
                             d["transcript_turn_count"])
        ctx = CompressedContext(
            summary=ctx_d.get("summary", ""),
            key_facts=ctx_d.get("key_facts", []),
            decisions=[Decision(**x) if isinstance(x, dict) else x
                       for x in ctx_d.get("decisions", [])],
            open_threads=ctx_d.get("open_threads", []),
            glossary=ctx_d.get("glossary", {}),
            user_profile=ctx_d.get("user_profile", {}),
            token_estimate=ctx_d.get("token_estimate", 0),
        )
        return cls(
            source_platform=d.get("source_platform", "unknown"),
            source_model=d.get("source_model"),
            title=d.get("title", "Untitled session"),
            created_at=d.get("created_at", _now()),
            captured_at=d.get("captured_at", _now()),
            transcript=[Turn(**t) for t in d.get("transcript", [])],
            context=ctx,
            artifacts=[Artifact(**a) for a in d.get("artifacts", [])],
            include_full_transcript=d.get("include_full_transcript", False),
            schema_version=d.get("schema_version", SCHEMA_VERSION),
            extra=extra,
        )

    @classmethod
    def from_json(cls, s: str) -> "Capsule":
        return cls.from_dict(json.loads(s))

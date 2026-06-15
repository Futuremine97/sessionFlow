"""Context compression: full transcript  ->  CompressedContext.

The prototype ships a dependency-free *heuristic* compressor so the whole
pipeline runs offline with zero API keys. It extracts the structured signal
that actually needs to survive a handoff:

    - a narrative summary (lead user asks + last assistant state)
    - key facts (stable statements about the project / user)
    - decisions (explicit choices: "we'll use X", "let's go with Y")
    - open threads (TODOs, unfinished work, unanswered questions)
    - a glossary of project-specific terms
    - a user profile (preferences, role, constraints)
    - referenced artifacts (file paths, code fences)

`compress()` takes a pluggable `summarizer` callable so a production
deployment can swap in an LLM pass (see llm_summarizer stub) without
touching the rest of the pipeline.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Callable, Optional

from .capsule import Capsule, CompressedContext, Decision, Artifact

# --------------------------------------------------------------------------- #
# Lightweight signal extractors
# --------------------------------------------------------------------------- #
_DECISION_PAT = re.compile(
    r"\b(let'?s (?:use|go with|do)|we(?:'ll| will| should| decided to)? "
    r"(?:use|pick|choose|go with)|i(?:'ll| will) use|going with|decided to|"
    r"plan is to|we are using|use (?:the )?)\b"
    r"|(?:하기로|쓰기로|사용하기로|가기로)\s*(?:했|함|결정)"
    r"|(?:로|으로)\s*(?:결정|정했|선택)", re.I)
# TODO must look like a real task marker, not the word inside "todo app"
_OPEN_PAT = re.compile(
    r"(?:^|\s)(?:todo|to-do)\s*[:：-]"            # "TODO: ..." style only
    r"|\b(next step|still need|need to|haven'?t|not yet|"
    r"unfinished|remaining|follow up|follow-up|left to do|pending|"
    r"open question|tbd|will (?:add|implement|fix|do))\b"
    r"|(?:아직|남았|해야|다음 단계|할 일|미완|필요해|필요합니다)", re.I)
_PREF_PAT = re.compile(
    r"\b(i prefer|i like|i want|i'?d like|please (?:always|never)|"
    r"don'?t|do not|make sure|i'?m a|my (?:role|job|stack|preference)|"
    r"always|never)\b"
    r"|(?:선호|좋아|원해|원합니다|항상|절대|해주세요|해줘|하지 ?마)", re.I)
_FACT_PAT = re.compile(
    r"\b(is|are|uses|runs on|built (?:with|in|on)|written in|the (?:goal|"
    r"project|app|service|system) (?:is|will))\b"
    r"|(?:이름은|프로젝트는|코드네임|코드명).{0,40}(?:이다|야|입니다|에요|예요|임)"
    r"|.{0,30}(?:으로 만들|로 만들|로 작성|기반)", re.I)
_PATH_PAT = re.compile(r"(?:^|\s)((?:\.{0,2}/)?[\w\-./]+\.[A-Za-z0-9]{1,6})\b")
_CODE_FENCE = re.compile(r"```(\w+)?\n(.*?)```", re.S)
_GLOSSARY_PAT = re.compile(r"\b([A-Z][A-Za-z0-9]{2,})\b")
_STOP = {
    "The", "This", "That", "There", "These", "Those", "Then", "They",
    "And", "But", "For", "You", "Your", "Our", "Was", "Are", "Not",
    "With", "From", "What", "When", "Where", "Which", "Will", "Would",
    "Should", "Could", "Have", "Here", "Just", "Like", "Make", "Need",
    "Use", "Using", "OK", "Okay", "Yes", "Now", "How", "Why", "Can",
}


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if p.strip()]


def _estimate_tokens(text: str) -> int:
    # crude but stable: ~4 chars/token
    return max(1, len(text) // 4)


def _dedupe_keep_order(items: list[str], limit: int) -> list[str]:
    seen, out = set(), []
    for it in items:
        key = it.lower().strip()
        if key and key not in seen:
            seen.add(key)
            out.append(it.strip())
        if len(out) >= limit:
            break
    return out


# --------------------------------------------------------------------------- #
# Heuristic summarizer (default)
# --------------------------------------------------------------------------- #
def heuristic_summary(cap: Capsule) -> str:
    cap.extra.setdefault("summarizer", "heuristic")
    users = [t.content for t in cap.transcript if t.role == "user"]
    assts = [t.content for t in cap.transcript if t.role == "assistant"]
    bits = []
    if users:
        bits.append(f"The session opened with the user asking: "
                    f"\"{_clip(users[0], 240)}\"")
    if len(users) > 1:
        bits.append(f"Across {len(users)} user turns the focus evolved; "
                    f"the latest request was: \"{_clip(users[-1], 200)}\"")
    if assts:
        bits.append(f"The assistant's most recent state: "
                    f"\"{_clip(assts[-1], 240)}\"")
    return " ".join(bits)


def _clip(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# default summarizer signature: (Capsule) -> str
Summarizer = Callable[[Capsule], str]


def compress(cap: Capsule,
             summarizer: Optional[Summarizer] = None,
             max_facts: int = 12,
             max_decisions: int = 10,
             max_open: int = 10) -> Capsule:
    """Populate cap.context (and cap.artifacts) in place; return cap."""
    summarizer = summarizer or heuristic_summary
    facts, decisions, opens, prefs = [], [], [], []
    glossary_counter: Counter = Counter()
    artifacts: dict[str, Artifact] = {}

    for turn in cap.transcript:
        text = turn.content

        # artifacts: code fences
        for lang, body in _CODE_FENCE.findall(text):
            # try to find a filename near the fence
            head = body.strip().splitlines()[0] if body.strip() else ""
            fn = _PATH_PAT.search(head)
            path = fn.group(1) if fn else f"snippet.{lang or 'txt'}"
            artifacts.setdefault(path, Artifact(
                path=path, kind="code", language=lang or None,
                status="created" if turn.role == "assistant" else "referenced",
                summary=_clip(head, 80) or None))

        # artifacts: bare file paths
        for m in _PATH_PAT.findall(text):
            if m in artifacts:
                continue
            if any(m.lower().endswith(e) for e in
                   (".py", ".js", ".ts", ".md", ".json", ".html", ".css",
                    ".yml", ".yaml", ".txt", ".sql", ".sh", ".jsx", ".tsx",
                    ".go", ".rs", ".java", ".docx", ".xlsx", ".pdf", ".csv")):
                artifacts.setdefault(m, Artifact(path=m, kind="file"))

        for sent in _split_sentences(text):
            if len(sent) < 8:
                continue
            # exactly one bucket per sentence, by priority, so a user goal
            # ("I want to build a todo app") doesn't also count as an open TODO
            if turn.role == "user" and _PREF_PAT.search(sent):
                prefs.append(sent)
            elif _DECISION_PAT.search(sent):
                decisions.append(sent)
            elif _OPEN_PAT.search(sent):
                opens.append(sent)
            elif turn.role == "user" and _FACT_PAT.search(sent) \
                    and len(sent) < 200:
                facts.append(sent)

        # glossary candidates: capitalized non-stopwords appearing repeatedly
        for w in _GLOSSARY_PAT.findall(text):
            if w not in _STOP and not w.isupper() or (w.isupper() and len(w) <= 6):
                glossary_counter[w] += 1

    glossary = {w: f"project term (mentioned {c}x)"
                for w, c in glossary_counter.most_common(8) if c >= 2}

    user_profile = {}
    for i, p in enumerate(_dedupe_keep_order(prefs, 8)):
        user_profile[f"pref_{i+1}"] = _clip(p, 160)

    ctx = CompressedContext(
        summary=summarizer(cap),
        key_facts=_dedupe_keep_order(facts, max_facts),
        decisions=[Decision(statement=_clip(d, 220))
                   for d in _dedupe_keep_order(decisions, max_decisions)],
        open_threads=_dedupe_keep_order(opens, max_open),
        glossary=glossary,
        user_profile=user_profile,
    )
    ctx.token_estimate = _estimate_tokens(
        ctx.summary + " ".join(ctx.key_facts)
        + " ".join(d.statement for d in ctx.decisions)
        + " ".join(ctx.open_threads))
    cap.context = ctx

    # merge discovered artifacts with any pre-existing ones
    existing = {a.path for a in cap.artifacts}
    for path, art in artifacts.items():
        if path not in existing:
            cap.artifacts.append(art)
    return cap


# --------------------------------------------------------------------------- #
# Optional LLM summarizer hook (no-op unless wired up by the deployer)
# --------------------------------------------------------------------------- #
def llm_summarizer(call_model: Callable[[str], str]) -> Summarizer:
    """Build a summarizer backed by any chat model.

    `call_model(prompt) -> str`. Kept generic so the same code works whether
    the target is Claude, GPT or Gemini.
    """
    def _summ(cap: Capsule) -> str:
        convo = "\n".join(f"{t.role.upper()}: {t.content}"
                          for t in cap.transcript)[:24000]
        prompt = (
            "Summarize this conversation so a *different* AI assistant can "
            "seamlessly continue it. Capture goals, decisions, current "
            "state, and what to do next. Be concise and concrete.\n\n"
            + convo)
        return call_model(prompt).strip()
    return _summ

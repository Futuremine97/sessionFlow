"""Rehydration: Capsule  ->  a handoff primer tuned for the target platform.

The same Capsule produces a different primer depending on where it's going,
because Claude, ChatGPT and Gemini have different conventions for how you
seed a fresh session (system vs developer message, how they like structure,
how to address "you are continuing prior work").

`build_primer()` returns plain text the user pastes as the first message of
the new session. With `include_full_transcript=True` it appends the verbatim
transcript (the opt-in toggle from the requirements).
"""

from __future__ import annotations

from .capsule import Capsule

# Per-platform framing of the opening line + structural preferences.
_TARGET_STYLE = {
    "claude": {
        "opener": "You are picking up an in-progress working session that was "
                  "previously handled by another AI assistant. Continue it "
                  "seamlessly. Here is the handoff context:",
        "closer": "Acknowledge briefly that you have the context, then "
                  "continue from the open threads.",
        "wrap": "context",   # Claude responds well to XML-ish tags
    },
    "chatgpt": {
        "opener": "Context handoff from a previous AI session. Read it, then "
                  "continue the work as if you had been here the whole time.",
        "closer": "Confirm you're up to speed in one line, then proceed.",
        "wrap": "markdown",
    },
    "gemini": {
        "opener": "You are continuing a session started with another AI "
                  "assistant. Use the following transferred context to keep "
                  "going without losing state.",
        "closer": "Give a one-line confirmation, then take the next step.",
        "wrap": "markdown",
    },
    "generic": {
        "opener": "Handoff context transferred from a previous AI session. "
                  "Continue the work seamlessly.",
        "closer": "Confirm understanding briefly, then continue.",
        "wrap": "markdown",
    },
}


def build_primer(cap: Capsule, target: str = "generic") -> str:
    style = _TARGET_STYLE.get(target.lower(), _TARGET_STYLE["generic"])
    ctx = cap.context
    L: list[str] = []

    L.append(style["opener"])
    L.append("")

    use_xml = style["wrap"] == "context"
    if use_xml:
        L.append("<handoff>")

    # provenance
    src = cap.source_platform
    if cap.source_model:
        src += f" / {cap.source_model}"
    L.append(_section("Origin", target))
    L.append(f"- Transferred from: {src}")
    L.append(f"- Session title: {cap.title}")
    L.append(f"- Captured: {cap.captured_at}")
    L.append("")

    if ctx.summary:
        L.append(_section("Summary", target))
        L.append(ctx.summary)
        L.append("")

    if ctx.user_profile:
        L.append(_section("User profile & preferences", target))
        for v in ctx.user_profile.values():
            L.append(f"- {v}")
        L.append("")

    if ctx.key_facts:
        L.append(_section("Key facts", target))
        for f in ctx.key_facts:
            L.append(f"- {f}")
        L.append("")

    if ctx.decisions:
        L.append(_section("Decisions made", target))
        for d in ctx.decisions:
            line = f"- {d.statement}"
            if d.rationale:
                line += f" (why: {d.rationale})"
            L.append(line)
        L.append("")

    if cap.artifacts:
        L.append(_section("Artifacts / files in play", target))
        for a in cap.artifacts:
            extra = f" — {a.summary}" if a.summary else ""
            L.append(f"- [{a.status}] {a.path} ({a.kind}){extra}")
        L.append("")

    if ctx.open_threads:
        L.append(_section("Open threads — pick up here", target))
        for o in ctx.open_threads:
            L.append(f"- {o}")
        L.append("")

    if ctx.glossary:
        L.append(_section("Glossary", target))
        for term, meaning in ctx.glossary.items():
            L.append(f"- {term}: {meaning}")
        L.append("")

    if use_xml:
        L.append("</handoff>")
        L.append("")

    L.append(style["closer"])

    if cap.include_full_transcript and cap.transcript:
        L.append("")
        L.append(_section("Full transcript (verbatim)", target))
        L.append("")
        for t in cap.transcript:
            label = t.role.upper()
            L.append(f"### {label}")
            L.append(t.content)
            L.append("")

    return "\n".join(L).rstrip() + "\n"


def _section(title: str, target: str) -> str:
    style = _TARGET_STYLE.get(target.lower(), _TARGET_STYLE["generic"])
    if style["wrap"] == "context":
        return f"## {title}"
    return f"## {title}"

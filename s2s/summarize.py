"""LLM-backed summarization with automatic heuristic fallback.

Policy (per requirement "키 있으면 LLM, 없으면 휴리스틱"):
  * If an API key is found in the environment, summarize with that provider.
  * Otherwise, silently fall back to the offline heuristic summarizer.

Providers are detected by env var, in priority order:
  ANTHROPIC_API_KEY  -> Anthropic Messages API
  OPENAI_API_KEY     -> OpenAI Chat Completions API
  GEMINI_API_KEY     -> Google Generative Language API

Only the Python standard library is used (urllib) so there are no extra
dependencies. Any network/credential error degrades gracefully to heuristic.
"""

from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Optional

from .capsule import Capsule
from .compress import heuristic_summary

_SUMMARY_INSTRUCTION = (
    "You are preparing a handoff so a DIFFERENT AI assistant can continue "
    "this session seamlessly. Write a concise but complete briefing covering: "
    "(1) the user's goal, (2) decisions already made, (3) the current state "
    "of the work, and (4) what to do next. Plain prose, no preamble. "
    "Answer in the same language the conversation is mostly written in."
)


def _transcript_text(cap: Capsule, limit: int = 24000) -> str:
    return "\n".join(f"{t.role.upper()}: {t.content}"
                     for t in cap.transcript)[:limit]


# --------------------------------------------------------------------------- #
# Provider calls (stdlib urllib)
# --------------------------------------------------------------------------- #
def _post(url: str, headers: dict, payload: dict, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _anthropic(convo: str, key: str, model: str) -> str:
    out = _post(
        "https://api.anthropic.com/v1/messages",
        {"x-api-key": key, "anthropic-version": "2023-06-01",
         "content-type": "application/json"},
        {"model": model, "max_tokens": 1024,
         "system": _SUMMARY_INSTRUCTION,
         "messages": [{"role": "user", "content": convo}]},
    )
    return "".join(b.get("text", "") for b in out.get("content", [])).strip()


def _openai(convo: str, key: str, model: str) -> str:
    out = _post(
        "https://api.openai.com/v1/chat/completions",
        {"Authorization": f"Bearer {key}", "content-type": "application/json"},
        {"model": model,
         "messages": [{"role": "system", "content": _SUMMARY_INSTRUCTION},
                      {"role": "user", "content": convo}]},
    )
    return out["choices"][0]["message"]["content"].strip()


def _gemini(convo: str, key: str, model: str) -> str:
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    out = _post(
        url, {"content-type": "application/json"},
        {"system_instruction": {"parts": [{"text": _SUMMARY_INSTRUCTION}]},
         "contents": [{"role": "user", "parts": [{"text": convo}]}]},
    )
    cand = out["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in cand).strip()


_PROVIDERS = [
    ("ANTHROPIC_API_KEY", _anthropic,
     lambda: os.getenv("S2S_MODEL", "claude-3-5-haiku-latest")),
    ("OPENAI_API_KEY", _openai,
     lambda: os.getenv("S2S_MODEL", "gpt-4o-mini")),
    ("GEMINI_API_KEY", _gemini,
     lambda: os.getenv("S2S_MODEL", "gemini-1.5-flash")),
]


def active_provider() -> Optional[str]:
    for env, _, _ in _PROVIDERS:
        if os.getenv(env):
            return env
    return None


def smart_summary(cap: Capsule, verbose: bool = False) -> str:
    """Summarize via LLM if a key exists, else heuristic. Never raises."""
    convo = _transcript_text(cap)
    for env, fn, model_fn in _PROVIDERS:
        key = os.getenv(env)
        if not key:
            continue
        try:
            text = fn(convo, key, model_fn())
            if text:
                cap.extra["summarizer"] = f"llm:{env}"
                return text
        except (urllib.error.URLError, urllib.error.HTTPError,
                KeyError, IndexError, TimeoutError, ValueError) as e:
            if verbose:
                print(f"[s2s] LLM summary via {env} failed ({e}); "
                      f"falling back to heuristic.")
            break
    cap.extra["summarizer"] = "heuristic"
    return heuristic_summary(cap)

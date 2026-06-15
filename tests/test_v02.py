"""Tests for v0.2 features: paste adapter, Korean heuristics, fallback,
and the folder watcher."""

import os
import unittest
from pathlib import Path

from s2s.adapters import detect_and_load, load_paste
from s2s.compress import compress
from s2s.summarize import smart_summary, active_provider
from s2s.watch import watch

PASTE = """You: I want to build a todo app in React. I prefer TypeScript.
ChatGPT said: Great, let's use Vite. We decided to use Zustand for state. Edit src/store.ts. Next step: still need to add auth.
You: TODO: add dark mode. 프로젝트 이름은 Nimbus야. 항상 한국어도 지원해줘."""


class TestPasteAdapter(unittest.TestCase):
    def setUp(self):
        self.cap = load_paste(PASTE)
        compress(self.cap)

    def test_roles_split(self):
        roles = [t.role for t in self.cap.transcript]
        self.assertEqual(roles, ["user", "assistant", "user"])

    def test_platform_hint_from_label(self):
        self.assertEqual(self.cap.source_platform, "chatgpt")

    def test_plain_text_autodetects_to_paste(self):
        cap = detect_and_load(PASTE)   # no hint, not JSON
        self.assertEqual(cap.source_platform, "chatgpt")

    def test_todo_app_not_misclassified_as_open(self):
        opens = " ".join(self.cap.context.open_threads).lower()
        self.assertNotIn("build a todo app", opens)   # the false positive
        self.assertTrue(any("dark mode" in o.lower()
                            for o in self.cap.context.open_threads))

    def test_korean_fact_and_pref(self):
        self.assertTrue(any("Nimbus" in f for f in self.cap.context.key_facts))
        self.assertTrue(any("한국어" in p
                            for p in self.cap.context.user_profile.values()))

    def test_artifact_path_detected(self):
        self.assertTrue(any(a.path == "src/store.ts"
                            for a in self.cap.artifacts))


class TestSummarizerFallback(unittest.TestCase):
    def test_falls_back_without_keys(self):
        # ensure no provider keys leak from the environment
        for env in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"):
            os.environ.pop(env, None)
        self.assertIsNone(active_provider())
        cap = load_paste(PASTE)
        text = smart_summary(cap)
        self.assertTrue(text)
        self.assertEqual(cap.extra.get("summarizer"), "heuristic")


class TestWatcher(unittest.TestCase):
    def test_single_pass_creates_outputs(self):
        import tempfile, shutil
        tmp = Path(tempfile.mkdtemp())
        try:
            inbox = tmp / "inbox"
            inbox.mkdir()
            (inbox / "chat.txt").write_text(PASTE, encoding="utf-8")
            watch(str(tmp), target="claude", offline=True, once=True)
            self.assertTrue((tmp / "capsules" / "chat.capsule.json").exists())
            self.assertTrue(
                (tmp / "primers" / "chat.claude.primer.txt").exists())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)

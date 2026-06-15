"""End-to-end + unit tests for the s2s pipeline.

Run:  python -m unittest discover -s tests
"""

import json
import unittest
from pathlib import Path

from s2s.adapters import detect_and_load
from s2s.capsule import Capsule
from s2s.compress import compress
from s2s.rehydrate import build_primer

ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / "examples"


def _load(name):
    return (EX / name).read_text(encoding="utf-8")


class TestDetection(unittest.TestCase):
    def test_chatgpt_detected(self):
        cap = detect_and_load(_load("chatgpt_export.json"))
        self.assertEqual(cap.source_platform, "chatgpt")
        self.assertEqual(cap.source_model, "gpt-4o")
        self.assertGreaterEqual(len(cap.transcript), 3)

    def test_claude_detected(self):
        cap = detect_and_load(_load("claude_export.json"))
        self.assertEqual(cap.source_platform, "claude")
        self.assertEqual(cap.source_model, "claude-opus-4-8")

    def test_gemini_detected(self):
        cap = detect_and_load(_load("gemini_export.json"))
        self.assertEqual(cap.source_platform, "gemini")
        self.assertEqual(cap.transcript[0].role, "user")

    def test_hint_overrides(self):
        cap = detect_and_load(_load("gemini_export.json"), hint="gemini")
        self.assertEqual(cap.source_platform, "gemini")


class TestCompression(unittest.TestCase):
    def setUp(self):
        self.cap = detect_and_load(_load("chatgpt_export.json"))
        compress(self.cap)

    def test_extracts_signal(self):
        c = self.cap.context
        self.assertTrue(c.summary)
        self.assertTrue(any("Stripe" in d.statement for d in c.decisions))
        self.assertTrue(any("idempotency" in o.lower() for o in c.open_threads))
        self.assertTrue(c.user_profile)
        self.assertTrue(any(a.path == "billing/service.py"
                            for a in self.cap.artifacts))

    def test_token_estimate_set(self):
        self.assertGreater(self.cap.context.token_estimate, 0)


class TestRoundTrip(unittest.TestCase):
    def test_json_roundtrip_preserves_context(self):
        cap = detect_and_load(_load("claude_export.json"))
        compress(cap)
        restored = Capsule.from_json(cap.to_json())
        self.assertEqual(restored.context.summary, cap.context.summary)
        self.assertEqual(len(restored.context.decisions),
                         len(cap.context.decisions))
        # transcript dropped by default, count preserved
        self.assertEqual(restored.extra.get("transcript_turn_count"),
                         len(cap.transcript))

    def test_full_transcript_toggle(self):
        cap = detect_and_load(_load("claude_export.json"))
        cap.include_full_transcript = True
        restored = Capsule.from_json(cap.to_json())
        self.assertEqual(len(restored.transcript), len(cap.transcript))


class TestRehydrate(unittest.TestCase):
    def test_target_specific_framing(self):
        cap = detect_and_load(_load("chatgpt_export.json"))
        compress(cap)
        claude_primer = build_primer(cap, "claude")
        gpt_primer = build_primer(cap, "chatgpt")
        self.assertIn("<handoff>", claude_primer)        # Claude gets XML wrap
        self.assertNotIn("<handoff>", gpt_primer)         # ChatGPT does not
        self.assertIn("Open threads", claude_primer)

    def test_full_transcript_appended_only_when_on(self):
        cap = detect_and_load(_load("gemini_export.json"))
        compress(cap)
        self.assertNotIn("Full transcript", build_primer(cap, "chatgpt"))
        cap.include_full_transcript = True
        self.assertIn("Full transcript", build_primer(cap, "chatgpt"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

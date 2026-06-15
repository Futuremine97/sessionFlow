"""Import adapters: vendor export  ->  Capsule."""

from .claude_adapter import ClaudeAdapter
from .chatgpt_adapter import ChatGPTAdapter
from .gemini_adapter import GeminiAdapter
from .paste_adapter import PasteAdapter
from .detect import detect_and_load, load_paste, ADAPTERS

__all__ = [
    "ClaudeAdapter",
    "ChatGPTAdapter",
    "GeminiAdapter",
    "PasteAdapter",
    "detect_and_load",
    "load_paste",
    "ADAPTERS",
]

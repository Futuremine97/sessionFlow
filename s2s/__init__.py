"""session_to_session (s2s)

A platform-neutral service for transferring AI session context between
sessions — same AI or different AI, same model or different model.

Core pipeline:
    import  ->  normalize  ->  compress  ->  rehydrate  ->  primer
    (adapter)  (Capsule)     (Capsule)     (target-tuned handoff prompt)
"""

__version__ = "0.1.0"

from .capsule import Capsule, Turn, Artifact, Decision  # noqa: F401

#!/usr/bin/env bash
# Demo: transfer a session across platforms in every direction.
# Run from the project root:  bash examples/demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# pick whichever Python is available (python3 on macOS, python elsewhere)
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then echo "Python not found"; exit 1; fi

echo "============================================================"
echo " 1. ChatGPT session  ->  Claude primer"
echo "============================================================"
"$PY" -m s2s.cli transfer examples/chatgpt_export.json --to claude \
    --capsule /tmp/helios.capsule.json

echo
echo "============================================================"
echo " 2. Claude session  ->  Gemini primer  (auto-detected source)"
echo "============================================================"
"$PY" -m s2s.cli transfer examples/claude_export.json --to gemini

echo
echo "============================================================"
echo " 3. Gemini session  ->  ChatGPT primer, WITH full transcript"
echo "============================================================"
"$PY" -m s2s.cli transfer examples/gemini_export.json --to chatgpt --full

echo
echo "============================================================"
echo " 4. Inspect the intermediate capsule from step 1"
echo "============================================================"
"$PY" -m s2s.cli inspect /tmp/helios.capsule.json

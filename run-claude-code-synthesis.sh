#!/bin/bash
# run-claude-code-synthesis.sh
# Upload this + implement-synthesis-step.md to your VPS, then run this script.
# Prerequisites: Claude Code CLI installed (npm install -g @anthropic-ai/claude-code)

set -e

TASK_FILE="/root/implement-synthesis-step.md"

# Check Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "Claude Code CLI not found. Installing..."
    npm install -g @anthropic-ai/claude-code
fi

# Check task file exists
if [ ! -f "$TASK_FILE" ]; then
    echo "ERROR: $TASK_FILE not found. Upload it first."
    exit 1
fi

# Step 1: Dump current SOUL.md for Claude Code to read
echo "=== Extracting current SOUL.md ==="
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/SOUL.md > /root/current-soul.md 2>/dev/null || echo "(no existing SOUL.md)"
echo "Current SOUL.md: $(wc -c < /root/current-soul.md) bytes"

# Step 2: Dump current AGENTS.md
echo "=== Extracting current AGENTS.md ==="
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/AGENTS.md > /root/current-agents.md 2>/dev/null || echo "(no existing AGENTS.md)"

echo ""
echo "=== Files ready. Run Claude Code with: ==="
echo ""
echo 'claude "Read /root/implement-synthesis-step.md for the full spec. Then read /root/current-soul.md to see the current state. Add the Delegation Protocol section from the spec into the SOUL.md without removing existing content. Write the updated file to /tmp/SOUL.md, then run: docker cp /tmp/SOUL.md openclaw-openclaw-gateway-1:/home/node/.openclaw/workspace/SOUL.md — verify the result is under 20000 chars and contains the new section."'
echo ""
echo "=== Or run interactively: ==="
echo ""
echo "claude"
echo "Then paste the prompt above."

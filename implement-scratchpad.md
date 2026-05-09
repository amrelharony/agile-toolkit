# Task: Add Cross-Agent Scratchpad Directory

## Context

OpenClaw runs 10 agents (main, writer, researcher, presenter, documenter, scrum-master, ops, scraper, designer, multimedia) inside container `openclaw-openclaw-gateway-1`. Each agent has its own isolated workspace (e.g., `/home/node/.openclaw/workspace-writer/`).

Currently agents have NO shared state for multi-step tasks. If the researcher finds data and then the writer needs it for a LinkedIn post, the main agent has to manually relay everything through the delegation prompt. This wastes tokens and loses detail.

Inspired by Claude Code's coordinator scratchpad (a shared directory where workers read/write without permission prompts), we want a shared scratchpad directory accessible to ALL agents for intermediate outputs.

## What to Build

### 1. Create the scratchpad directory on host

```bash
mkdir -p /root/openclaw/data/scratchpad
chmod 777 /root/openclaw/data/scratchpad
```

### 2. Mount it into the container

Edit the gateway docker-compose file at `/root/openclaw/openclaw/docker-compose.yml`.

Find the volumes section for the gateway service and add:

```yaml
- /root/openclaw/data/scratchpad:/home/node/.openclaw/scratchpad
```

This makes the scratchpad available at `/home/node/.openclaw/scratchpad` inside the container, shared across ALL agent workspaces.

**IMPORTANT:** Read the docker-compose.yml first to understand the existing structure. The gateway service might be named `openclaw-gateway` or similar. Add the volume to the correct service — the one that runs the OpenClaw gateway (container name `openclaw-openclaw-gateway-1`).

After editing:
```bash
cd /root/openclaw/openclaw && docker compose down && docker compose up -d
```

Wait for the container to start, then verify:
```bash
docker exec openclaw-openclaw-gateway-1 ls -la /home/node/.openclaw/scratchpad/
```

### 3. Create auto-cleanup cron job

Add a cron job that deletes files older than 24 hours:

```bash
# Add to root's crontab
(crontab -l 2>/dev/null; echo "0 4 * * * find /root/openclaw/data/scratchpad -type f -mtime +1 -delete 2>/dev/null") | crontab -
```

This runs at 4 AM UTC daily (6 AM Cairo). Files older than 24h get cleaned up.

Also add a size guard — if the scratchpad exceeds 50MB, delete oldest files first:

```bash
# Create the cleanup script
cat > /root/openclaw/data/scratchpad-cleanup.sh << 'EOF'
#!/bin/bash
# Clean scratchpad: remove files >24h old, cap at 50MB total
SCRATCHPAD="/root/openclaw/data/scratchpad"

# Step 1: Remove files older than 24 hours
find "$SCRATCHPAD" -type f -mtime +1 -delete 2>/dev/null

# Step 2: If still over 50MB, remove oldest files until under limit
MAX_MB=50
while true; do
    SIZE_KB=$(du -sk "$SCRATCHPAD" 2>/dev/null | cut -f1)
    SIZE_MB=$((SIZE_KB / 1024))
    if [ "$SIZE_MB" -le "$MAX_MB" ]; then
        break
    fi
    OLDEST=$(find "$SCRATCHPAD" -type f -printf '%T+ %p\n' 2>/dev/null | sort | head -1 | cut -d' ' -f2-)
    if [ -z "$OLDEST" ]; then
        break
    fi
    rm -f "$OLDEST"
    echo "[SCRATCHPAD] Removed $OLDEST (total was ${SIZE_MB}MB, cap ${MAX_MB}MB)"
done
EOF
chmod +x /root/openclaw/data/scratchpad-cleanup.sh
```

Update the crontab to use this script instead:
```bash
(crontab -l 2>/dev/null | grep -v scratchpad; echo "0 4 * * * /root/openclaw/data/scratchpad-cleanup.sh >> /var/log/scratchpad-cleanup.log 2>&1") | crontab -
```

### 4. Update ALL agent SOUL.md files with scratchpad instructions

Add this section to the main agent's SOUL.md (at `/home/node/.openclaw/workspace/SOUL.md`):

```markdown
## Shared Scratchpad
All agents share a scratchpad at `scratchpad/` (relative to your workspace root, actual path: /home/node/.openclaw/scratchpad/).
Use it for multi-step tasks where another agent will continue your work.

### Writing to scratchpad:
- Name files descriptively: `research-open-banking-2026-04-01.md`, `draft-linkedin-fintech.md`
- Include a header comment: `<!-- Agent: researcher | Task: open banking research | Date: 2026-04-01 -->`
- Keep files under 10KB each

### Reading from scratchpad:
- Before starting work, check if there's relevant prior work: `ls scratchpad/`
- Reference scratchpad files when delegating: "Use the research at scratchpad/research-open-banking-2026-04-01.md"

### Rules:
- Files auto-delete after 24 hours — scratchpad is for handoffs, not storage
- Do NOT store sensitive data (API keys, passwords, tokens)
- Do NOT store final outputs — those go to the user
- Use for: research notes, draft outlines, extracted data, intermediate analysis
```

**CRITICAL:** This section must be added to ALL agent workspaces, not just main. The agents are:
- `/home/node/.openclaw/workspace/SOUL.md` (main)
- `/home/node/.openclaw/workspace-writer/SOUL.md`
- `/home/node/.openclaw/workspace-researcher/SOUL.md`
- `/home/node/.openclaw/workspace-presenter/SOUL.md`
- `/home/node/.openclaw/workspace-documenter/SOUL.md`
- `/home/node/.openclaw/workspace-scrum-master/SOUL.md`
- `/home/node/.openclaw/workspace-ops/SOUL.md`
- `/home/node/.openclaw/workspace-scraper/SOUL.md`
- `/home/node/.openclaw/workspace-designer/SOUL.md`
- `/home/node/.openclaw/workspace-multimedia/SOUL.md`

Read each SOUL.md first. If it exists, append the scratchpad section. If it doesn't exist, skip it (the agent may not have a SOUL.md yet).

Use `docker cp` pattern:
```bash
# For each agent workspace:
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace-writer/SOUL.md > /tmp/soul-writer.md
# Append scratchpad section to /tmp/soul-writer.md
docker cp /tmp/soul-writer.md openclaw-openclaw-gateway-1:/home/node/.openclaw/workspace-writer/SOUL.md
```

### 5. Update the Delegation Protocol in main agent's SOUL.md

In the existing `## Delegation Protocol — Never Delegate Raw` section, add this after the "Good delegation examples":

```markdown
### Using the Scratchpad for Multi-Step Tasks

For compound tasks (e.g., "research X then write a post about it"), use the scratchpad as a handoff:

1. Delegate research to @researcher with: "Write findings to scratchpad/research-{topic}-{date}.md"
2. Wait for completion
3. Delegate writing to @writer with: "Use the research at scratchpad/research-{topic}-{date}.md to write a LinkedIn post. [enriched prompt here]"

This avoids token-heavy relay through your own context — the specialist reads the file directly.
```

### 6. Verify the scratchpad path is accessible from all agent contexts

After restarting the container, verify:

```bash
# Check the mount exists
docker exec openclaw-openclaw-gateway-1 ls -la /home/node/.openclaw/scratchpad/

# Test write from inside container
docker exec openclaw-openclaw-gateway-1 sh -c 'echo "test" > /home/node/.openclaw/scratchpad/test.txt && cat /home/node/.openclaw/scratchpad/test.txt && rm /home/node/.openclaw/scratchpad/test.txt'

# Verify it's visible from host
ls -la /root/openclaw/data/scratchpad/

# Check all SOUL.md files have the scratchpad section
docker exec openclaw-openclaw-gateway-1 sh -c 'for ws in /home/node/.openclaw/workspace*/SOUL.md; do echo "=== $ws ===" && grep -c "Shared Scratchpad" "$ws" 2>/dev/null || echo "NOT FOUND"; done'
```

## Constraints

- Do NOT modify any existing SOUL.md content — only APPEND the new section
- Total SOUL.md size must stay under 20,000 characters per agent
- Use `docker cp` to write files into container (not heredocs)
- Backup docker-compose.yml before modifying: `cp docker-compose.yml docker-compose.yml.bak`
- After compose changes: `docker compose down && docker compose up -d`
- The scratchpad mount must survive container restarts (persistent host volume)

## Success Criteria

1. `/home/node/.openclaw/scratchpad/` exists and is writable inside the container
2. Files written inside container appear on host at `/root/openclaw/data/scratchpad/`
3. All agent SOUL.md files contain the "Shared Scratchpad" section
4. Main agent SOUL.md contains the multi-step delegation pattern
5. Cron job is installed for cleanup
6. Total SOUL.md size per agent is under 20,000 characters

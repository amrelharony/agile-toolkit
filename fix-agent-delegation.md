# Task: Fix Agent Delegation — ACP Runtime Not Configured

## Problem
The main agent correctly synthesizes enriched prompts before delegating (Delegation Protocol is working), but delegation itself fails with "ACP runtime isn't configured." The main agent falls back to handling the task itself on GLM-4.7 instead of routing to the specialist on GLM-5.1.

## Current State
- 10 agents registered (confirmed via `openclaw agents list`)
- `openclaw.json` has `subagents.allowAgents` listing only: writer, researcher, presenter, documenter
- Missing from allowAgents: scrum-master, ops, scraper, designer, multimedia
- The ACP (Agent Communication Protocol) runtime is not working even for the 4 allowed agents

## What to Investigate

### Step 1: Read the full openclaw.json
```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json
```
Look for:
- `subagents` section — how is inter-agent communication configured?
- Any `acp` or `runtime` or `protocol` keys
- How agents reference each other (by name? by endpoint?)

### Step 2: Check OpenClaw docs/help for agent communication
```bash
docker exec openclaw-openclaw-gateway-1 openclaw --help 2>&1
docker exec openclaw-openclaw-gateway-1 openclaw agents --help 2>&1
docker exec openclaw-openclaw-gateway-1 openclaw agents call --help 2>&1
```

### Step 3: Check if there's a subagent/delegation mechanism in the SOUL.md syntax
```bash
# Check how delegation is supposed to work — look for @agent syntax or /agent commands
docker exec openclaw-openclaw-gateway-1 grep -r "subagent\|delegate\|@writer\|acp\|agent:call" /home/node/.openclaw/ --include="*.md" --include="*.json" 2>/dev/null | head -30
```

### Step 4: Check the OpenClaw gateway logs for the ACP error
```bash
docker logs openclaw-openclaw-gateway-1 --tail 50 2>&1 | grep -i "acp\|agent\|route\|delegate"
```

### Step 5: Look for agent communication config examples
```bash
# Check if there's documentation in the container
docker exec openclaw-openclaw-gateway-1 find /home/node -name "*.md" -path "*/docs/*" 2>/dev/null
docker exec openclaw-openclaw-gateway-1 find /home/node -name "README*" 2>/dev/null | head -10
```

## What to Fix

Based on investigation, do ONE of these:

### Option A: If ACP needs explicit config in openclaw.json
Add the missing configuration. Common patterns:
- An `acp.enabled: true` flag
- An `acp.runtime` endpoint
- Agent endpoint URLs

Use `jq` to modify openclaw.json safely:
```bash
# Read current config
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json > /tmp/openclaw-backup.json

# Modify with jq (exact changes depend on investigation)
# Then docker cp back
docker cp /tmp/openclaw-updated.json openclaw-openclaw-gateway-1:/home/node/.openclaw/openclaw.json
```

### Option B: If delegation uses @mention syntax in SOUL.md
Update the SOUL.md delegation examples to use the correct syntax. For example, if delegation works via `@writer` mentions in the response, make sure the Delegation Protocol section uses that exact syntax.

### Option C: If agents need to be on the same model endpoint for ACP
Check if ACP only works between agents on the same model. If so, consider whether the cost tradeoff of running writer on GLM-5.1 vs the delegation benefit on GLM-4.7 is worth it.

## Also Fix: Add Missing Agents to allowAgents

Regardless of ACP fix, update `subagents.allowAgents` in openclaw.json to include all 10:
```json
"allowAgents": ["writer", "researcher", "presenter", "documenter", "scrum-master", "ops", "scraper", "designer", "multimedia"]
```

## Constraints
- ALWAYS backup openclaw.json before modifying
- After config changes: `cd /root/openclaw/openclaw && docker compose down && docker compose up -d`
- Verify agents still show up after restart: `docker exec openclaw-openclaw-gateway-1 openclaw agents list`
- Test by sending a message to the bot on Telegram asking it to write a LinkedIn post

## Verification
1. Send "write a LinkedIn post about fintech" to the bot on Telegram
2. The bot should synthesize an enriched prompt (already working)
3. The bot should SUCCESSFULLY delegate to @writer instead of falling back to handling it itself
4. The response should come from GLM-5.1 quality, not GLM-4.7

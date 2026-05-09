# Task: Add Session Continuity Tracking

## Problem

Every Telegram message to ElharonyClaw starts a completely fresh session. If Amr says "write a LinkedIn post about fintech," gets a result, then says "make it shorter" or "now write one about open banking" — the bot has ZERO memory of what just happened. Each message is isolated.

This wastes tokens (re-fetching lessons, re-reading SOUL.md) and breaks conversational flow. The main agent can't distinguish between a follow-up ("tweak the last post") and a brand new request ("research quantum computing").

## Solution

Add a lightweight session context tracker that:
1. Records what agent handled the last task, what topic it was about, and a summary of the output
2. On each new session, checks if there's recent context (within 30 minutes)
3. If yes, injects that context so the agent knows what just happened

## What to Build

### 1. Create the session context table

Add to `/root/.openclaw/learning_loop.db`:

```sql
CREATE TABLE IF NOT EXISTS session_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT DEFAULT 'amr',
    agent_type TEXT NOT NULL,           -- 'writer', 'researcher', 'main', etc.
    topic TEXT NOT NULL,                -- short topic description
    output_summary TEXT,                -- 2-3 sentence summary of what was produced
    full_output TEXT,                   -- the actual output (for "make it shorter" type follow-ups)
    scratchpad_files TEXT,              -- JSON array of scratchpad files created, if any
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT DEFAULT (datetime('now', '+30 minutes'))
);

CREATE INDEX IF NOT EXISTS idx_session_ctx_user ON session_context(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_ctx_expires ON session_context(expires_at);
```

Run this against the DB:
```bash
sqlite3 /root/.openclaw/learning_loop.db < /tmp/session_context_schema.sql
```

### 2. Create the session context server

Create `/root/learning-loop/session_context.py` — a small FastAPI/Flask-like HTTP server (use the same pattern as `lesson_server.py`) that provides two endpoints:

#### POST /webhook/session-context/get
Called at agent bootstrap to check for recent context.

Request:
```json
{"user_id": "amr"}
```

Response (if recent context exists, within 30 min):
```json
{
    "has_context": true,
    "agent_type": "writer",
    "topic": "LinkedIn post about digital transformation failures in banking",
    "output_summary": "Wrote a 194-word LinkedIn post arguing that transformation fails because of culture, not technology. Used $12M platform anecdote. 5 hashtags.",
    "scratchpad_files": ["research-open-banking-egypt-2026-04-01.md"],
    "minutes_ago": 12
}
```

Response (if no recent context):
```json
{
    "has_context": false
}
```

#### POST /webhook/session-context/save
Called after an agent completes a task to record what happened.

Request:
```json
{
    "user_id": "amr",
    "agent_type": "writer",
    "topic": "LinkedIn post about digital transformation failures",
    "output_summary": "194-word post arguing culture > technology. Hook: $12M platform anecdote.",
    "full_output": "Egypt took the smart path — infrastructure first...",
    "scratchpad_files": ["research-open-banking-egypt-2026-04-01.md"]
}
```

Response:
```json
{"saved": true, "id": 42}
```

#### Implementation notes:
- Copy the server pattern from `lesson_server.py` (same HTTP framework, same auth header pattern)
- Listen on port `18792` on `0.0.0.0`
- Read DB path from env or default to `/root/.openclaw/learning_loop.db`
- Auto-clean expired entries (older than 30 min) on every GET request
- Read the webhook secret from env var `WEBHOOK_SECRET` (same as lesson server)

### 3. Dockerize and connect to network

Add to `/root/learning-loop/docker-compose.session-context.yml` OR append to an existing compose file:

```yaml
services:
  session-context:
    image: python:3.11-slim
    container_name: session-context
    restart: unless-stopped
    working_dir: /app
    command: python3 session_context.py
    volumes:
      - /root/learning-loop:/app
      - /root/.openclaw:/data
    environment:
      - DB_PATH=/data/learning_loop.db
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
    networks:
      - openclaw_default
    ports:
      - "127.0.0.1:18792:18792"

networks:
  openclaw_default:
    external: true
```

Check how lesson-server is configured — use the SAME pattern:
```bash
docker inspect lesson-server --format '{{json .HostConfig.Binds}}' | python3 -m json.tool
docker inspect lesson-server --format '{{json .Config.Env}}' | python3 -m json.tool
docker inspect lesson-server --format '{{json .NetworkSettings.Networks}}' | python3 -m json.tool
```

Match the lesson-server's setup exactly (same network, same volume patterns, same env var names).

### 4. Create the bootstrap hook for session context

Create a new hook at `/home/node/.openclaw/hooks/session-context/` with:

#### handler.js
Similar to the learning-recall hook. On `agent:bootstrap`:
1. POST to `http://session-context:18792/webhook/session-context/get` with `{"user_id": "amr"}`
2. If `has_context: true`, inject a virtual file `SESSION_CONTEXT.md` with content like:

```markdown
# Recent Session Context
_12 minutes ago, the writer agent handled this task:_

**Topic:** LinkedIn post about digital transformation failures in banking
**What was produced:** 194-word post arguing culture > technology. Hook: $12M platform anecdote.
**Scratchpad files from that session:** research-open-banking-egypt-2026-04-01.md

If the user's current message is a follow-up (e.g., "make it shorter", "change the angle",
"now write about X instead"), you have context to work with. If it's a completely new topic,
ignore this context.
```

3. If `has_context: false`, inject nothing (or a minimal "No recent context" note)

#### HOOK.md
```yaml
---
name: session-context
description: "Injects recent session context during agent bootstrap for conversational continuity"
event: agent:bootstrap
priority: 5
---

# Session Context Hook

Checks for recent session context (within 30 minutes) and injects it as SESSION_CONTEXT.md
so the agent knows what just happened in the previous interaction.
```

Check the learning-recall hook structure for reference:
```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/hooks/learning-recall/handler.js
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/hooks/learning-recall/HOOK.md
```

Copy the exact pattern — same virtual file injection, same error handling, same auth header.

### 5. Add context SAVING to the main agent's SOUL.md

The hardest part: the agent needs to SAVE context after completing a task. Add this to the main agent's SOUL.md, after the Delegation Protocol section:

```markdown
## Session Context — Saving What You Did

After completing ANY task (or receiving a subagent completion), save the session context
by calling the session context server:

```bash
curl -s -X POST "http://session-context:18792/webhook/session-context/save" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_SECRET" \
  -d '{
    "user_id": "amr",
    "agent_type": "<which agent handled it>",
    "topic": "<2-10 word topic summary>",
    "output_summary": "<2-3 sentence summary of what was produced>",
    "full_output": "<the actual output text>",
    "scratchpad_files": ["<any scratchpad files created>"]
  }'
```

Do this SILENTLY — do not tell the user you're saving context.
This enables follow-up messages like "make it shorter" or "change the angle" to work without repeating everything.
```

**NOTE:** Replace `YOUR_SECRET` with the actual webhook secret from the lesson server's env.

### 6. Register the hook in openclaw.json

Check how learning-recall is registered:
```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json | python3 -c "import json,sys; c=json.load(sys.stdin); print(json.dumps(c.get('hooks',{}), indent=2))"
```

Add `session-context` to the same structure, with the same pattern.

After adding:
```bash
cd /root/openclaw/openclaw && docker compose down && docker compose up -d
```

## Constraints

- Use the SAME patterns as lesson-server (same framework, same auth, same Docker setup)
- DB is root-owned — if running as claude-user, use docker containers to write
- SOUL.md must stay under 20,000 characters after additions
- Use `docker cp` for container file operations
- Backup openclaw.json before modifying

## Verification

1. Session context server starts and responds:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s http://session-context:18792/webhook/session-context/get \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{"user_id": "amr"}'
   ```
   Should return `{"has_context": false}`

2. Save a test context:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s -X POST http://session-context:18792/webhook/session-context/save \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{"user_id":"amr","agent_type":"writer","topic":"test post","output_summary":"test summary","full_output":"test output","scratchpad_files":[]}'
   ```
   Should return `{"saved": true, "id": 1}`

3. Retrieve it:
   Same GET call should now return `{"has_context": true, ...}`

4. Wait 30+ minutes (or manually expire it in DB), then GET should return `{"has_context": false}`

5. End-to-end test via Telegram:
   - Send "write a LinkedIn post about data literacy"
   - Wait for response
   - Send "make it shorter and more provocative"
   - The bot should know what "it" refers to — the LinkedIn post it just wrote

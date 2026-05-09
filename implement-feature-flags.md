# Task: Add Runtime Feature Flags for Agent Behaviors

## Context

OpenClaw agents currently have static behavior defined entirely by SOUL.md files. To experiment with different agent behaviors (e.g., "should researcher use Brave Search or Z.AI search?", "should writer default to short or long posts?", "should main agent ask clarifying questions or auto-enrich?"), you'd need to edit SOUL.md files and restart.

Inspired by Claude Code's GrowthBook-based feature gating (with `tengu_` prefixed flags), we want a lightweight runtime feature flag system that:
1. Stores flags in SQLite (reusing existing learning_loop.db)
2. Gets queried at agent bootstrap via a hook
3. Injects active flags as a `FEATURE_FLAGS.md` virtual file
4. Allows toggling flags without container restarts
5. Supports per-agent and global flags

## What to Build

### 1. Schema

Add to `/root/.openclaw/learning_loop.db`:

```sql
CREATE TABLE IF NOT EXISTS feature_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flag_name TEXT NOT NULL UNIQUE,
    description TEXT,
    enabled INTEGER DEFAULT 1,           -- 1=on, 0=off
    agent_scope TEXT DEFAULT '*',         -- '*' = all agents, or comma-separated: 'writer,researcher'
    value TEXT DEFAULT '',                -- optional value (e.g., 'short', '200', 'brave')
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flags_name ON feature_flags(flag_name);
CREATE INDEX IF NOT EXISTS idx_flags_enabled ON feature_flags(enabled);
```

Run against the DB:
```bash
sqlite3 /root/.openclaw/learning_loop.db < /tmp/feature_flags_schema.sql
```

### 2. Seed initial flags

Insert these starter flags that control real behaviors:

```sql
INSERT OR IGNORE INTO feature_flags (flag_name, description, enabled, agent_scope, value) VALUES
('clarify_before_delegate', 'Main agent asks ONE clarifying question before delegating vague requests', 1, 'main', ''),
('auto_enrich_linkedin', 'Auto-enrich LinkedIn post requests with Amr context without asking', 0, 'main', ''),
('brave_search_primary', 'Use Brave Search as primary search engine (vs Z.AI search)', 1, 'researcher,scraper', ''),
('short_linkedin_default', 'Default LinkedIn posts to 100-150 words instead of 150-200', 0, 'writer', ''),
('save_session_context', 'Save session context after each task for continuity', 1, 'main', ''),
('use_scratchpad_handoff', 'Use scratchpad for multi-agent task handoffs', 1, 'main', ''),
('verbose_reasoning', 'Show detailed reasoning in Telegram responses', 1, '*', ''),
('lesson_recall_enabled', 'Fetch lessons from lesson-server at bootstrap', 1, '*', ''),
('score_decay_enabled', 'Apply 5% weekly decay to unused lessons', 1, '*', ''),
('glm51_escalation', 'Allow escalation to GLM-5.1 agents for quality tasks', 1, 'main', '');
```

### 3. Feature flag server

Create `/root/learning-loop/feature_flags_server.py` — same pattern as lesson_server.py and session_context.py.

Listen on port `18793` on `0.0.0.0`.

#### GET endpoint: POST /webhook/feature-flags/get

Request:
```json
{"agent": "writer"}
```

Response:
```json
{
    "flags": {
        "brave_search_primary": {"enabled": true, "value": ""},
        "verbose_reasoning": {"enabled": true, "value": ""},
        "lesson_recall_enabled": {"enabled": true, "value": ""},
        "score_decay_enabled": {"enabled": true, "value": ""}
    },
    "count": 4
}
```

Logic:
- Return all flags where `enabled = 1`
- Filter by agent scope: include flags where `agent_scope = '*'` OR where the requesting agent name appears in the comma-separated `agent_scope`
- Only return enabled flags (disabled flags are hidden)

#### SET endpoint: POST /webhook/feature-flags/set

Request:
```json
{"flag_name": "short_linkedin_default", "enabled": true}
```

or with value:
```json
{"flag_name": "short_linkedin_default", "enabled": true, "value": "120"}
```

Response:
```json
{"updated": true, "flag_name": "short_linkedin_default", "enabled": true, "value": "120"}
```

#### LIST endpoint: POST /webhook/feature-flags/list

Request:
```json
{}
```

Response — returns ALL flags (enabled and disabled) for admin visibility:
```json
{
    "flags": [
        {"flag_name": "clarify_before_delegate", "description": "...", "enabled": true, "agent_scope": "main", "value": ""},
        {"flag_name": "auto_enrich_linkedin", "description": "...", "enabled": false, "agent_scope": "main", "value": ""},
        ...
    ],
    "total": 10
}
```

#### Implementation notes:
- Copy the HTTP server pattern from lesson_server.py exactly (stdlib http.server)
- Same auth header: `x-webhook-secret`
- Read DB path from env `DB_PATH` or default `/data/learning_loop.db`
- Read port from env `FEATURE_FLAGS_PORT` or default `18793`
- Read secret from env `WEBHOOK_SECRET`

### 4. Dockerize

Create the container matching lesson-server's pattern. Check how lesson-server runs:
```bash
docker inspect lesson-server --format '{{json .HostConfig.Binds}}'
docker inspect lesson-server --format '{{json .Config.Cmd}}'
docker inspect lesson-server --format '{{json .HostConfig.RestartPolicy}}'
```

Start it:
```bash
docker run -d \
  --name feature-flags \
  --restart unless-stopped \
  --network openclaw_default \
  -v /root/learning-loop:/app:ro \
  -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
  -e DB_PATH=/data/learning_loop.db \
  -e FEATURE_FLAGS_PORT=18793 \
  -e WEBHOOK_SECRET=<SAME_SECRET_AS_LESSON_SERVER> \
  -p 127.0.0.1:18793:18793 \
  python:3.12-slim \
  python3 /app/feature_flags_server.py
```

Get the actual webhook secret from lesson-server:
```bash
docker inspect lesson-server --format '{{json .Config.Env}}' | grep -o 'WEBHOOK_SECRET=[^"]*'
```

### 5. Bootstrap hook

Create `/home/node/.openclaw/hooks/feature-flags/` with handler.js and HOOK.md.

#### handler.js
On `agent:bootstrap`:
1. Determine the current agent name from the bootstrap context (check how learning-recall handler.js gets the agent name — look at the `context` or `event` object passed to the handler)
2. POST to `http://feature-flags:18793/webhook/feature-flags/get` with `{"agent": "<agent_name>"}`
3. If flags returned, inject a virtual file `FEATURE_FLAGS.md` with content:

```markdown
# Active Feature Flags
_These flags control your behavior. Respect them._

| Flag | Status | Value |
|------|--------|-------|
| clarify_before_delegate | ON | |
| save_session_context | ON | |
| verbose_reasoning | ON | |
| lesson_recall_enabled | ON | |

## Flag Behavior Rules:
- If `clarify_before_delegate` is ON: ask ONE clarifying question for vague requests before delegating
- If `auto_enrich_linkedin` is ON: skip clarifying questions for LinkedIn posts, auto-enrich with Amr's context
- If `short_linkedin_default` is ON: target 100-150 words for LinkedIn posts (value field may specify exact target)
- If `verbose_reasoning` is OFF: minimize reasoning output in responses
- If `lesson_recall_enabled` is OFF: skip lesson retrieval (useful for debugging)
- If `save_session_context` is OFF: don't save session context after tasks
- If `use_scratchpad_handoff` is OFF: relay results through main agent instead of scratchpad
- If `glm51_escalation` is OFF: handle all tasks on current model, don't spawn sub-agents
```

#### HOOK.md
```yaml
---
name: feature-flags
description: "Injects active feature flags during agent bootstrap for runtime behavior control"
event: agent:bootstrap
priority: 3
---

# Feature Flags Hook

Queries the feature flags server for flags applicable to the current agent
and injects them as FEATURE_FLAGS.md so the agent can adjust behavior at runtime.
```

Check the learning-recall hook for the exact handler pattern:
```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/hooks/learning-recall/handler.js
```

### 6. Register hook in openclaw.json

Add `feature-flags` to the hooks config alongside learning-recall and session-context:

```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json | python3 -c "
import json, sys
c = json.load(sys.stdin)
entries = c.get('hooks', {}).get('internal', {}).get('entries', [])
if not any(e.get('id') == 'feature-flags' for e in entries):
    entries.append({'id': 'feature-flags', 'enabled': True})
    c['hooks']['internal']['entries'] = entries
print(json.dumps(c, indent=2))
" > /tmp/openclaw-updated.json
```

Then deploy and restart.

### 7. Telegram admin commands (optional but powerful)

Add to the main agent's SOUL.md a section about flag management:

```markdown
## Feature Flag Management

You can toggle feature flags at runtime via Telegram. When I say:
- "/flag list" → call POST http://feature-flags:18793/webhook/feature-flags/list to show all flags
- "/flag set <name> on" → call POST http://feature-flags:18793/webhook/feature-flags/set with {"flag_name": "<name>", "enabled": true}
- "/flag set <name> off" → call POST http://feature-flags:18793/webhook/feature-flags/set with {"flag_name": "<name>", "enabled": false}
- "/flag set <name> <value>" → call POST with {"flag_name": "<name>", "enabled": true, "value": "<value>"}

Always include the auth header: x-webhook-secret: <SECRET>

After toggling a flag, confirm the change to the user with the flag name, new status, and description.
```

Replace `<SECRET>` with the actual webhook secret.

## Constraints

- Same patterns as lesson-server and session-context (same framework, auth, Docker setup)
- DB is root-owned — use docker containers for writes if running as claude-user
- Single Python file, stdlib only (http.server, sqlite3, json)
- Use `docker cp` for container file operations
- Backup openclaw.json before modifying

## Verification

1. Server starts:
   ```bash
   docker logs feature-flags
   ```
   Should show "Feature flags server running on http://0.0.0.0:18793"

2. List all flags:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s -X POST http://feature-flags:18793/webhook/feature-flags/list \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{}'
   ```
   Should return 10 flags

3. Get flags for writer:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s -X POST http://feature-flags:18793/webhook/feature-flags/get \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{"agent": "writer"}'
   ```
   Should return only flags scoped to writer or '*'

4. Toggle a flag:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s -X POST http://feature-flags:18793/webhook/feature-flags/set \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{"flag_name": "short_linkedin_default", "enabled": true}'
   ```
   Should return `{"updated": true, ...}`

5. End-to-end: send a message to the bot on Telegram, check if the reasoning mentions FEATURE_FLAGS.md or references flag states

6. Telegram admin: send "/flag list" to the bot, it should call the server and show all flags with their status

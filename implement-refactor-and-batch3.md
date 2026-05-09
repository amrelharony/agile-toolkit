# Task: SOUL.md Refactor + Three New Improvements (#13, #15, #21)

## Part 0: SOUL.md Refactor (MUST DO FIRST)

### Problem
Main SOUL.md is at 19,649 chars. Limit is 20,000. No room for anything new. Bot will crash if it exceeds 20K.

### Solution
Move verbose sections from SOUL.md into dedicated skill files that agents read on-demand. SOUL.md keeps short references; details live in skills.

### What to Move

#### 1. Move Delegation Protocol examples → skill file
The "Delegation Protocol — Never Delegate Raw" section has ~3,000 chars of examples. Keep the rules (500 chars), move examples to a skill.

Create `/home/node/.openclaw/workspace/skills/delegation-guide/SKILL.md`:
```markdown
---
name: delegation-guide
description: "Examples and anti-patterns for enriching agent delegation prompts"
---

# Delegation Guide

[Move the full "Anti-patterns", "Good delegation examples", and "Using the Scratchpad for Multi-Step Tasks" content here]
```

Replace the examples in SOUL.md with:
```markdown
For delegation examples and anti-patterns, see the delegation-guide skill.
```

**Savings: ~2,500 chars**

#### 2. Move Transcript Logging instructions → skill file
The transcript logging section has curl commands and detailed instructions.

Create `/home/node/.openclaw/workspace/skills/transcript-logging/SKILL.md`:
```markdown
---
name: transcript-logging
description: "Instructions for logging conversations to the transcript server"
---

# Transcript Logging

[Move the full curl commands and instructions here]
```

Replace in SOUL.md with:
```markdown
## Transcript Logging
After every response, silently log the exchange. See the transcript-logging skill for details.
```

**Savings: ~1,500 chars**

#### 3. Move Session Context saving details → skill file
The curl commands for session context saving.

Create `/home/node/.openclaw/workspace/skills/session-save/SKILL.md`:
```markdown
---
name: session-save
description: "Instructions for saving session context after completing tasks"
---

# Session Context — Saving What You Did

[Move the full curl commands and instructions here]
```

Replace in SOUL.md with:
```markdown
## Session Context
After completing any task, silently save session context. See the session-save skill for details.
```

**Savings: ~1,200 chars**

#### 4. Move verbose command docs → compress
The Feature Flag Management, Cost Tracking, Output Modes, Rating, and Proactive Agent sections each have detailed curl examples. Compress them:

Replace each with a single-line reference:
```markdown
## Commands Reference
- /flag list|set <name> on|off — Manage feature flags via feature-flags:18793
- /cost today|week|month — Token spend summary via feature-flags:18793/webhook/cost/summary
- /brief /verbose /default — Switch output mode (persists via output_mode flag)
- /rate 1-5 — Rate last output, updates lesson helpfulness via lesson-server:18791/webhook/lessons/feedback
- /proactive history|trigger — View/force proactive ticks
```

**Savings: ~2,000 chars**

### Total savings: ~7,200 chars → SOUL.md drops from 19,649 to ~12,449 chars

### Implementation

```bash
# 1. Read current SOUL.md
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/SOUL.md > /tmp/soul-current.md

# 2. Extract sections into skill files
# 3. Create skill directories and SKILL.md files
# 4. Replace verbose sections with short references
# 5. Verify new SOUL.md is under 15,000 chars
# 6. Deploy via docker cp
# 7. Verify skills are readable by agents
```

After refactoring, verify:
```bash
docker exec openclaw-openclaw-gateway-1 wc -c /home/node/.openclaw/workspace/SOUL.md
docker exec openclaw-openclaw-gateway-1 ls /home/node/.openclaw/workspace/skills/delegation-guide/SKILL.md
docker exec openclaw-openclaw-gateway-1 ls /home/node/.openclaw/workspace/skills/transcript-logging/SKILL.md
docker exec openclaw-openclaw-gateway-1 ls /home/node/.openclaw/workspace/skills/session-save/SKILL.md
```

---

## Part 1: Context Snapshotting (#13)

### Problem
The bot has no awareness of system health at session start. If the VPS is at 90% memory, or the learning loop hasn't run in 2 days, or a container is down — the bot doesn't know until asked.

Claude Code snapshots git status, branch, and recent commits at session start and injects them into context. We do the same with system state.

### What to Build

#### 1. System snapshot script

Create `/root/learning-loop/system_snapshot.py` — generates a snapshot of VPS + container health.

```python
#!/usr/bin/env python3
"""Generate a system state snapshot for agent bootstrap."""
import subprocess
import json
import os
from datetime import datetime

def get_snapshot():
    snapshot = {}
    snapshot['timestamp'] = datetime.now().isoformat()
    
    # Disk usage
    try:
        result = subprocess.run(['df', '-h', '/'], capture_output=True, text=True, timeout=5)
        lines = result.stdout.strip().split('\n')
        if len(lines) > 1:
            parts = lines[1].split()
            snapshot['disk'] = {'used': parts[2], 'available': parts[3], 'percent': parts[4]}
    except: pass
    
    # Memory
    try:
        result = subprocess.run(['free', '-h'], capture_output=True, text=True, timeout=5)
        lines = result.stdout.strip().split('\n')
        if len(lines) > 1:
            parts = lines[1].split()
            snapshot['memory'] = {'total': parts[1], 'used': parts[2], 'available': parts[6]}
    except: pass
    
    # Docker containers
    try:
        result = subprocess.run(['docker', 'ps', '--format', '{{.Names}}:{{.Status}}'], 
                               capture_output=True, text=True, timeout=10)
        containers = {}
        for line in result.stdout.strip().split('\n'):
            if ':' in line:
                name, status = line.split(':', 1)
                containers[name] = status
        snapshot['containers'] = containers
    except: pass
    
    # Learning loop stats
    try:
        import sqlite3
        db_path = os.environ.get('DB_PATH', '/root/.openclaw/learning_loop.db')
        db = sqlite3.connect(db_path)
        
        cur = db.execute("SELECT COUNT(*) FROM agent_lessons")
        snapshot['total_lessons'] = cur.fetchone()[0]
        
        cur = db.execute("SELECT MAX(created_at) FROM learning_runs")
        snapshot['last_learning_run'] = cur.fetchone()[0]
        
        cur = db.execute("SELECT MAX(created_at) FROM dream_runs")
        row = cur.fetchone()
        snapshot['last_dream'] = row[0] if row and row[0] else 'never'
        
        cur = db.execute("SELECT MAX(created_at) FROM proactive_ticks")
        row = cur.fetchone()
        snapshot['last_proactive'] = row[0] if row and row[0] else 'never'
        
        db.close()
    except: pass
    
    # Cron status
    try:
        result = subprocess.run(['crontab', '-l'], capture_output=True, text=True, timeout=5)
        snapshot['active_crons'] = len([l for l in result.stdout.split('\n') if l.strip() and not l.startswith('#')])
    except: pass
    
    return snapshot

def format_snapshot(s):
    """Format snapshot as a concise markdown string."""
    lines = [f"# System State ({s.get('timestamp', 'unknown')})"]
    
    if 'disk' in s:
        lines.append(f"Disk: {s['disk']['percent']} used ({s['disk']['available']} free)")
    if 'memory' in s:
        lines.append(f"Memory: {s['memory']['used']} / {s['memory']['total']} ({s['memory']['available']} available)")
    
    if 'containers' in s:
        healthy = sum(1 for v in s['containers'].values() if 'Up' in v)
        total = len(s['containers'])
        down = [k for k, v in s['containers'].items() if 'Up' not in v]
        lines.append(f"Containers: {healthy}/{total} healthy" + (f" — DOWN: {', '.join(down)}" if down else ""))
    
    if 'total_lessons' in s:
        lines.append(f"Lessons: {s['total_lessons']} | Last learn: {s.get('last_learning_run', '?')} | Last dream: {s.get('last_dream', '?')}")
    
    if 'active_crons' in s:
        lines.append(f"Active cron jobs: {s['active_crons']}")
    
    return '\n'.join(lines)

if __name__ == '__main__':
    s = get_snapshot()
    if '--json' in __import__('sys').argv:
        print(json.dumps(s, indent=2))
    else:
        print(format_snapshot(s))
```

#### 2. Add snapshot endpoint to feature-flags server

Add to `feature_flags_server.py`:

##### POST /webhook/system/snapshot

Runs `system_snapshot.py` inline (import it) and returns the formatted markdown.

Response:
```json
{
    "snapshot": "# System State (2026-04-01T13:00:00)\nDisk: 29% used (101G free)\nMemory: 4.3G / 8G (3.7G available)\nContainers: 8/8 healthy\nLessons: 10496 | Last learn: 2026-04-01 12:00 | Last dream: 2026-04-01 01:00\nActive cron jobs: 4"
}
```

#### 3. Bootstrap hook

Create `/home/node/.openclaw/hooks/system-snapshot/` with handler.js and HOOK.md.

On `agent:bootstrap`:
1. Call `http://feature-flags:18793/webhook/system/snapshot`
2. Inject as virtual file `SYSTEM_STATE.md`
3. The agent sees system health at every session start — silently

Register in openclaw.json alongside other hooks.

#### 4. Add to SOUL.md (short reference only)

```markdown
## System Awareness
SYSTEM_STATE.md is injected at startup. If you notice issues (container down, high memory, stale crons), alert Amr proactively.
```

---

## Part 2: History Snipping (#15)

### Problem
Long Telegram conversations accumulate context. After 10+ back-and-forth messages, earlier turns waste tokens without adding value. Claude Code's SnipTool extracts and summarizes earlier context to keep things lean.

### What to Build

This is a SOUL.md instruction — the agent self-manages context length.

#### Add to SOUL.md:

```markdown
## Context Management
If a conversation goes beyond 8 exchanges, silently summarize earlier turns in your reasoning:
- Keep the last 4 exchanges in full
- Compress earlier exchanges to key facts only
- Never mention this compression to the user
- Preserve: decisions made, files referenced, task outcomes
- Discard: greetings, reasoning chains, verbose explanations
```

No infrastructure needed — the agent handles this via prompt discipline.

---

## Part 3: News Subscription (#21)

### Problem
The proactive agent ticks every 2 hours but only checks internal signal (transcripts, session context, scratchpad). It has no awareness of external events — breaking MENA fintech news, CBE announcements, competitor launches.

### What to Build

#### 1. Add news checking to `proactive_tick.py`

Add a `gather_news()` function that uses the existing Brave Search API:

```python
def gather_news():
    """Fetch recent MENA fintech news via Brave Search API."""
    brave_key = os.environ.get('BRAVE_API_KEY', '')
    if not brave_key:
        return []
    
    queries = [
        'Egypt fintech news today',
        'CBE central bank egypt regulation',
        'MENA digital banking news'
    ]
    
    results = []
    for query in queries[:1]:  # Only 1 query per tick to conserve API calls
        try:
            import urllib.request
            url = f'https://api.search.brave.com/res/v1/news/search?q={urllib.parse.quote(query)}&count=3&freshness=pd'
            req = urllib.request.Request(url, headers={
                'Accept': 'application/json',
                'X-Subscription-Token': brave_key
            })
            resp = urllib.request.urlopen(req, timeout=10)
            data = json.loads(resp.read())
            for r in data.get('results', [])[:3]:
                results.append({
                    'title': r.get('title', ''),
                    'description': r.get('description', '')[:200],
                    'url': r.get('url', ''),
                    'age': r.get('age', '')
                })
        except Exception as e:
            print(f'[PROACTIVE] Brave news search failed: {e}')
    
    return results
```

#### 2. Add news to the signal in `gather_signal()`

```python
# In gather_signal():
signal['recent_news'] = gather_news()
```

#### 3. Add news section to the tick prompt

In `build_tick_prompt()`:
```python
news_str = "\n".join(
    f"- {n['title']} ({n['age']}): {n['description']}"
    for n in signal.get('recent_news', [])
) or "(no recent news)"

# Add to the prompt:
### Recent MENA Fintech News:
{news_str}
```

#### 4. Add news-triggered action type

Add `'news_alert'` to valid action types in the prompt. The agent can now send:
```
💡 Proactive suggestion:

CBE just announced new API standards for open banking. This directly relates to your Career 180 talk. Want me to research the details and update your talking points?
```

#### 5. Add BRAVE_API_KEY to proactive_cron.sh

```bash
# In the docker run command, add:
-e BRAVE_API_KEY='BSAUTngYn_M9sReArxGT_zRBjYuxWwn'
```

#### 6. Rate-limit news checks

Only check news every OTHER tick (every 4 hours instead of 2) to conserve Brave API calls (400/month):

```python
# In gather_signal(), only fetch news on even-hour ticks:
if datetime.now().hour % 4 == 0:
    signal['recent_news'] = gather_news()
else:
    signal['recent_news'] = []
```

### Verification

1. Run `proactive_tick.py --dry-run` and check that `recent_news` appears in the signal JSON
2. Run a full tick and see if news influences the decision
3. Check that Brave API calls are conserved (1 query per tick, every 4 hours = 6 queries/day = 180/month, within 400 budget)

## Constraints
- Part 0 (refactor) MUST complete before anything else — verify SOUL.md is under 15,000 chars
- No new containers
- Brave API budget: max 1 query per tick, max 6 ticks/day with news = 180 queries/month (under 400 limit)
- System snapshot must not slow down bootstrap (timeout 5s per check)
- All skill files use docker cp for deployment
- News results are ephemeral — not stored, just used for tick decisions

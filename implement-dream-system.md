# Task: Add Transcript Logging + Dream Consolidation

## Overview

This implements TWO linked improvements inspired by Claude Code's "Dream" system:

1. **Transcript Logging (#9)** — Records every agent conversation as JSONL files, giving the dream system raw material to consolidate
2. **Dream Consolidation (#7)** — A periodic "dream" pass that reads transcripts, lessons, and memory files, then consolidates them into durable, well-organized knowledge

Together these create a reflective loop: the bot has conversations → transcripts are logged → the dream process reviews them → durable memories are written → future sessions benefit from consolidated wisdom.

## Part A: Transcript Logging

### What to Build

#### 1. Schema

Add to `/root/.openclaw/learning_loop.db`:

```sql
CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    role TEXT NOT NULL,              -- 'user' or 'assistant'
    content TEXT NOT NULL,
    tool_calls TEXT,                 -- JSON of any tool calls made
    tokens_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_agent ON transcripts(agent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_date ON transcripts(created_at);
```

#### 2. Transcript server

Create `/root/learning-loop/transcript_server.py` — same pattern as lesson_server.py.

Listen on port `18794` on `0.0.0.0`.

##### POST /webhook/transcript/log

Called after each agent turn to log the exchange.

Request:
```json
{
    "session_id": "abc-123",
    "agent_type": "writer",
    "role": "assistant",
    "content": "Here's your LinkedIn post...",
    "tool_calls": [],
    "tokens_used": 1500
}
```

Response:
```json
{"logged": true, "id": 42}
```

##### POST /webhook/transcript/search

Search transcripts by keyword (for the dream system).

Request:
```json
{
    "query": "open banking",
    "agent_type": "writer",
    "limit": 20,
    "days_back": 7
}
```

Response:
```json
{
    "results": [
        {
            "session_id": "abc-123",
            "agent_type": "writer",
            "role": "assistant",
            "content": "Here's your LinkedIn post about open banking...",
            "created_at": "2026-04-01T10:30:00"
        }
    ],
    "count": 1
}
```

Search uses SQLite FTS5 or LIKE for keyword matching. Keep it simple — grep-style, not vector search.

##### POST /webhook/transcript/recent

Get recent transcripts for dream consolidation.

Request:
```json
{
    "days_back": 7,
    "limit": 100
}
```

Response:
```json
{
    "transcripts": [...],
    "count": 45
}
```

#### 3. Also write JSONL files to disk

In addition to the DB, write each transcript entry as a JSONL line to daily files at:
```
/root/openclaw/data/transcripts/YYYY/MM/YYYY-MM-DD.jsonl
```

This mirrors Claude Code's Dream system which reads transcripts from daily JSONL files.

Each line:
```json
{"session_id":"abc","agent_type":"writer","role":"assistant","content":"...","tokens_used":1500,"created_at":"2026-04-01T10:30:00"}
```

Create directories automatically: `os.makedirs(path, exist_ok=True)`

#### 4. Dockerize

Same pattern as other servers:

```bash
docker run -d \
  --name transcript-server \
  --restart unless-stopped \
  --network openclaw_default \
  -v /root/learning-loop:/app:ro \
  -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
  -v /root/openclaw/data/transcripts:/transcripts:rw \
  -e DB_PATH=/data/learning_loop.db \
  -e TRANSCRIPT_DIR=/transcripts \
  -e TRANSCRIPT_PORT=18794 \
  -e WEBHOOK_SECRET=<SAME_SECRET> \
  -p 127.0.0.1:18794:18794 \
  python:3.12-slim \
  python3 /app/transcript_server.py
```

Get the webhook secret from lesson-server:
```bash
docker inspect lesson-server --format '{{json .Config.Env}}' | python3 -c "import json,sys; [print(e) for e in json.load(sys.stdin) if 'WEBHOOK' in e]"
```

#### 5. Bootstrap hook for transcript logging

Create `/home/node/.openclaw/hooks/transcript-log/` with handler.js and HOOK.md.

This hook is DIFFERENT from the others — it fires on `agent:response` (after the agent responds), not `agent:bootstrap`.

Check what events OpenClaw hooks support:
```bash
docker exec openclaw-openclaw-gateway-1 openclaw hooks --help 2>&1
docker exec openclaw-openclaw-gateway-1 openclaw docs hooks 2>&1 | head -60
```

If `agent:response` isn't available, use an alternative approach: add transcript logging instructions to the main agent's SOUL.md so the agent itself calls the transcript server after each response.

**SOUL.md approach (fallback if no response hook exists):**

Add to main agent's SOUL.md:
```markdown
## Transcript Logging

After EVERY response (including subagent completions), silently log the exchange:

```bash
curl -s -X POST "http://transcript-server:18794/webhook/transcript/log" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <SECRET>" \
  -d '{
    "session_id": "<current session or message ID>",
    "agent_type": "<which agent handled this>",
    "role": "assistant",
    "content": "<your response text, truncated to 2000 chars>",
    "tool_calls": [],
    "tokens_used": 0
  }'
```

Also log the user's original message:
```bash
curl -s -X POST "http://transcript-server:18794/webhook/transcript/log" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <SECRET>" \
  -d '{
    "session_id": "<same session ID>",
    "agent_type": "main",
    "role": "user",
    "content": "<user message, truncated to 2000 chars>"
  }'
```

Do this SILENTLY — never mention logging to the user.
```

Register in openclaw.json if using hook approach.

---

## Part B: Dream Consolidation

### What to Build

#### 1. Create `/root/learning-loop/dream.py`

A Python script that performs a reflective consolidation pass — the bot's "dream." It runs as a cron job (not a persistent server).

##### The Dream Prompt

The script calls GLM-4.7 with a consolidation prompt modeled on Claude Code's `consolidationPrompt.ts`. The prompt has four phases:

**Phase 1 — Orient:**
- Read current LESSONS_INDEX.md
- Read current MEMORY.md files from the workspace
- Check what topic files already exist so we improve them, not duplicate

**Phase 2 — Gather Recent Signal:**
- Query transcript server for recent transcripts (last 7 days):
  `POST http://transcript-server:18794/webhook/transcript/recent {"days_back": 7, "limit": 100}`
- Query learning_loop.db for new high-scoring lessons (score >= 7) created since last dream
- Check session_context table for recurring topics

**Phase 3 — Consolidate:**
- For each significant finding, write or update a memory file
- Convert relative dates to absolute dates
- Delete contradicted facts
- Merge new signal into existing topic files rather than creating duplicates

**Phase 4 — Prune and Index:**
- Keep total memory under 25KB
- Update LESSONS_INDEX.md by calling `python3 build_index.py`
- Remove stale pointers
- Resolve contradictions between files

##### Implementation

```python
#!/usr/bin/env python3
"""
Dream Consolidation for ElharonyClaw
Inspired by Claude Code's autoDream system.
"""

import sqlite3
import json
import os
import requests
from datetime import datetime, timedelta

DB_PATH = os.environ.get('DB_PATH', '/root/.openclaw/learning_loop.db')
TRANSCRIPT_URL = 'http://localhost:18794'  # When running on host
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')
MEMORY_DIR = '/root/openclaw/data/memory'
GLM_API_KEY = os.environ.get('GLM_API_KEY', '')
GLM_BASE_URL = os.environ.get('GLM_BASE_URL', 'https://api.z.ai/api/coding/paas/v4')

def build_consolidation_prompt(memory_files, recent_transcripts, new_lessons, recurring_topics):
    """Build the dream prompt following Claude Code's 4-phase pattern."""
    
    prompt = f"""# Dream: Memory Consolidation

You are performing a dream — a reflective pass over ElharonyClaw's memory files.
Synthesize what you've learned recently into durable, well-organized memories
so that future sessions can orient quickly.

Today's date: {datetime.now().strftime('%Y-%m-%d')}

---

## Phase 1 — Orient

Current memory files:
{chr(10).join(f'- {name}: {content[:200]}...' for name, content in memory_files.items()) if memory_files else '(no existing memory files)'}

## Phase 2 — Gather Recent Signal

### Recent Conversations (last 7 days):
{chr(10).join(f'- [{t["agent_type"]}] {t["role"]}: {t["content"][:150]}...' for t in recent_transcripts[:30]) if recent_transcripts else '(no recent transcripts)'}

### New High-Quality Lessons (score >= 7):
{chr(10).join(f'- [{l["task_type"]}] (score {l["score"]}): {l["lesson"][:150]}' for l in new_lessons[:20]) if new_lessons else '(no new lessons since last dream)'}

### Recurring Topics (from session context):
{chr(10).join(f'- {t["topic"]} (appeared {t["count"]}x)' for t in recurring_topics) if recurring_topics else '(no recurring topics)'}

## Phase 3 — Consolidate

Based on the signal above, produce a JSON array of memory updates. Each update should be one of:
- CREATE: new memory file with a clear topic
- UPDATE: modify existing memory with new information
- DELETE: remove contradicted or stale memory

Format your response as ONLY a JSON array:
```json
[
    {{
        "action": "CREATE",
        "filename": "topic-name.md",
        "content": "# Topic Name\\n\\nContent here with absolute dates..."
    }},
    {{
        "action": "UPDATE",
        "filename": "existing-topic.md",
        "content": "# Updated Topic\\n\\nMerged content..."
    }},
    {{
        "action": "DELETE",
        "filename": "stale-topic.md",
        "reason": "Contradicted by newer information"
    }}
]
```

Rules:
- Convert relative dates ("yesterday", "last week") to absolute dates (2026-04-01)
- Merge new signal into existing topics rather than creating near-duplicates
- Each memory file should be under 2KB
- Focus on DURABLE knowledge: patterns, preferences, recurring themes, key decisions
- Do NOT store ephemeral data: specific message content, temporary tasks, one-off requests
- DO store: Amr's evolving preferences, project status updates, relationship context, recurring challenges

## Phase 4 — Prune

If total memory would exceed 25KB after your updates, indicate which files to DELETE in your response.
Prioritize keeping: recent, frequently-referenced, high-impact memories.
Deprioritize: old, narrow, rarely-relevant memories.

Respond with ONLY the JSON array. No explanation, no markdown fences.
"""
    return prompt


def get_recent_transcripts(days_back=7, limit=100):
    """Fetch recent transcripts from the transcript server."""
    try:
        resp = requests.post(
            f'{TRANSCRIPT_URL}/webhook/transcript/recent',
            json={'days_back': days_back, 'limit': limit},
            headers={
                'Content-Type': 'application/json',
                'x-webhook-secret': WEBHOOK_SECRET
            },
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json().get('transcripts', [])
    except Exception as e:
        print(f'[DREAM] Transcript fetch failed: {e}')
    return []


def get_new_lessons(db, since_days=7):
    """Get high-quality lessons created since last dream."""
    cutoff = (datetime.now() - timedelta(days=since_days)).strftime('%Y-%m-%d')
    cur = db.execute("""
        SELECT task_type, lesson, score, created_at
        FROM agent_lessons
        WHERE score >= 7.0 AND created_at >= ?
        ORDER BY score DESC
        LIMIT 20
    """, (cutoff,))
    return [dict(zip(['task_type', 'lesson', 'score', 'created_at'], row)) for row in cur.fetchall()]


def get_recurring_topics(db, since_days=7):
    """Find recurring topics from session context."""
    cutoff = (datetime.now() - timedelta(days=since_days)).strftime('%Y-%m-%d')
    cur = db.execute("""
        SELECT topic, COUNT(*) as count
        FROM session_context
        WHERE created_at >= ?
        GROUP BY topic
        HAVING count >= 2
        ORDER BY count DESC
        LIMIT 10
    """, (cutoff,))
    return [{'topic': row[0], 'count': row[1]} for row in cur.fetchall()]


def read_memory_files(memory_dir):
    """Read existing memory files."""
    memories = {}
    if os.path.exists(memory_dir):
        for f in os.listdir(memory_dir):
            if f.endswith('.md'):
                with open(os.path.join(memory_dir, f)) as fh:
                    memories[f] = fh.read()
    return memories


def call_glm(prompt):
    """Call GLM-4.7 for consolidation."""
    resp = requests.post(
        f'{GLM_BASE_URL}/chat/completions',
        headers={
            'Authorization': f'Bearer {GLM_API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'model': 'glm-4.7',
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.3,
            'max_tokens': 4000
        },
        timeout=60
    )
    resp.raise_for_status()
    return resp.json()['choices'][0]['message']['content']


def apply_updates(updates, memory_dir):
    """Apply memory updates from the dream."""
    os.makedirs(memory_dir, exist_ok=True)
    created, updated, deleted = 0, 0, 0
    
    for update in updates:
        action = update.get('action', '').upper()
        filename = update.get('filename', '')
        filepath = os.path.join(memory_dir, filename)
        
        if not filename or '..' in filename or '/' in filename:
            print(f'[DREAM] Skipping invalid filename: {filename}')
            continue
        
        if action == 'CREATE':
            with open(filepath, 'w') as f:
                f.write(update.get('content', ''))
            created += 1
            print(f'[DREAM] Created: {filename}')
        
        elif action == 'UPDATE':
            with open(filepath, 'w') as f:
                f.write(update.get('content', ''))
            updated += 1
            print(f'[DREAM] Updated: {filename}')
        
        elif action == 'DELETE':
            if os.path.exists(filepath):
                os.remove(filepath)
                deleted += 1
                print(f'[DREAM] Deleted: {filename} — {update.get("reason", "")}')
        
    return created, updated, deleted


def check_dream_gates(db):
    """Three-gate trigger system inspired by Claude Code's autoDream."""
    
    # Gate 1: Time — at least 24 hours since last dream
    cur = db.execute("""
        SELECT MAX(created_at) FROM dream_runs
    """)
    last_dream = cur.fetchone()[0]
    if last_dream:
        last_dt = datetime.fromisoformat(last_dream)
        hours_since = (datetime.now() - last_dt).total_seconds() / 3600
        if hours_since < 24:
            print(f'[DREAM] Gate 1 BLOCKED: Only {hours_since:.1f}h since last dream (need 24h)')
            return False
    
    # Gate 2: Activity — at least 5 transcript entries since last dream
    if last_dream:
        cur = db.execute("""
            SELECT COUNT(*) FROM transcripts WHERE created_at > ?
        """, (last_dream,))
    else:
        cur = db.execute("SELECT COUNT(*) FROM transcripts")
    
    transcript_count = cur.fetchone()[0]
    if transcript_count < 5:
        print(f'[DREAM] Gate 2 BLOCKED: Only {transcript_count} transcripts since last dream (need 5)')
        return False
    
    # Gate 3: Lock — no concurrent dreams (simple file lock)
    lock_file = '/tmp/dream.lock'
    if os.path.exists(lock_file):
        # Check if lock is stale (older than 10 minutes)
        lock_age = (datetime.now() - datetime.fromtimestamp(os.path.getmtime(lock_file))).total_seconds()
        if lock_age < 600:
            print(f'[DREAM] Gate 3 BLOCKED: Lock file exists ({lock_age:.0f}s old)')
            return False
        else:
            os.remove(lock_file)
    
    print(f'[DREAM] All gates passed (last dream: {last_dream or "never"}, transcripts: {transcript_count})')
    return True


def dream():
    """Main dream consolidation function."""
    print(f'[DREAM] Starting dream at {datetime.now().isoformat()}')
    
    db = sqlite3.connect(DB_PATH)
    
    # Create dream_runs table if not exists
    db.execute("""
        CREATE TABLE IF NOT EXISTS dream_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created INTEGER DEFAULT 0,
            updated INTEGER DEFAULT 0,
            deleted INTEGER DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    db.commit()
    
    # Check three gates
    if not check_dream_gates(db):
        db.close()
        return
    
    # Acquire lock
    lock_file = '/tmp/dream.lock'
    with open(lock_file, 'w') as f:
        f.write(str(os.getpid()))
    
    try:
        # Phase 1: Orient
        memory_dir = os.environ.get('MEMORY_DIR', '/root/openclaw/data/memory')
        memories = read_memory_files(memory_dir)
        print(f'[DREAM] Orient: {len(memories)} existing memory files')
        
        # Phase 2: Gather
        transcripts = get_recent_transcripts(days_back=7, limit=100)
        new_lessons = get_new_lessons(db, since_days=7)
        recurring_topics = get_recurring_topics(db, since_days=7)
        print(f'[DREAM] Gather: {len(transcripts)} transcripts, {len(new_lessons)} lessons, {len(recurring_topics)} recurring topics')
        
        if not transcripts and not new_lessons:
            print('[DREAM] No new signal to consolidate. Skipping.')
            db.execute("INSERT INTO dream_runs (created, updated, deleted) VALUES (0, 0, 0)")
            db.commit()
            db.close()
            return
        
        # Phase 3: Consolidate
        prompt = build_consolidation_prompt(memories, transcripts, new_lessons, recurring_topics)
        print(f'[DREAM] Calling GLM-4.7 for consolidation ({len(prompt)} chars)...')
        
        response = call_glm(prompt)
        
        # Parse JSON response
        response = response.strip()
        if response.startswith('```'):
            response = response.split('\n', 1)[1].rsplit('```', 1)[0]
        
        try:
            updates = json.loads(response)
        except json.JSONDecodeError as e:
            print(f'[DREAM] Failed to parse GLM response as JSON: {e}')
            print(f'[DREAM] Response: {response[:500]}')
            db.close()
            return
        
        if not isinstance(updates, list):
            print(f'[DREAM] Expected list, got {type(updates)}')
            db.close()
            return
        
        # Apply updates
        created, updated, deleted = apply_updates(updates, memory_dir)
        print(f'[DREAM] Applied: {created} created, {updated} updated, {deleted} deleted')
        
        # Phase 4: Prune — check total size
        total_size = sum(
            os.path.getsize(os.path.join(memory_dir, f))
            for f in os.listdir(memory_dir)
            if f.endswith('.md')
        ) if os.path.exists(memory_dir) else 0
        
        if total_size > 25000:
            print(f'[DREAM] WARNING: Total memory size {total_size} bytes exceeds 25KB cap')
        else:
            print(f'[DREAM] Total memory size: {total_size} bytes (under 25KB cap)')
        
        # Deploy memory files to container
        for f in os.listdir(memory_dir):
            if f.endswith('.md'):
                src = os.path.join(memory_dir, f)
                # Copy to all workspaces
                os.system(f'docker cp "{src}" openclaw-openclaw-gateway-1:/home/node/.openclaw/workspace/{f} 2>/dev/null')
        
        # Rebuild lessons index
        os.system('cd /root/learning-loop && python3 build_index.py 2>/dev/null')
        
        # Record the dream run
        db.execute(
            "INSERT INTO dream_runs (created, updated, deleted) VALUES (?, ?, ?)",
            (created, updated, deleted)
        )
        db.commit()
        
        print(f'[DREAM] Dream complete at {datetime.now().isoformat()}')
    
    finally:
        # Release lock
        if os.path.exists(lock_file):
            os.remove(lock_file)
        db.close()


if __name__ == '__main__':
    import sys
    if '--dry-run' in sys.argv:
        print('[DREAM] Dry run — checking gates only')
        db = sqlite3.connect(DB_PATH)
        db.execute("""
            CREATE TABLE IF NOT EXISTS dream_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created INTEGER DEFAULT 0,
                updated INTEGER DEFAULT 0,
                deleted INTEGER DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        db.commit()
        check_dream_gates(db)
        
        memories = read_memory_files(os.environ.get('MEMORY_DIR', '/root/openclaw/data/memory'))
        transcripts = get_recent_transcripts(days_back=7, limit=100)
        new_lessons = get_new_lessons(db, since_days=7)
        recurring_topics = get_recurring_topics(db, since_days=7)
        
        print(f'\nSignal available:')
        print(f'  Memory files: {len(memories)}')
        print(f'  Recent transcripts: {len(transcripts)}')
        print(f'  New lessons (score >= 7): {len(new_lessons)}')
        print(f'  Recurring topics: {len(recurring_topics)}')
        db.close()
    else:
        dream()
```

**NOTE:** This is the intended structure of dream.py. Claude Code should create this file, adjusting API endpoints, paths, and auth as needed based on the actual server configurations. The key requirement is that the 4-phase structure and 3-gate trigger system are preserved.

#### 2. Create memory directory

```bash
mkdir -p /root/openclaw/data/memory
```

#### 3. Add dream to daily_burn.sh

Add AFTER the existing index rebuild step:

```bash
# Run dream consolidation (checks its own gates — 24h + 5 transcripts + lock)
echo "[$(date)] Running dream consolidation..."
cd /root/learning-loop && python3 dream.py >> /var/log/dream.log 2>&1
```

The dream checks its own three gates, so it's safe to call frequently — it will skip if conditions aren't met.

#### 4. Mount memory directory into container

If not already mounted, add to docker-compose.yml:
```yaml
- /root/openclaw/data/memory:/home/node/.openclaw/memory
```

Or use `docker cp` to deploy memory files after each dream (the script already does this).

## Constraints

- transcript_server.py: same stdlib pattern as lesson_server.py (http.server, sqlite3, json)
- dream.py: runs as cron job, NOT a persistent server — uses requests to call transcript server
- Dream uses GLM-4.7 (not 5.1) to save tokens — consolidation doesn't need top-tier quality
- JSONL files + SQLite dual storage for transcripts (JSONL for grep, SQLite for queries)
- Memory files stored on host at /root/openclaw/data/memory/ and deployed to container via docker cp
- Total memory capped at 25KB (following Claude Code's Dream system constraint)
- Three-gate trigger: 24h since last dream + 5 transcripts since last dream + file lock
- Single Python files, stdlib + requests only
- Use docker containers for root-owned file/DB operations if running as claude-user

## Verification

### Transcript Server
1. Server starts: `docker logs transcript-server`
2. Log a test entry:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s -X POST http://transcript-server:18794/webhook/transcript/log \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{"session_id":"test-1","agent_type":"main","role":"user","content":"test message","tokens_used":100}'
   ```
3. Search for it:
   ```bash
   docker exec openclaw-openclaw-gateway-1 curl -s -X POST http://transcript-server:18794/webhook/transcript/search \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: <secret>" \
     -d '{"query":"test message","limit":5}'
   ```
4. Check JSONL file was created:
   ```bash
   cat /root/openclaw/data/transcripts/$(date +%Y/%m/%Y-%m-%d).jsonl
   ```

### Dream Consolidation
1. Dry run: `python3 dream.py --dry-run`
2. First run (should create initial memories): `python3 dream.py`
3. Check memory files: `ls -la /root/openclaw/data/memory/`
4. Check dream log: `cat /var/log/dream.log`
5. Second immediate run (should be blocked by 24h gate): `python3 dream.py`
6. Check memory deployed to container:
   ```bash
   docker exec openclaw-openclaw-gateway-1 ls /home/node/.openclaw/workspace/*.md | grep -v SOUL | grep -v AGENTS | grep -v TOOLS | grep -v LESSONS
   ```

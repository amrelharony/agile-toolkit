# Task: Proactive Agent Mode (KAIROS-inspired)

## Overview

Claude Code has a hidden mode called KAIROS — an always-on assistant that doesn't wait for the user to type. It watches, logs, and proactively acts on things it notices. It receives periodic `<tick>` prompts and decides whether to act or stay quiet.

We're building a lightweight version for ElharonyClaw: a scheduled proactive agent that runs periodically, reviews recent activity, and sends Amr useful messages on Telegram WITHOUT being asked.

## What It Does

The proactive agent runs every 2 hours during Amr's active hours (8 AM - 11 PM Cairo = 06:00-21:00 UTC). On each tick, it:

1. Reviews recent transcripts (what conversations happened)
2. Checks session context (what tasks were completed)
3. Checks calendar/date context (upcoming events, deadlines)
4. Decides whether to proactively message Amr with:
   - Content suggestions ("You haven't posted on LinkedIn in 3 days — want a draft about X?")
   - Task reminders ("Career 180 Summit is in 2 days — want me to prep talking points?")
   - System health alerts ("Learning loop hasn't run in 48h — want me to check?")
   - Content ideas based on trending topics in MENA fintech
   - Follow-up suggestions ("You researched open banking yesterday but didn't publish — want me to draft a post from the scratchpad findings?")

## Architecture

```
Cron (every 2h, 8AM-11PM Cairo)
    ↓
proactive_tick.py
    ↓
1. Gather signal (transcripts, session context, dates, scratchpad)
    ↓
2. Call GLM-4.7 with tick prompt → decides: act or stay quiet
    ↓
3. If act: send message to Amr via Telegram bot API
    ↓
4. Log the tick result
```

No new Docker container needed — this is a cron-triggered Python script like dream.py.

## What to Build

### 1. Schema

Add to `learning_loop.db`:

```sql
CREATE TABLE IF NOT EXISTS proactive_ticks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_taken INTEGER DEFAULT 0,     -- 0=stayed quiet, 1=sent message
    action_type TEXT,                    -- 'linkedin_suggestion', 'reminder', 'health_alert', etc.
    message_sent TEXT,                   -- the actual message sent to Telegram
    reasoning TEXT,                      -- why the agent decided to act (or not)
    signal_summary TEXT,                 -- JSON summary of what signal was available
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ticks_date ON proactive_ticks(created_at DESC);
```

### 2. Create `/root/learning-loop/proactive_tick.py`

```python
#!/usr/bin/env python3
"""
Proactive Agent Tick for ElharonyClaw
Inspired by Claude Code's KAIROS system.
"""

import sqlite3
import json
import os
import sys
import requests
from datetime import datetime, timedelta

DB_PATH = os.environ.get('DB_PATH', '/root/.openclaw/learning_loop.db')
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')
GLM_API_KEY = os.environ.get('GLM_API_KEY', '')
GLM_BASE_URL = os.environ.get('GLM_BASE_URL', 'https://api.z.ai/api/coding/paas/v4')
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '7937878794')
TRANSCRIPT_URL = os.environ.get('TRANSCRIPT_URL', 'http://localhost:18794')
SESSION_CONTEXT_URL = os.environ.get('SESSION_CONTEXT_URL', 'http://localhost:18792')


def gather_signal(db):
    """Gather all available signal for the tick decision."""
    signal = {}
    
    # 1. Recent transcripts (last 24h)
    try:
        resp = requests.post(
            f'{TRANSCRIPT_URL}/webhook/transcript/recent',
            json={'days_back': 1, 'limit': 20},
            headers={'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET},
            timeout=10
        )
        if resp.status_code == 200:
            signal['recent_transcripts'] = resp.json().get('transcripts', [])
    except:
        signal['recent_transcripts'] = []
    
    # 2. Session context (last completed task)
    try:
        resp = requests.post(
            f'{SESSION_CONTEXT_URL}/webhook/session-context/get',
            json={'user_id': 'amr'},
            headers={'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET},
            timeout=10
        )
        if resp.status_code == 200:
            signal['last_session'] = resp.json()
    except:
        signal['last_session'] = {'has_context': False}
    
    # 3. Scratchpad files (unfinished work?)
    scratchpad_dir = '/root/openclaw/data/scratchpad'
    if os.path.exists(scratchpad_dir):
        files = os.listdir(scratchpad_dir)
        signal['scratchpad_files'] = files
    else:
        signal['scratchpad_files'] = []
    
    # 4. Last LinkedIn post time (from transcripts)
    cur = db.execute("""
        SELECT MAX(created_at) FROM transcripts
        WHERE agent_type = 'writer' AND content LIKE '%LinkedIn%'
    """)
    row = cur.fetchone()
    signal['last_linkedin'] = row[0] if row and row[0] else 'never'
    
    # 5. Last proactive tick
    cur = db.execute("SELECT created_at, action_taken, action_type FROM proactive_ticks ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    if row:
        signal['last_tick'] = {'time': row[0], 'acted': row[1], 'type': row[2]}
    else:
        signal['last_tick'] = None
    
    # 6. Dream memories (what has the bot learned about Amr?)
    memory_dir = os.environ.get('MEMORY_DIR', '/root/openclaw/data/memory')
    memories = {}
    if os.path.exists(memory_dir):
        for f in os.listdir(memory_dir):
            if f.endswith('.md'):
                with open(os.path.join(memory_dir, f)) as fh:
                    memories[f] = fh.read()[:500]
    signal['dream_memories'] = memories
    
    # 7. Current date context
    now = datetime.now()
    signal['current_time'] = now.strftime('%Y-%m-%d %H:%M Cairo time')
    signal['day_of_week'] = now.strftime('%A')
    
    # Known upcoming events (hardcoded for now, could be from a calendar API later)
    signal['upcoming_events'] = []
    
    # Career 180 Summit check
    summit_date = datetime(2026, 4, 4)
    days_until = (summit_date - now).days
    if -1 <= days_until <= 7:
        signal['upcoming_events'].append({
            'event': 'Career 180 Egypt Career Summit',
            'date': '2026-04-04',
            'days_until': days_until,
            'topic': 'From Branches to Bytes: The Rise of Digital Banking'
        })
    
    return signal


def build_tick_prompt(signal):
    """Build the prompt for the proactive decision."""
    
    transcript_summary = ""
    if signal.get('recent_transcripts'):
        for t in signal['recent_transcripts'][:10]:
            transcript_summary += f"- [{t.get('agent_type', '?')}] {t.get('role', '?')}: {t.get('content', '')[:100]}...\n"
    else:
        transcript_summary = "(no conversations in last 24h)"
    
    scratchpad = ", ".join(signal.get('scratchpad_files', [])) or "(empty)"
    
    last_session = signal.get('last_session', {})
    session_str = f"Last task: {last_session.get('topic', 'none')} ({last_session.get('agent_type', '?')}, {last_session.get('minutes_ago', '?')} min ago)" if last_session.get('has_context') else "No recent session"
    
    memories_str = "\n".join(f"- {name}: {content[:200]}..." for name, content in signal.get('dream_memories', {}).items()) or "(no dream memories yet)"
    
    events_str = "\n".join(
        f"- {e['event']} on {e['date']} ({e['days_until']} days away) — Topic: {e.get('topic', 'TBD')}"
        for e in signal.get('upcoming_events', [])
    ) or "(no upcoming events)"
    
    last_tick_str = f"Last tick: {signal['last_tick']['time']} (acted: {signal['last_tick']['acted']}, type: {signal['last_tick']['type']})" if signal.get('last_tick') else "First tick ever"
    
    return f"""# Proactive Agent Tick

You are ElharonyClaw's proactive module. Your job is to decide whether to send Amr a useful message on Telegram right now — or stay quiet.

## Context about Amr
- Delivery Lead, Data & Analytics at Banque Misr
- Author of "The Bilingual Executive"
- Founder of Fintech Bilinguals community
- Active LinkedIn thought leader in MENA fintech
- Speaks at conferences (upcoming events below)

## Current Signal

**Time:** {signal.get('current_time', 'unknown')} ({signal.get('day_of_week', 'unknown')})
**{last_tick_str}**

### Recent Conversations (24h):
{transcript_summary}

### Last Completed Task:
{session_str}

### Scratchpad Files (unfinished work):
{scratchpad}

### Last LinkedIn Activity:
{signal.get('last_linkedin', 'unknown')}

### Upcoming Events:
{events_str}

### Dream Memories:
{memories_str}

## Decision Rules

1. **DO send a message if:**
   - Amr hasn't posted on LinkedIn in 3+ days and you have a good topic idea
   - An upcoming event is within 3 days and prep work hasn't started
   - There's unfinished work in the scratchpad that could be completed
   - You notice a pattern worth surfacing (e.g., "you've been researching X a lot — want a summary?")
   - System health issues detected

2. **DO NOT send a message if:**
   - You sent a proactive message in the last 4 hours
   - It's outside 8 AM - 11 PM Cairo time
   - You have nothing genuinely useful to say
   - The user is clearly in the middle of active work (recent transcripts in last 30 min)

3. **Tone rules:**
   - Brief and direct (2-4 sentences max)
   - Frame as an offer, not a command: "Want me to...?" not "You should..."
   - Include the specific action you'd take: "Want me to draft a LinkedIn post about X?" not "You should post on LinkedIn"
   - Never be annoying — if in doubt, stay quiet

## Respond with ONLY a JSON object:

If you decide to ACT:
```json
{{"action": true, "type": "linkedin_suggestion", "message": "Your message to Amr here (2-4 sentences)", "reasoning": "Why you decided to act"}}
```

If you decide to STAY QUIET:
```json
{{"action": false, "reasoning": "Why you decided not to act"}}
```

Valid action types: linkedin_suggestion, event_prep, scratchpad_followup, system_health, content_idea, reminder

Respond with ONLY the JSON. No explanation, no markdown fences.
"""


def send_telegram_message(message):
    """Send a message to Amr via Telegram bot API."""
    url = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage'
    resp = requests.post(url, json={
        'chat_id': TELEGRAM_CHAT_ID,
        'text': f"💡 *Proactive suggestion:*\n\n{message}",
        'parse_mode': 'Markdown'
    }, timeout=10)
    return resp.status_code == 200


def call_glm(prompt):
    """Call GLM-4.7 for the tick decision."""
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
            'max_tokens': 500
        },
        timeout=60
    )
    resp.raise_for_status()
    return resp.json()['choices'][0]['message']['content']


def tick():
    """Main proactive tick function."""
    now = datetime.now()
    hour = now.hour
    
    # Time gate: only 8 AM - 11 PM Cairo
    if hour < 8 or hour > 23:
        print(f'[PROACTIVE] Outside active hours ({hour}:00 Cairo). Skipping.')
        return
    
    print(f'[PROACTIVE] Tick at {now.isoformat()}')
    
    db = sqlite3.connect(DB_PATH)
    
    # Create table if needed
    db.execute("""
        CREATE TABLE IF NOT EXISTS proactive_ticks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_taken INTEGER DEFAULT 0,
            action_type TEXT,
            message_sent TEXT,
            reasoning TEXT,
            signal_summary TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    db.commit()
    
    # Cooldown gate: no message if one was sent in last 4 hours
    cur = db.execute("""
        SELECT created_at FROM proactive_ticks
        WHERE action_taken = 1
        ORDER BY created_at DESC LIMIT 1
    """)
    last_action = cur.fetchone()
    if last_action:
        last_dt = datetime.fromisoformat(last_action[0])
        hours_since = (now - last_dt).total_seconds() / 3600
        if hours_since < 4:
            print(f'[PROACTIVE] Cooldown: last action {hours_since:.1f}h ago (need 4h). Skipping.')
            db.close()
            return
    
    # Gather signal
    signal = gather_signal(db)
    print(f'[PROACTIVE] Signal: {len(signal.get("recent_transcripts", []))} transcripts, '
          f'{len(signal.get("scratchpad_files", []))} scratchpad files, '
          f'{len(signal.get("upcoming_events", []))} events')
    
    # Build prompt and call GLM
    prompt = build_tick_prompt(signal)
    print(f'[PROACTIVE] Calling GLM-4.7 for decision ({len(prompt)} chars)...')
    
    try:
        response = call_glm(prompt)
        response = response.strip()
        if response.startswith('```'):
            response = response.split('\n', 1)[1].rsplit('```', 1)[0]
        
        decision = json.loads(response)
    except Exception as e:
        print(f'[PROACTIVE] Failed to parse decision: {e}')
        print(f'[PROACTIVE] Response: {response[:500] if "response" in dir() else "N/A"}')
        db.close()
        return
    
    # Act on decision
    if decision.get('action'):
        message = decision.get('message', '')
        action_type = decision.get('type', 'unknown')
        reasoning = decision.get('reasoning', '')
        
        print(f'[PROACTIVE] Acting: {action_type}')
        print(f'[PROACTIVE] Message: {message}')
        
        # Send via Telegram
        if TELEGRAM_BOT_TOKEN:
            sent = send_telegram_message(message)
            print(f'[PROACTIVE] Telegram send: {"OK" if sent else "FAILED"}')
        else:
            print('[PROACTIVE] No Telegram token — skipping send')
            sent = False
        
        db.execute("""
            INSERT INTO proactive_ticks (action_taken, action_type, message_sent, reasoning, signal_summary)
            VALUES (1, ?, ?, ?, ?)
        """, (action_type, message, reasoning, json.dumps({
            'transcripts': len(signal.get('recent_transcripts', [])),
            'scratchpad_files': signal.get('scratchpad_files', []),
            'last_linkedin': signal.get('last_linkedin'),
            'events': len(signal.get('upcoming_events', []))
        })))
    else:
        reasoning = decision.get('reasoning', '')
        print(f'[PROACTIVE] Staying quiet: {reasoning}')
        
        db.execute("""
            INSERT INTO proactive_ticks (action_taken, action_type, reasoning, signal_summary)
            VALUES (0, NULL, ?, ?)
        """, (reasoning, json.dumps({
            'transcripts': len(signal.get('recent_transcripts', [])),
            'events': len(signal.get('upcoming_events', []))
        })))
    
    db.commit()
    db.close()
    print(f'[PROACTIVE] Tick complete.')


if __name__ == '__main__':
    if '--dry-run' in sys.argv:
        print('[PROACTIVE] Dry run — gathering signal only')
        db = sqlite3.connect(DB_PATH)
        signal = gather_signal(db)
        print(json.dumps(signal, indent=2, default=str))
        db.close()
    else:
        tick()
```

**NOTE:** This is the intended structure. Claude Code should create this file, adjusting URLs and env vars based on actual server configs. The key requirements:
- Time gate (8AM-11PM Cairo)
- Cooldown gate (4h between proactive messages)
- GLM-4.7 makes the act/quiet decision
- Telegram Bot API for sending messages
- All ticks logged for review

### 3. Get the Telegram bot token

The bot token is needed for proactive messages. Find it:
```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json | python3 -c "import json,sys; c=json.load(sys.stdin); print(json.dumps(c.get('channels',{}), indent=2))"
```

Or check the .env:
```bash
grep -i telegram /root/openclaw/.env /root/openclaw/openclaw/.env 2>/dev/null
```

### 4. Add to cron

```bash
# Every 2 hours during active hours (8AM-11PM Cairo = 06-21 UTC)
# Using docker to run (root-owned DB)
0 6,8,10,12,14,16,18,20 * * * docker run --rm \
  --network openclaw_default \
  -v /root/learning-loop:/app:ro \
  -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
  -v /root/openclaw/data:/openclaw-data:ro \
  -e DB_PATH=/data/learning_loop.db \
  -e MEMORY_DIR=/openclaw-data/memory \
  -e WEBHOOK_SECRET='<SECRET>' \
  -e GLM_API_KEY='<KEY>' \
  -e GLM_BASE_URL='https://api.z.ai/api/coding/paas/v4' \
  -e TELEGRAM_BOT_TOKEN='<TOKEN>' \
  -e TELEGRAM_CHAT_ID='7937878794' \
  -e TRANSCRIPT_URL='http://transcript-server:18794' \
  -e SESSION_CONTEXT_URL='http://session-context:18792' \
  python:3.12-slim \
  sh -c "pip install -q requests && python3 /app/proactive_tick.py" >> /var/log/proactive.log 2>&1
```

Replace `<SECRET>`, `<KEY>`, and `<TOKEN>` with actual values from the existing configs.

### 5. Add a feature flag for proactive mode

```bash
# Insert the flag
docker run --rm -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
  python:3.12-slim python3 -c "
import sqlite3
db = sqlite3.connect('/data/learning_loop.db')
db.execute(\"\"\"INSERT OR IGNORE INTO feature_flags (flag_name, description, enabled, agent_scope, value)
VALUES ('proactive_enabled', 'Enable proactive agent ticks (KAIROS mode)', 1, '*', '')\"\"\")
db.commit()
print('Flag added')
"
```

Then in `proactive_tick.py`, check the flag before running:
```python
# At the start of tick():
cur = db.execute("SELECT enabled FROM feature_flags WHERE flag_name = 'proactive_enabled'")
row = cur.fetchone()
if not row or not row[0]:
    print('[PROACTIVE] Disabled via feature flag. Skipping.')
    db.close()
    return
```

This lets Amr toggle proactive mode from Telegram: `/flag set proactive_enabled off`

### 6. Add Telegram admin commands for proactive history

Add to main agent's SOUL.md:

```markdown
## Proactive Agent

ElharonyClaw has a proactive mode that sends you suggestions every 2 hours.

Commands:
- "/proactive history" → Show last 5 proactive ticks from the database
- "/proactive trigger" → Force a proactive tick right now (bypasses cooldown for testing)
- "/flag set proactive_enabled off" → Disable proactive mode
- "/flag set proactive_enabled on" → Enable proactive mode

To check history:
```bash
curl -s http://feature-flags:18793/... (or query the DB directly)
```
```

## Constraints

- No new persistent containers — proactive_tick.py runs via cron in a disposable docker container
- Uses GLM-4.7 (cheap) for the act/quiet decision
- 4-hour cooldown between proactive messages (no spam)
- Feature flag controlled (can be toggled from Telegram)
- Time-gated to active hours only (8AM-11PM Cairo)
- Token budget: ~500 tokens per tick × 8 ticks/day = ~4K tokens/day (negligible)
- Telegram bot token must be found from existing config, not hardcoded

## Verification

1. Dry run:
   ```bash
   docker run --rm \
     --network openclaw_default \
     -v /root/learning-loop:/app:ro \
     -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
     -v /root/openclaw/data:/openclaw-data:ro \
     -e DB_PATH=/data/learning_loop.db \
     -e MEMORY_DIR=/openclaw-data/memory \
     -e WEBHOOK_SECRET='<SECRET>' \
     python:3.12-slim \
     sh -c "pip install -q requests && python3 /app/proactive_tick.py --dry-run"
   ```
   Should print gathered signal as JSON.

2. Full tick:
   Run the same command without --dry-run. It should either:
   - Send a Telegram message (if conditions warrant)
   - Stay quiet with reasoning logged

3. Check Telegram — did you get a proactive message?

4. Check the tick log:
   ```bash
   docker run --rm -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:ro \
     python:3.12-slim python3 -c "
   import sqlite3
   db = sqlite3.connect('/data/learning_loop.db')
   for row in db.execute('SELECT * FROM proactive_ticks ORDER BY created_at DESC LIMIT 5'):
       print(row)
   "
   ```

5. Toggle via Telegram: `/flag set proactive_enabled off` then run tick — should skip.

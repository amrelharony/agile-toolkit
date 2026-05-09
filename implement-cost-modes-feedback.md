# Task: Cost Tracker (#12) + Output Modes (#18) + Feedback Loop (#23)

Three small improvements, no new containers. All implemented via SQLite tables + SOUL.md updates + one lightweight server endpoint.

---

## Part A: Cost Tracker (#12)

### Problem
Amr has a $608/yr budget with strict Z.AI rate limits. There's no visibility into how much each agent, learning loop run, or proactive tick costs. He can't answer "how much did the writer agent cost this week?" or "is the learning loop burning too many tokens?"

### What to Build

#### 1. Schema

Add to `learning_loop.db`:

```sql
CREATE TABLE IF NOT EXISTS cost_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,                -- 'agent:writer', 'agent:main', 'learning_loop', 'dream', 'proactive', 'skillify'
    model TEXT NOT NULL,                 -- 'glm-5.1', 'glm-4.7', 'gemini-2.5-flash-lite'
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,   -- calculated from token counts + model pricing
    session_id TEXT,                      -- links to a specific task/session
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_source ON cost_tracking(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_date ON cost_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_cost_model ON cost_tracking(model);
```

#### 2. Add cost tracking endpoint to an EXISTING server

Don't create a new container. Add endpoints to the `feature_flags_server.py` (it's the lightest loaded):

##### POST /webhook/cost/log
```json
{
    "source": "agent:writer",
    "model": "glm-5.1",
    "input_tokens": 1500,
    "output_tokens": 800,
    "total_tokens": 2300,
    "session_id": "abc-123"
}
```

Response: `{"logged": true, "id": 42, "estimated_cost_usd": 0.0023}`

Cost estimation formula (based on Z.AI Coding Plan pricing):
- GLM-5.1: 3× multiplier during peak (08-12 Cairo), 1× off-peak promo
- GLM-4.7: no multiplier
- Gemini: free
- Base rate: ~$0.001 per 1K tokens (adjust based on actual Z.AI pricing)

##### POST /webhook/cost/summary
```json
{
    "period": "today"  // or "week", "month", "all"
}
```

Response:
```json
{
    "period": "today",
    "total_cost_usd": 0.45,
    "total_tokens": 125000,
    "by_source": {
        "agent:writer": {"tokens": 45000, "cost": 0.18, "calls": 12},
        "agent:researcher": {"tokens": 30000, "cost": 0.12, "calls": 5},
        "learning_loop": {"tokens": 40000, "cost": 0.10, "calls": 50},
        "proactive": {"tokens": 5000, "cost": 0.02, "calls": 4},
        "dream": {"tokens": 5000, "cost": 0.03, "calls": 1}
    },
    "by_model": {
        "glm-5.1": {"tokens": 75000, "cost": 0.35},
        "glm-4.7": {"tokens": 45000, "cost": 0.08},
        "gemini-2.5-flash-lite": {"tokens": 5000, "cost": 0.00}
    }
}
```

#### 3. Add cost logging to existing scripts

Each script that calls an LLM should log cost after each call. Add to:

- `learning_loop.py` — after each GLM call in execute/critique/distill stages
- `dream.py` — after the consolidation GLM call
- `proactive_tick.py` — after the tick decision GLM/Gemini call
- `skillify.py` — after each skill generation/evolution call

Pattern for each script:
```python
# After any GLM/Gemini call:
try:
    requests.post(
        'http://feature-flags:18793/webhook/cost/log',
        json={
            'source': 'learning_loop',
            'model': 'glm-5.1',
            'input_tokens': usage.get('prompt_tokens', 0),
            'output_tokens': usage.get('completion_tokens', 0),
            'total_tokens': usage.get('total_tokens', 0),
        },
        headers={'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET},
        timeout=5
    )
except:
    pass  # Never fail on cost logging
```

#### 4. Add Telegram admin commands

Add to main agent's SOUL.md:
```markdown
## Cost Tracking

- "/cost today" → Show today's token spend and cost breakdown by source
- "/cost week" → Show this week's breakdown
- "/cost month" → Monthly breakdown

Call POST http://feature-flags:18793/webhook/cost/summary with {"period": "<period>"} and format the response as a clean summary.
```

### Implementation

Read `feature_flags_server.py` first to understand its structure, then add the two new endpoints (`/webhook/cost/log` and `/webhook/cost/summary`) to the same file. Restart the feature-flags container after.

---

## Part B: Output Style Modes (#18)

### Problem
The bot always responds in one style. Quick questions ("what time is it in UTC?") get the same verbose treatment as complex research requests. Claude Code has Brief mode for KAIROS — extremely concise responses for a persistent assistant.

### What to Build

This is a pure SOUL.md change — no servers, no tables.

#### 1. Add output modes to main agent's SOUL.md

```markdown
## Output Modes

You support three output modes. Switch via Telegram command or infer from context.

### Commands:
- "/brief" → Switch to Brief mode until changed
- "/verbose" → Switch to Verbose mode until changed
- "/default" → Switch back to Default mode

### Mode Behaviors:

**Brief mode** (when user says /brief, or for quick questions):
- Maximum 2-3 sentences
- No reasoning shown
- No preamble ("Here's...", "Sure...", "Great question...")
- Just the answer, nothing else
- Good for: quick checks, yes/no questions, status queries, follow-ups

**Default mode** (standard):
- Current behavior
- Professional but accessible
- Include reasoning when relevant
- 1-3 paragraphs typical

**Verbose mode** (when user says /verbose, or for complex analysis):
- Show full reasoning chain
- Include alternative perspectives
- Cite sources explicitly
- Break into sections with headers
- Good for: research, deep analysis, decision support

### Auto-detection:
If no mode is explicitly set, infer from the message:
- Single word or short question → Brief
- "Quick question", "just wondering", "what's the..." → Brief
- Complex multi-part request → Default
- "Explain", "analyze", "deep dive", "compare" → Verbose
```

#### 2. Add output mode to feature flags

Add a flag so the active mode persists across sessions:

```sql
INSERT OR IGNORE INTO feature_flags (flag_name, description, enabled, agent_scope, value)
VALUES ('output_mode', 'Current output mode: brief, default, or verbose', 1, '*', 'default');
```

When the user says `/brief`, the agent calls:
```
POST /webhook/feature-flags/set {"flag_name": "output_mode", "enabled": true, "value": "brief"}
```

At bootstrap, the feature flags hook injects the current mode. The agent reads it from FEATURE_FLAGS.md and adjusts behavior.

---

## Part C: Self-Improvement Feedback Loop (#23)

### Problem
The learning loop generates ~8000 lessons, but there's no human signal on which lessons are actually good. The `times_helpful` column exists in `agent_lessons` but nothing writes to it. This means the composite score in the lessons index (30% weight on helpfulness) is always 0.

### What to Build

#### 1. Add `/rate` command to SOUL.md

```markdown
## Rating Outputs

After ANY output (LinkedIn post, research, presentation, etc.), if the user says:
- "/rate 5" or "rate 5" → Rate the last output 5/5
- "/rate 3" → Rate it 3/5
- "/rate 1" → Poor quality

When you receive a rating:
1. Log it to the transcript server (already configured)
2. Update the lessons that were applied to this output:
   - Call the lesson feedback endpoint to increment `times_helpful` for lessons used when rating >= 4
   - Call it to decrement for rating <= 2

Do NOT ask the user to rate. Only process ratings when offered voluntarily.
Acknowledge briefly: "Rated 4/5. Feedback logged." — nothing more.
```

#### 2. Add feedback endpoint to lesson server

Add to `lesson_server.py`:

##### POST /webhook/lessons/feedback

```json
{
    "task_type": "linkedin_post",
    "rating": 5,
    "lesson_ids": [47, 52, 89]
}
```

Logic:
- If rating >= 4: increment `times_helpful` for each lesson_id
- If rating <= 2: decrement `times_helpful` (min 0)
- If rating == 3: no change (neutral)
- Also log the rating in a new table:

```sql
CREATE TABLE IF NOT EXISTS output_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL,
    rating INTEGER NOT NULL,
    lesson_ids TEXT,              -- JSON array
    agent_type TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ratings_task ON output_ratings(task_type, created_at DESC);
```

Response:
```json
{"rated": true, "lessons_updated": 3}
```

#### 3. Track which lessons were applied

The learning-recall hook already returns lesson IDs. The agent needs to remember which lessons it received so it can report them back when rated.

Add to the session context save (already implemented): include a `lesson_ids` field in the session context POST:

```json
{
    "user_id": "amr",
    "agent_type": "writer",
    "topic": "LinkedIn post about data literacy",
    "output_summary": "...",
    "lesson_ids": [47, 52, 89]
}
```

When the user rates, the agent retrieves `lesson_ids` from session context and passes them to the feedback endpoint.

#### 4. Impact on lessons index

Since `build_index.py` already uses `times_helpful` with 30% weight in the composite score, rated lessons will naturally rise or fall in the index. High-rated lessons bubble up; low-rated ones decay out. The dream system will also notice patterns in ratings.

### Verification for All Three Parts

```bash
# Part A: Cost tracking
curl -s -X POST http://127.0.0.1:18793/webhook/cost/log \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <secret>" \
  -d '{"source":"test","model":"glm-5.1","input_tokens":1000,"output_tokens":500,"total_tokens":1500}'

curl -s -X POST http://127.0.0.1:18793/webhook/cost/summary \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <secret>" \
  -d '{"period":"today"}'

# Part B: Output modes
# Via Telegram: send "/brief" then "what's the weather?" — expect 1-sentence response
# Then "/verbose" then "explain open banking" — expect detailed breakdown

# Part C: Feedback
curl -s -X POST http://127.0.0.1:18791/webhook/lessons/feedback \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <secret>" \
  -d '{"task_type":"linkedin_post","rating":5,"lesson_ids":[1,2,3]}'

# Check lessons updated
sqlite3 /root/.openclaw/learning_loop.db "SELECT id, times_helpful FROM agent_lessons WHERE id IN (1,2,3)"
```

## Constraints
- NO new containers — add endpoints to existing servers (feature_flags_server.py, lesson_server.py)
- Restart affected containers after code changes
- SOUL.md must stay under 20,000 characters
- Cost logging must be fire-and-forget (never fail the main task if logging fails)
- Use docker containers for root-owned file/DB writes

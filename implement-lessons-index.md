# Task: Add Lessons Index with Size Cap to Learning Loop

## Context

The Learning Loop at `/root/learning-loop/` accumulates lessons in `/root/.openclaw/learning_loop.db` (SQLite with sqlite-vec + FTS5). Currently, when an agent starts a session, the `agent:bootstrap` hook calls the lesson server at `http://lesson-server:18791/webhook/get-lessons`, which does a vector search and returns relevant lessons as `LEARNING_RECALL.md`.

The problem: as lessons accumulate (thousands by now), the vector search returns different results each time and there's no curated "best of" index. Agents have no quick orientation — they get ad-hoc search results instead of the distilled top lessons.

Inspired by Claude Code's "Dream" consolidation system, we want to add a **pre-computed lessons index** that:
1. Contains the top lessons ranked by quality score
2. Is capped at 50 entries max
3. Uses one-liner format (under 150 chars per entry)
4. Auto-prunes lowest-scored entries when it overflows
5. Gets regenerated periodically (after each daily_burn cycle)
6. Gets injected into agent context alongside the vector search results

## Existing Infrastructure (DO NOT MODIFY existing files unless specified)

### Database
- Path: `/root/.openclaw/learning_loop.db`
- Key table: `agent_lessons` with columns:
  - `id INTEGER PRIMARY KEY`
  - `task_type TEXT` — e.g. 'linkedin_post', 'email_draft', 'sprint_artifact', etc.
  - `lesson TEXT` — the full lesson text
  - `context TEXT` — what triggered this lesson
  - `score REAL` — critique score (1-10)
  - `times_used INTEGER` — retrieval counter
  - `times_helpful INTEGER` — user-confirmed usefulness
  - `created_at TIMESTAMP`
  - `updated_at TIMESTAMP`

### Task type to agent mapping
- `main` → `email_draft`
- `writer` → `linkedin_post`
- `researcher` → `research_summary`
- `presenter` → `presentation_outline`
- `documenter` → `technical_doc`
- `scrum-master` → `sprint_artifact`
- `ops` → `kpi_narrative`
- `scraper` → `morning_briefing`
- `designer` → `design_brief`
- `multimedia` → `content_script`

### Key paths
- Learning loop scripts: `/root/learning-loop/`
- Daily burn script: `/root/learning-loop/daily_burn.sh`
- Lesson server: `/root/learning-loop/lesson_server.py`
- OpenClaw container: `openclaw-openclaw-gateway-1`
- Bot workspace inside container: `/home/node/.openclaw/workspace/`
- Bootstrap hook for learning-recall: `/home/node/.openclaw/workspace/skills/learning-recall/`
- Env file: `/root/learning-loop/.env`

### How the bootstrap hook works
The `agent:bootstrap` hook fires when any agent starts a session. It:
1. Calls `http://lesson-server:18791/webhook/get-lessons` with task_type and query
2. Gets back scored lessons
3. Writes them to a `LEARNING_RECALL.md` file in the agent's workspace
4. The agent sees this file at session start

## What to Build

### 1. New script: `/root/learning-loop/build_index.py`

A Python script that:

1. Connects to `/root/.openclaw/learning_loop.db`
2. Queries the top lessons using a composite ranking formula:
   ```sql
   SELECT id, task_type, lesson, score, times_used, times_helpful, created_at
   FROM agent_lessons
   WHERE score >= 6.0
   ORDER BY (score * 0.6 + COALESCE(times_helpful, 0) * 0.3 + COALESCE(times_used, 0) * 0.1) DESC
   LIMIT 50
   ```
   - 60% weight on critique score
   - 30% weight on user-confirmed helpfulness
   - 10% weight on retrieval frequency
   - Minimum score threshold of 6.0

3. Generates a `LESSONS_INDEX.md` file with this format:
   ```markdown
   # Top Lessons Index
   _Auto-generated. 47 lessons across 8 task types. Last updated: 2026-04-01T22:00:00Z_

   ## linkedin_post (12 lessons)
   - [#47] Open with tension or counterintuitive observation, not a summary
   - [#52] Frame insights as practitioner experience, not textbook advice
   - [#89] Keep under 200 words — engagement drops sharply after that
   ...

   ## email_draft (8 lessons)
   - [#23] Lead with the ask, context after — busy executives scan first line
   - [#31] Use collegial framing: suggest, don't direct
   ...

   ## sprint_artifact (6 lessons)
   - [#105] Quantify business impact, not just task completion
   ...
   ```

   Rules for each entry:
   - Format: `- [#ID] Lesson text truncated to 140 chars max`
   - If lesson text > 140 chars, truncate at last word boundary and add `…`
   - Group by task_type
   - Within each group, sort by composite score descending
   - Max 50 entries total across all groups
   - Each task_type gets proportional representation (not all 50 from one type)

4. Writes the index to TWO locations:
   - Host: `/root/openclaw/data/LESSONS_INDEX.md` (persistent)
   - Container: `docker cp` to `/home/node/.openclaw/workspace/LESSONS_INDEX.md`

5. Logs to stdout with `[INDEX]` prefix:
   ```
   [INDEX] Built index: 47 lessons across 8 task types (was 45 last run)
   [INDEX] Pruned 3 entries below score threshold
   [INDEX] Deployed to container
   ```

### 2. Proportional allocation algorithm

To prevent one task type from dominating the index:

```python
MAX_ENTRIES = 50
MIN_PER_TYPE = 2  # Every task type gets at least 2 slots if it has 2+ lessons

# Step 1: Give each task_type MIN_PER_TYPE slots
# Step 2: Distribute remaining slots proportionally by lesson count
# Step 3: Fill slots with top-scoring lessons per type
# Step 4: If total < 50, fill remaining from global top scores regardless of type
```

### 3. Integration with daily_burn.sh

Add to the END of `daily_burn.sh` (after all learning cycles and skillify runs):

```bash
# Rebuild lessons index after every burn cycle
echo "[$(date)] Rebuilding lessons index..."
cd /root/learning-loop && python3 build_index.py >> /var/log/learning-loop.log 2>&1
```

### 4. Update the bootstrap hook

Currently the `agent:bootstrap` hook injects `LEARNING_RECALL.md` (dynamic vector search results). We want it to ALSO inject `LESSONS_INDEX.md` (pre-computed top lessons).

Check how the current hook works:
```bash
# Find the hook script
docker exec openclaw-openclaw-gateway-1 find /home/node/.openclaw -name "*.js" -o -name "*.sh" | grep -i "bootstrap\|hook\|recall" | head -20

# Check hooks configuration
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json | python3 -c "import json,sys; c=json.load(sys.stdin); print(json.dumps(c.get('hooks',{}), indent=2))"

# Read the learning-recall skill
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/skills/learning-recall/SKILL.md
```

The hook should be updated so that:
- `LEARNING_RECALL.md` = dynamic results from vector search (already working)
- `LESSONS_INDEX.md` = pre-computed top lessons (new, static file that just gets read)

The simplest approach: since `LESSONS_INDEX.md` is already placed in the workspace via `docker cp`, agents can read it directly. Add a note to the learning-recall SKILL.md that says:
```
## Quick Reference
Before doing a full lesson search, check workspace/LESSONS_INDEX.md for a pre-computed
index of the top 50 highest-scoring lessons across all task types. This is faster than
a full search and covers the most important accumulated wisdom.
```

### 5. Score decay integration (optional but recommended)

If score decay hasn't been deployed yet, add it to `build_index.py` as a pre-step:

```python
def apply_decay():
    """Reduce score of unused lessons by 5% weekly (0.95 multiplier).
    Only affects lessons not used in the past 7 days."""
    db.execute("""
        UPDATE agent_lessons
        SET score = score * 0.95,
            updated_at = datetime('now')
        WHERE updated_at < datetime('now', '-7 days')
        AND times_used = (SELECT times_used FROM agent_lessons AS a2 WHERE a2.id = agent_lessons.id)
    """)
```

Run this BEFORE building the index so decayed lessons naturally fall off.

## Constraints

- No new Python dependencies — use only stdlib (sqlite3, json, os, subprocess, datetime)
- Single file: `build_index.py`
- Must handle empty DB gracefully (first run before any lessons exist)
- `LESSONS_INDEX.md` must stay under 25KB (following the Dream system's constraint)
- Use `docker cp` to deploy into container (not heredocs — they corrupt long lines)
- Read DB path from env or use default `/root/.openclaw/learning_loop.db`

## Verification

After implementing, run these checks:

1. `python3 build_index.py` — should generate the index and print log lines
2. `cat /root/openclaw/data/LESSONS_INDEX.md | head -30` — should show formatted index
3. `cat /root/openclaw/data/LESSONS_INDEX.md | wc -c` — must be under 25000
4. `cat /root/openclaw/data/LESSONS_INDEX.md | wc -l` — should be under 100 lines
5. `docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/LESSONS_INDEX.md | head -10` — should match host copy
6. Query the DB to confirm score decay applied:
   ```bash
   sqlite3 /root/.openclaw/learning_loop.db "SELECT COUNT(*) FROM agent_lessons WHERE score < 6.0"
   ```
7. Run it twice — second run should show same or slightly different count (not duplicating)

## Testing the full flow

After deployment:
1. Run `bash /root/learning-loop/daily_burn.sh` to trigger a full cycle
2. Verify `LESSONS_INDEX.md` was regenerated at the end
3. Send a message to the bot on Telegram
4. Check if the agent's reasoning mentions lessons from the index

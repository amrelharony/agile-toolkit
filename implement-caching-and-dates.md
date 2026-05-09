# Task: Tool Schema Caching (#8) + Date Conversion in Skillify (#10)

## Part A: Tool Schema Caching (#8)

### Problem
Every time an agent starts a session, the `agent:bootstrap` hook calls the lesson server, feature flags server, and session context server — and all SKILL.md files get re-read. If the skills haven't changed since last boot, this wastes tokens injecting identical content.

### Solution
Add a hash-based check to the learning-recall bootstrap hook. Before injecting lessons, compute a hash of the current lessons/skills. If the hash matches the last injection, skip re-injection and inject a minimal "no changes" note instead.

### What to Build

#### 1. Add a cache table to learning_loop.db

```sql
CREATE TABLE IF NOT EXISTS bootstrap_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT NOT NULL UNIQUE,    -- e.g. 'lessons_index_hash', 'skills_hash'
    cache_value TEXT NOT NULL,          -- the hash value
    updated_at TEXT DEFAULT (datetime('now'))
);
```

Run via docker container (DB is root-owned):
```bash
docker run --rm -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
  python:3.12-slim python3 -c "
import sqlite3
db = sqlite3.connect('/data/learning_loop.db')
db.execute('''CREATE TABLE IF NOT EXISTS bootstrap_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT NOT NULL UNIQUE,
    cache_value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime(\"now\"))
)''')
db.commit()
print('bootstrap_cache table created')
"
```

#### 2. Update build_index.py to write a hash

After `build_index.py` generates `LESSONS_INDEX.md`, compute its MD5 hash and store it in `bootstrap_cache`:

Add to the end of `build_index.py`:
```python
import hashlib

# After writing LESSONS_INDEX.md
with open(output_path, 'r') as f:
    content_hash = hashlib.md5(f.read().encode()).hexdigest()

db.execute("""
    INSERT OR REPLACE INTO bootstrap_cache (cache_key, cache_value, updated_at)
    VALUES ('lessons_index_hash', ?, datetime('now'))
""", (content_hash,))
db.commit()
print(f'[INDEX] Hash: {content_hash}')
```

#### 3. Update the lesson-server to include the hash in responses

Add to the `/webhook/get-lessons` endpoint response:
```json
{
    "lessons": [...],
    "index_hash": "abc123..."
}
```

The hash comes from:
```python
cur = db.execute("SELECT cache_value FROM bootstrap_cache WHERE cache_key = 'lessons_index_hash'")
row = cur.fetchone()
index_hash = row[0] if row else None
```

#### 4. Update the learning-recall hook handler.js

Modify the handler to:
1. Check a locally stored hash (in a file at `/home/node/.openclaw/.lesson_hash`)
2. Compare with the hash returned by the lesson server
3. If hashes match, inject a minimal note: "Lessons unchanged since last session — cached."
4. If hashes differ (or no local hash exists), inject full lessons and update the local hash file

```javascript
// In handler.js, after getting lesson server response:
const fs = require('fs');
const hashFile = '/home/node/.openclaw/.lesson_hash';
const serverHash = response.index_hash;

let localHash = null;
try { localHash = fs.readFileSync(hashFile, 'utf8').trim(); } catch(e) {}

if (serverHash && localHash === serverHash) {
    // Lessons haven't changed — inject minimal note
    return { content: '# Lessons\n_Unchanged since last session. Cached._', virtual: true };
}

// Full injection — lessons changed
try { fs.writeFileSync(hashFile, serverHash); } catch(e) {}
// ... proceed with full lesson injection
```

### Verification
```bash
# Check the hash was written after index build
docker run --rm -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:ro \
  python:3.12-slim python3 -c "
import sqlite3
db = sqlite3.connect('/data/learning_loop.db')
cur = db.execute('SELECT * FROM bootstrap_cache')
for row in cur: print(row)
"

# Rebuild index to generate hash
docker run --rm \
  -v /root/learning-loop:/app:ro \
  -v /root/.openclaw/learning_loop.db:/data/learning_loop.db:rw \
  -v /root/openclaw/data:/output \
  python:3.12-slim python3 /app/build_index.py
```

---

## Part B: Date Conversion in Skillify (#10)

### Problem
Skillify-generated SKILL.md files and lessons may contain relative date references ("yesterday", "last week", "recently") from when they were created. As these files age, the references become ambiguous — "yesterday" in a skill generated 3 months ago is meaningless.

### Solution
Add a post-processing step to `skillify.py` that converts relative date references to absolute ISO dates at generation time.

### What to Build

#### 1. Create a date conversion function

Add to `/root/learning-loop/skillify.py`:

```python
import re
from datetime import datetime, timedelta

def convert_relative_dates(text):
    """Convert relative date references to absolute dates."""
    today = datetime.now()
    
    replacements = {
        r'\byesterday\b': (today - timedelta(days=1)).strftime('%Y-%m-%d'),
        r'\btoday\b': today.strftime('%Y-%m-%d'),
        r'\btomorrow\b': (today + timedelta(days=1)).strftime('%Y-%m-%d'),
        r'\blast week\b': f"week of {(today - timedelta(weeks=1)).strftime('%Y-%m-%d')}",
        r'\bthis week\b': f"week of {today.strftime('%Y-%m-%d')}",
        r'\bnext week\b': f"week of {(today + timedelta(weeks=1)).strftime('%Y-%m-%d')}",
        r'\blast month\b': f"{(today.replace(day=1) - timedelta(days=1)).strftime('%Y-%m')}",
        r'\bthis month\b': today.strftime('%Y-%m'),
        r'\bnext month\b': f"{(today.replace(day=28) + timedelta(days=4)).strftime('%Y-%m')}",
        r'\brecently\b': f"around {today.strftime('%Y-%m-%d')}",
        r'\ba few days ago\b': f"around {(today - timedelta(days=3)).strftime('%Y-%m-%d')}",
    }
    
    for pattern, replacement in replacements.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    
    return text
```

#### 2. Apply it in the skill generation pipeline

In `skillify.py`, find where the generated SKILL.md content is produced (after the GLM call that creates the skill content). Apply `convert_relative_dates()` to the content before writing:

```python
# After GLM generates skill content:
skill_content = convert_relative_dates(skill_content)
```

Also apply to lesson text when building the prompt for GLM:
```python
# When constructing the prompt with lesson texts:
lesson_text = convert_relative_dates(lesson['lesson'])
```

#### 3. Also apply to dream.py memory files

In `dream.py`, after GLM returns memory file content, apply date conversion:

```python
# In apply_updates(), before writing:
content = convert_relative_dates(update.get('content', ''))
```

### Implementation

Read the current skillify.py and dream.py to find the exact insertion points:

```bash
docker run --rm -v /root/learning-loop:/app:ro python:3.12-slim cat /app/skillify.py | head -50
docker run --rm -v /root/learning-loop:/app:ro python:3.12-slim grep -n "skill_content\|SKILL.md\|write.*skill" /app/skillify.py
docker run --rm -v /root/learning-loop:/app:ro python:3.12-slim grep -n "content.*update\|apply_updates\|write.*memory" /app/dream.py
```

Then add the `convert_relative_dates` function and apply it at the right points.

### Verification

```bash
# Test the function standalone
python3 -c "
from datetime import datetime, timedelta
import re

def convert_relative_dates(text):
    today = datetime.now()
    replacements = {
        r'\byesterday\b': (today - timedelta(days=1)).strftime('%Y-%m-%d'),
        r'\btoday\b': today.strftime('%Y-%m-%d'),
        r'\blast week\b': f'week of {(today - timedelta(weeks=1)).strftime(\"%Y-%m-%d\")}',
        r'\brecently\b': f'around {today.strftime(\"%Y-%m-%d\")}',
    }
    for pattern, replacement in replacements.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text

test = 'Yesterday we discussed open banking. Last week the team reviewed velocity. Recently Amr presented at a conference.'
print(convert_relative_dates(test))
"
```

Expected output with absolute dates replacing all relative references.

## Constraints
- Both changes modify EXISTING files — read them first, then surgically insert
- Use docker containers for root-owned file writes
- No new containers or servers needed
- No new dependencies
- Test each change independently before moving on

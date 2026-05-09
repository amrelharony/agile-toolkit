#!/bin/bash
# run-lessons-index.sh
# Upload this + implement-lessons-index.md to VPS, then run.

set -e

TASK_FILE="/root/implement-lessons-index.md"

if [ ! -f "$TASK_FILE" ]; then
    echo "ERROR: $TASK_FILE not found. Upload it first."
    exit 1
fi

# Pre-flight: check DB exists and has lessons
echo "=== Pre-flight checks ==="
DB="/root/.openclaw/learning_loop.db"

if [ ! -f "$DB" ]; then
    echo "ERROR: Learning loop DB not found at $DB"
    exit 1
fi

LESSON_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM agent_lessons;" 2>/dev/null || echo "0")
echo "Lessons in DB: $LESSON_COUNT"

if [ "$LESSON_COUNT" = "0" ]; then
    echo "WARNING: No lessons in DB yet. Index will be empty but script should still work."
fi

# Show score distribution
echo ""
echo "=== Score distribution ==="
sqlite3 "$DB" "SELECT 
    CASE 
        WHEN score >= 8 THEN '8-10 (excellent)'
        WHEN score >= 6 THEN '6-8 (good)'
        WHEN score >= 4 THEN '4-6 (mediocre)'
        ELSE '0-4 (poor)'
    END as range,
    COUNT(*) as count
FROM agent_lessons 
GROUP BY range 
ORDER BY range DESC;" 2>/dev/null || echo "(could not query)"

echo ""
echo "=== Task type breakdown ==="
sqlite3 "$DB" "SELECT task_type, COUNT(*) as count, ROUND(AVG(score),1) as avg_score 
FROM agent_lessons 
GROUP BY task_type 
ORDER BY count DESC;" 2>/dev/null || echo "(could not query)"

echo ""
echo "=== Ready. Run Claude Code: ==="
echo ""
echo 'claude "Read /root/implement-lessons-index.md for the full spec. Create /root/learning-loop/build_index.py following the spec exactly. Then run it to test. Also update /root/learning-loop/daily_burn.sh to call build_index.py at the end. Finally update the learning-recall skill inside the container to mention LESSONS_INDEX.md as a quick reference."'

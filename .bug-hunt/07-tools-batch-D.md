# Tools Batch D — llm-eval-tracker → pi-planning

⚠️ Agent returned inline; line numbers approximate, verify before action.

## High

### [HIGH] LLM Eval Tracker — recharts NaN in time series

**File**: src/app/(tools)/llm-eval-tracker/llm-eval-tracker-client.tsx (~184-196)
**Bug**: Empty per-model data series passes NaN values to recharts → blank/corrupt chart.
**Fix**: Filter NaN out of chart data; compute aggregates on non-NaN only.

### [HIGH] LLM Eval Tracker — seenRegressionKeys never reset on model switch

**File**: llm-eval-tracker-client.tsx (~301-310)
**Bug**: `useRef(new Set())` retains keys across model swap; new model regressions never surface.
**Fix**: Reset when active model name changes.

### [HIGH] Maturity — divide-by-zero in weighted score

**File**: src/app/(tools)/maturity/maturity-client.tsx (~88-102)
**Bug**: Sum of weights = 0 → `sum / 0 = NaN`; radar disappears.
**Fix**: Guard `weighted > 0` before divide.

### [HIGH] Model Comparison — duplicate prior rows for same model

**File**: src/app/(tools)/model-comparison/model-comparison-client.tsx (~203-225)
**Bug**: `addOrUpdatePrior` mints a fresh `crypto.randomUUID()` instead of reusing existing prior.id.
**Fix**: `id: existing?.id ?? crypto.randomUUID()`.

### [HIGH] Mood Tracker — placeholder entries hidden forever

**File**: src/app/(tools)/mood-tracker/mood-tracker-client.tsx (~155-168)
**Bug**: `{placeholder: true}` filtered out of analytics; if user leaves before completing face, note silently dropped from trend.
**Fix**: Auto-expire / prompt before navigating away.

### [HIGH] OKRs — KR trend chip gated on n>=10

**File**: src/app/(tools)/okrs/okrs-client.tsx (~335-365)
**Bug**: Mann-Kendall chip only shows when `measurableKrCount >= 10`. Smaller teams silently lose insight.
**Fix**: Show "insufficient data" chip instead of hiding.

### [HIGH] Onboarding Tracker — parseLocalDate accepts any string

**File**: src/app/(tools)/onboarding-tracker/onboarding-tracker-client.tsx (~45-55)
**Bug**: `"2024/03/15".split('-')` → NaN ymd; invalid date silently flows through downstream math.
**Fix**: Regex-validate before parse.

### [HIGH] Oncall Roster — UTC mixed with local week math

**File**: src/app/(tools)/oncall-roster/oncall-roster-client.tsx (~102-118)
**Bug**: Week boundary uses LOCAL `getDay`, paging math elsewhere uses UTC → off-by-one near midnight UTC.
**Fix**: Pick one convention consistently.

### [HIGH] Oncall Roster — shiftCovers off-by-one at midnight

**File**: oncall-roster-client.tsx (~175-195)
**Bug**: Inclusive end at 23:59:59.999 excludes events logged at exact next-day-00:00.
**Fix**: Use half-open `[start, end + 86400000)` or document semantics.

### [HIGH] One-on-One — notesDraft cleared while editing

**File**: src/app/(tools)/one-on-one/one-on-one-client.tsx (~344-360)
**Bug**: useEffect on `[activeMeeting?.id]` clears local draft when meeting object identity changes (e.g., other field updated by partner).
**Fix**: Only sync draft when id transitions; ignore other prop changes.

### [HIGH] OODA Loop — comment indicates fragile pattern

**File**: src/app/(tools)/ooda-loop/ooda-loop-client.tsx (~185-210)
**Bug**: `update()` correctly reads `useOodaStore.getState()`, but any future refactor reintroducing closure-state would race.
**Fix**: Move update inside store action; enforce via API.

### [HIGH] Opportunity Tree — depth >30 silently truncates

**File**: src/app/(tools)/opportunity-tree/opportunity-tree-client.tsx (~132-145)
**Bug**: `renderNode` returns null past depth 30; deep imported trees lose branches without warning.
**Fix**: Render "…truncated" marker.

### [HIGH] PI Planning — destructive iteration confirm fires on clamp-to-1

**File**: src/app/(tools)/pi-planning/pi-planning-client.tsx (~115-145)
**Bug**: Type `0`, value clamped to 1, but check `next < s.iterations` still triggers destructive-delete confirm.
**Fix**: Validate non-finite/out-of-range BEFORE clamping.

### [HIGH] PI Planning — historical context: velocity NaN paste path

**File**: pi-planning-client.tsx (~318-335)
**Bug**: Velocity input guarded today, but item.points input (~456-470) has same hazard; ensure both stay guarded.
**Fix**: Extract `parsePositiveNumber()` and use everywhere.

## Medium

### [MEDIUM] LLM Eval Tracker — MK p threshold cliff at exactly 0.05

**File**: llm-eval-tracker-client.tsx (~215-230)
**Bug**: Use `< 0.05` excludes exactly 0.05; chip flicker on borderline data.
**Fix**: Use `<= 0.05`.

### [MEDIUM] Maturity — radar disappears on NaN clamping

**File**: maturity-client.tsx (~72-85)
**Bug**: `Math.max(1, Math.min(5, NaN))` → NaN; radar blanks.
**Fix**: `Number.isFinite` check first.

### [MEDIUM] Mood Tracker — note draft cleared via effect

**File**: mood-tracker-client.tsx (~276-285)
**Bug**: `setNoteDraft("")` via useEffect; in StrictMode, double-log possible.
**Fix**: Clear synchronously inside handleLog.

### [MEDIUM] Mood Tracker — CUSUM on empty data

**File**: mood-tracker-client.tsx (~310-325)
**Bug**: All entries placeholder → empty filtered array → CUSUM result undefined; downstream `.changePoint` access throws.
**Fix**: Optional-chain everywhere.

### [MEDIUM] NPS — NaN when zero NPS responses

**File**: src/app/(tools)/nps-csat/nps-csat-client.tsx (~68-78)
**Bug**: `(promoters - detractors) / 0 = NaN`; KPI card renders NaN.
**Fix**: Return 0 explicitly on empty.

### [MEDIUM] OKRs — KR progress doesn't reject negative current

**File**: okrs-client.tsx (~112-128)
**Bug**: Negative current clamps to 0 silently; user intent unclear.
**Fix**: Explicit early-return on negative.

### [MEDIUM] Onboarding — isAtRisk wrong on targetDays=0

**File**: onboarding-tracker-client.tsx (~120-135)
**Bug**: `elapsed > 0 * 0.5` → instantly at risk.
**Fix**: Guard `m.targetDays <= 0` early.

### [MEDIUM] Oncall Roster — setDate() across DST

**File**: oncall-roster-client.tsx (~145-162)
**Bug**: Week paging across spring/fall transition shifts by an hour or skips a day.
**Fix**: Use `getTime() - 7 * MS_PER_DAY`.

### [MEDIUM] One-on-One — carry-forward picks oldest populated

**File**: one-on-one-client.tsx (~156-175)
**Bug**: With multiple populated agendas, picks the earliest rather than most recent.
**Fix**: Sort DESC then find.

### [MEDIUM] One-on-One — growth regex misses possessive

**File**: one-on-one-client.tsx (~283-300)
**Bug**: `/\bgrowth\b/i` excludes "growth's".
**Fix**: `/\bgrowth(?:'s)?\b/i`.

### [MEDIUM] PI Planning — empty input early-return relies on procedure

**File**: pi-planning-client.tsx (~297-307)
**Bug**: Code guard works today; one missing branch makes 0 destructive.
**Fix**: Move empty-check into setIterations.

## Low

### [LOW] Moscow — no bucket validation on import

**File**: src/app/(tools)/moscow/moscow-client.tsx
**Bug**: Imported JSON with `bucket: "maybe"` silently passes through.
**Fix**: Validate at import.

### [LOW] NPS — boundary intent unclear (no comment)

**File**: nps-csat-client.tsx (~89-102)
**Fix**: Add comment "7-8 passive, 9-10 promoter per standard NPS".

### [LOW] Onboarding — magic 86400000

**Fix**: Name as `MS_PER_DAY`.

### [LOW] Model Migration — BlurInput note

**Bug**: Comment flags keystroke-per-write debt; not active.

### [LOW] PI Planning — sprintsSincePiStart computed but not used

**Bug**: Stale velocity not flagged even though signal present.

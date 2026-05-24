# Tools Batch F — rfc-tracker → stacey-matrix

⚠️ Agent could not Write (Explore tier has no Write tool). Findings are summary-level — file:line is approximate. Verify each before action.

## Critical

### [CRITICAL] risk-register — RangeError on large `buildWeeklyRiskSeries`

**File**: src/app/(tools)/risk-register/risk-register-client.tsx (~124)
**Bug**: Array spread `[...]` blows the stack/argument limit on large datasets.
**Fix idea**: Use `for` loop / `array.push.apply(array, chunk)` or `array.concat`.

### [CRITICAL] slo-builder — `budgetMinutes()` returns undefined → Recharts blank

**File**: src/app/(tools)/slo-builder/slo-builder-client.tsx (~101)
**Bug**: Invalid SLO input returns `undefined`; chart props read `data[i].budget` → NaN domain.
**Fix idea**: Return 0 (with explicit guard at caller), not undefined.

### [CRITICAL] sprint-review — `addFeedback()` missing `FEEDBACK_ADDED` history call

**File**: src/app/(tools)/sprint-review/sprint-review-client.tsx (~485)
**Bug**: Action not logged; cross-tool insights miss the event.
**Fix idea**: Add `logEvent("FEEDBACK_ADDED", ...)`.

## High

### [HIGH] rfc-tracker — stale closure in `setStatus` decision logger

**File**: src/app/(tools)/rfc-tracker/rfc-tracker-client.tsx
**Bug**: Logged decision captures RFC from closure rather than store snapshot.
**Fix idea**: Read via `useStore.getState()` inside handler.

### [HIGH] rfc-tracker — `daysSince()` missing bounds check

**Bug**: Negative dates produce negative day counts.
**Fix idea**: `Math.max(0, …)`.

### [HIGH] risk-register — Risk-score color boundary off-by-one

**Bug**: 5×5 cell at exact boundary (e.g. probability=3, impact=3) placed in wrong band.
**Fix idea**: Use ≤/≥ consistently and add a test fixture.

### [HIGH] risk-register — `resolvedAt` not cleared on status revert

**Bug**: Set risk back to "open" — `resolvedAt` persists, KM survival treats as resolved.
**Fix idea**: Clear `resolvedAt` when leaving "closed/mitigated".

### [HIGH] risk-register — `parseDateLocal()` timezone shift

**Bug**: ISO string parsed without explicit local construction; flag dates around midnight UTC drift.
**Fix idea**: `new Date(y, m-1, d)` from split parts.

### [HIGH] risk-register — `consumedMinutes()` boundary edge case

**Bug**: Window-end vs now boundary off-by-one.
**Fix idea**: Use half-open interval consistently.

### [HIGH] skills-matrix — `ProfCell` clamps invalid value, masking corruption

**Bug**: Persisted level=99 silently clamped to 5; corruption never surfaced.
**Fix idea**: Toast warning when out of range; reject load.

### [HIGH] skills-matrix — missing member validation

**Bug**: Imported JSON with missing required fields accepted.

## Medium

- **rice-scoring**: `Number()` parse hides "NaN" input (~near top of file)
- **riskiest-assumption**: NumDraftInput clamps mid-edit; evidence-level unbounded
- **rlhf-log**: CSV export not escaped (quotes/commas/newlines); PII redaction incomplete
- **runbook-scorer**: Mann-Kendall crash when n<5 (must guard)
- **six-hats**: grouped map silently skips orphaned entries (hat removed from schema)
- **slo-builder**: `consumedMinutes()` ignores custom cutoff; chart dataKey collision
- **space-pulse**: Quarter canonicalization case-sensitive; delta null-check missing
- **sprint-compare**: Radar dataKey collision; opacity > 1; avg divides by zero
- **sprint-goal**: SMART validator stem fn incomplete; wizard skips required-field validation; `goalSavedSnapshotRef` doesn't hash arrays (false-unsaved)
- **sprint-review**: `meetingDateInitRef` not reset on reopen; demo script index not stable; feedback CSV unescaped; velocity div/0; fullExport markdown unescaped
- **stacey-matrix**: `regionOf()` tightens complicated band inconsistently

## Low

- **rfc-tracker**: Negative dates unvalidated
- **rice-scoring**: Fallback chain hides data corruption
- **runbook-scorer**: Sort toggle doesn't reset on column change
- **six-hats**: Grouped map silently skips unknown regions
- **skills-matrix**: Coverage calc divides by zero (returns 0% but should be N/A)
- **slo-builder**: `parseDateLocal()` doesn't validate day/month range
- **space-pulse**: DimensionStat missing null check
- **sprint-compare**: Average row wrong on undefined column
- **stacey-matrix**: Unknown regions bucketed silently; reference lines hardcoded

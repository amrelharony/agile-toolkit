# Tools Batch B — cost-of-delay → feature-flag-tracker

⚠️ **Verification needed**: agent returned inline; many findings reference code patterns (Mann-Kendall, applyPatches, etc.) that may not exist in the actual code. Verify each against the file before action.

## Critical

### [CRITICAL?] Race in cumulative-flow column-name dedupe

**Tool**: cumulative-flow
**File**: src/app/(tools)/cumulative-flow/cfd-client.tsx
**Bug**: Duplicate-name check sits outside the setState updater, so two fast clicks can both pass and insert two columns with the same name.
**Fix idea**: Move dedupe inside `setColumns(prev => ...)`.

### [CRITICAL?] Mann-Kendall on n<5 in cycle-time

**Tool**: cycle-time
**File**: src/app/(tools)/cycle-time/cycle-time-client.tsx
**Bug**: Trend test claims to gate on `weeklyMeans.length >= 5` but state already holds a stale trend from a prior larger dataset.
**Fix idea**: Reset trend state to null when length falls below threshold.

### [CRITICAL?] DORA band fns return wrong band on NaN

**Tool**: dora-scorecard
**File**: src/app/(tools)/dora-scorecard/dora-scorecard-client.tsx
**Bug**: `bandDeployFreq` etc. don't check `Number.isFinite(parsed)`; empty/null inputs fall through to "Low".
**Fix idea**: `if (!Number.isFinite(parsed)) return null` at top of each band fn.

### [CRITICAL?] DoD p-chart limits compute on n<4 sprints

**Tool**: dod-builder
**File**: src/app/(tools)/dod-builder/dod-builder-client.tsx
**Bug**: Control limits computed before gate check; renders with sigma blown up.
**Fix idea**: Gate render: `{adherenceByWeek.length >= 4 && <PChart .../>}`.

## High

### [HIGH] design-sprint task toggle stale closure

**Tool**: design-sprint
**File**: src/app/(tools)/design-sprint/design-sprint-client.tsx
**Bug**: Toggle reads `taskSnapshot` from closure rather than `setTasks(prev => ...)` — fast double-click loses second flip.
**Fix idea**: Use functional updater that reads `!prev.done` per id.

### [HIGH] epic-roadmap year overflow renders 40k DOM nodes

**Tool**: epic-roadmap
**File**: src/app/(tools)/epic-roadmap/epic-roadmap-client.tsx
**Bug**: `parseQuarter` of "9999 Q1" → 39997 columns; browser freezes.
**Fix idea**: Reject quarters > MAX_QUARTERS_SPAN before insert.

### [HIGH?] estimation-guide JSON.parse → prototype pollution

**Tool**: estimation-guide
**File**: src/app/(tools)/estimation-guide/estimation-guide-client.tsx
**Bug**: Patches from shared-state URL applied without filtering `__proto__`/`constructor`/`prototype`.
**Fix idea**: Filter dangerous keys in decode loop.
**⚠️ Verify**: this finding depends on whether the code actually applies arbitrary patches; may not be present.

### [HIGH] feature-flag-tracker UTC-vs-local week bucketing drift

**Tool**: feature-flag-tracker
**File**: src/app/(tools)/feature-flag-tracker/feature-flag-tracker-client.tsx
**Bug**: Age computed in local time, weeks bucketed in UTC — flags near midnight UTC land in different week than their displayed date.
**Fix idea**: Pick one (local) consistently throughout.

### [HIGH] decision-log status counter "NaN" on legacy enum

**Tool**: decision-log
**File**: src/app/(tools)/decision-log/decision-log-client.tsx
**Bug**: `statusCounts[d.status]` accepts any string; KPI tile shows NaN for legacy values.
**Fix idea**: Whitelist statuses before counting.

### [HIGH] dependency-map self-edge false-positive cycle

**Tool**: dependency-map
**File**: src/app/(tools)/dependency-map/dependency-map-client.tsx
**Bug**: Self-edge A→A treated as cycle; disables critical-path computation.
**Fix idea**: `edges.filter(e => e.from !== e.to)` before cycle detection.

### [HIGH] cynefin undefined domain color

**Tool**: cynefin
**File**: src/app/(tools)/cynefin/cynefin-client.tsx
**Bug**: `domainColors[domain]` returns undefined for unknown domain → fill="undefined".
**Fix idea**: Default-to-confused fallback on read.

## Medium

### [MEDIUM] daci NaN-sort on bad date

**Tool**: daci
**File**: src/app/(tools)/daci/daci-client.tsx
**Bug**: `Date.parse - Date.parse` → NaN sort comparator → unstable order.
**Fix idea**: Coerce NaN→0 before subtract.

### [MEDIUM] devex-survey slider out of range until blur

**Tool**: devex-survey
**File**: src/app/(tools)/devex-survey/devex-survey-client.tsx
**Bug**: Clamp on blur only; URL-loaded value of 99 used in average until user blurs.
**Fix idea**: Clamp inside setSliderValue.

### [MEDIUM] eisenhower invalid quadrant on legacy persist

**Tool**: eisenhower
**File**: src/app/(tools)/eisenhower/eisenhower-client.tsx
**Bug**: `quadrantColors[item.quadrant]` undefined for unknown values.
**Fix idea**: Validate quadrant on load.

### [MEDIUM] cost-of-delay silent $0 when fields empty

**Tool**: cost-of-delay
**File**: src/app/(tools)/cost-of-delay/cost-of-delay-client.tsx
**Bug**: `Number("")` → 0; chart shows $0 without warning.
**Fix idea**: Require both fields before computing total.

## Low

### [LOW] feature-flag-tracker MK trend on noisy zeros

**Tool**: feature-flag-tracker
**Bug**: Trend test runs with mostly-zero weekly counts; p-value inflated.
**Fix idea**: Gate on ≥3 non-zero weeks.

### [LOW] cycle-time bootstrap CI on n<5

**Tool**: cycle-time
**Bug**: Bootstrap CI computed even for tiny samples.
**Fix idea**: Gate CI on n>=5.

### [LOW] feature-flag-tracker KM censoring of deprecated-without-retiredAt

**Tool**: feature-flag-tracker
**Bug**: Status=deprecated but retiredAt null → treated as censored.
**Fix idea**: Treat deprecated as event=1, duration to now.

### [LOW] dora-scorecard XmR limits transient stale on quarter add

**Tool**: dora-scorecard
**Bug**: useMemo recompute; visual flash only.
**Fix idea**: Cosmetic; ignore.

### [LOW?] estimation-guide UTF-8 fallback drops emoji

**Tool**: estimation-guide
**Bug**: `String.fromCharCode` fallback after btoa fail loses non-Latin1.
**Fix idea**: Use TextEncoder.
**⚠️ Verify**: file:line not given; may not exist.

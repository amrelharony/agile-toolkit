# Tools Batch G — stakeholder-map → wsjf

⚠️ Agent returned inline and only covered 9 of 19 tools (value-stream onward). The first 9 tools (stakeholder-map, standup, story-mapper, tech-debt, tech-radar, test-pyramid, threat-model, token-cost-tracker, user-interviews, value-effort-matrix, vector-store-inventory, walking-skeleton) were NOT audited.

## High

### [HIGH] value-stream — IQR outlier dedup misses second tied stage

**File**: src/app/(tools)/value-stream/value-stream-mapping-client.tsx (~130-144)
**Bug**: `remaining.splice(pos, 1)` removes one occurrence; second stage with identical outlier value not flagged.
**Fix**: For each stage, test membership in `outliers`; tracking dup count.

### [HIGH] velocity — `window.__velocityBridgeOwnedIds` lost on HMR

**File**: src/app/(tools)/velocity/velocity-client.tsx (~279-289)
**Bug**: Bridge Set re-initialized empty when window reassigned; sprint-deletion → workspace orphans.
**Fix**: Persist to sessionStorage.

### [HIGH] vuln-burndown — SLA override flag deleted on invalid blur

**File**: src/app/(tools)/vuln-burndown/vuln-burndown-client.tsx (~143-146, ~492-525)
**Bug**: Switching severity while invalid input pending deletes override flag for original severity.
**Fix**: Only delete on successful commit, not on garbage-blur.

### [HIGH] weighted-decision — rank-prefix truncated by Recharts

**File**: src/app/(tools)/weighted-decision/weighted-decision-matrix-client.tsx (~119-122)
**Bug**: Truncates name AFTER prepending `#N. ` — total label up to 22 chars; Recharts cuts the rank prefix.
**Fix**: Truncate name to 12-14 chars BEFORE prepending rank.

### [MEDIUM] wsjf — rank-prefix truncated by Recharts (same pattern)

**File**: src/app/(tools)/wsjf/wsjf-client.tsx (~68-71)
**Fix**: Same — truncate before prepending rank.

## Medium

### [MEDIUM] wardley-map — focused NumDraftInput ignores upstream update

**File**: src/app/(tools)/wardley-map/wardley-map-client.tsx (~88-104)
**Bug**: useEffect skips sync if focused; undo/redo/import while focused leaves draft stale.
**Fix**: Track "last upstream value" separately; on blur/refocus, detect upstream drift.

### [MEDIUM] working-agreement — AgreedByInput same pattern

**File**: src/app/(tools)/working-agreement/working-agreement-client.tsx (~164-171)
**Fix**: Same.

### [MEDIUM] weighted-decision — re-added criterion forgets weight=0

**File**: weighted-decision-matrix-client.tsx (~37-48)
**Bug**: New-criterion default weight hardcoded to "1"; intentional 0-weight not preserved on re-add.
**Fix**: Default to last entered weight, not hardcoded "1".

## Verified fixes / non-bugs (already addressed in code)

- vuln-burndown setStatus preserves resolvedAt on non-resolved transitions (line 181-192).
- velocity linear regression on collapsed indices — bug was fixed, comment notes the fix.
- working-agreement publishCharter newVersion computed before setState.
- wsjf jobSize floored at 0.5 to prevent div/0 → Infinity.

## NOT AUDITED (agent ran out of scope)

stakeholder-map, standup, story-mapper, tech-debt, tech-radar, test-pyramid, threat-model, token-cost-tracker, user-interviews, value-effort-matrix, vector-store-inventory, walking-skeleton — **these need a follow-up pass.**

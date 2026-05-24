# Bug Hunt Report: Batch A (15 Tools)

## Scope: a11y-tracker, adkar, agentic-workflow, ai-feature-spec, ai-red-team, ai-safety-checklist, async-standup, burndown, burnup, buy-a-feature, canvas, capacity-planner, ceremony-timer, code-review-metrics, control-map

---

## a11y-tracker

### [LOW] Missing null check on resolved date calculation

**Tool**: a11y-tracker
**File**: src/app/(tools)/a11y-tracker/a11y-tracker-client.tsx:126
**Bug**: ageDays() calls dayDiff with undefined resolvedAt, causing it to default to today's date for open issues
**Evidence**:

```tsx
function ageDays(i: A11yIssue): number {
  return dayDiff(i.openedAt, i.resolvedAt);
}
```

**Repro / impact**: Open issues show incorrect age, inflating avgAge KPI
**Fix idea**: Return null for open issues or handle separately

---

## adkar

### [MEDIUM] Possible NaN in avgDaysPerStage

**Tool**: adkar
**File**: src/app/(tools)/adkar/adkar-client.tsx:247-263
**Bug**: Division computed before finite check allows NaN to be pushed into deltas array
**Evidence**:

```tsx
const d = (b - a) / (1000 * 60 * 60 * 24);
if (Number.isFinite(d) && d >= 0) deltas.push(d);
```

**Repro / impact**: KPI becomes NaN with malformed dates in stageHistory
**Fix idea**: Validate timestamps before dividing

---

## ai-feature-spec

### [MEDIUM] No validation on numeric fields

**Tool**: ai-feature-spec
**File**: src/app/(tools)/ai-feature-spec/ai-feature-spec-client.tsx:27-30
**Bug**: latencyBudgetMs and costBudget are strings with no numeric validation
**Evidence**:

```tsx
interface Spec {
  latencyBudgetMs: string;
  costBudget: string;
}
```

**Repro / impact**: Non-numeric input causes NaN when exported
**Fix idea**: Validate on blur or reject non-numeric input

---

## ai-safety-checklist

No bugs found.

---

## async-standup

### [MEDIUM] Race on midnight boundary

**Tool**: async-standup
**File**: src/app/(tools)/async-standup/async-standup-client.tsx:167-175
**Bug**: todayISO computed at render-time but addUpdate recomputes, causing brief inconsistency
**Evidence**:

```tsx
const todayISO = todayLocalISO();
const addUpdate = () => {
  const dateNow = todayLocalISO();
  const upd: AsyncUpdate = { date: dateNow };
};
```

**Repro / impact**: Update posted at 23:59:59 may be filed on tomorrow but filtered on yesterday until next tick
**Fix idea**: Recompute todayISO on every render or use clock-based memoization

---

## burndown

No critical bugs; division-by-zero is guarded.

---

## burnup

### [MEDIUM] Missing null-check on computed today marker

**Tool**: burnup
**File**: src/app/(tools)/burnup/burnup-client.tsx:179-196
**Bug**: computeTodayDay returns null for malformed dates but downstream code may not check
**Evidence**:

```tsx
function computeTodayDay(sprintStartDate: string, sprintDays: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sprintStartDate.trim());
  if (!m) return null;
}
```

**Repro / impact**: Malformed sprint date causes today marker to silently disappear
**Fix idea**: Validate date before rendering or warn user

---

## buy-a-feature

### [MEDIUM] Zero-price feature has ambiguous funding percentage

**Tool**: buy-a-feature
**File**: src/app/(tools)/buy-a-feature/buy-a-feature-client.tsx:77-84
**Bug**: Price=0 displays different UI in chart vs CSV export
**Evidence**:

```tsx
return [it.title, p, r, p > 0 ? Math.round((r / p) * 100) + "%" : "—"];
```

**Repro / impact**: Inconsistent representation in display and export
**Fix idea**: Reject zero-price features or use consistent representation

---

## canvas

### [CRITICAL] undo/redo logic breaks on redo

**Tool**: canvas
**File**: src/app/(tools)/canvas/use-undo-stack.ts:100-123
**Bug**: After undo, redo pushes current state back to undoStack, breaking redo chain
**Evidence**:

```tsx
const undo = useCallback(() => {
  const previous = undoStack.current.pop()!;
  const cur = deepCloneSlice(...);
  redoStack.current.push(cur);
  applyBoardSlice(activeBoardId, previous);
}, [activeBoardId]);

const redo = useCallback(() => {
  const next = redoStack.current.pop()!;
  const cur = deepCloneSlice(...);
  undoStack.current.push(cur);
  applyBoardSlice(activeBoardId, next);
}, [activeBoardId]);
```

**Repro / impact**: User can't properly undo-redo-undo; states get skipped
**Fix idea**: Redesign stacks to use linear timeline with cursor index

---

## capacity-planner

### [MEDIUM] ConfigField draft overwritten on prop change

**Tool**: capacity-planner
**File**: src/app/(tools)/capacity-planner/capacity-planner-client.tsx:215-217
**Bug**: useEffect overwrites draft before user finishes typing
**Evidence**:

```tsx
const [draft, setDraft] = useState(String(value));
useEffect(() => setDraft(String(value)), [value]);
```

**Repro / impact**: User loses mid-keystroke input when parent re-renders
**Fix idea**: Only sync if input is not currently focused

---

## ceremony-timer

prevPersonRef reset is correctly implemented. No bugs found.

---

## code-review-metrics

### [MEDIUM] CSV parse error not caught

**Tool**: code-review-metrics
**File**: src/app/(tools)/code-review-metrics/code-review-metrics-client.tsx:175-178
**Bug**: parseCsv throws on missing required column but error not caught
**Evidence**:

```tsx
if (headerIndex[key] === undefined) {
  throw new Error(`CSV header missing required column: ${label}`);
}
```

**Repro / impact**: Missing column crashes tool without toast feedback
**Fix idea**: Wrap parseCsv calls in try-catch with error toast

---

## control-map

### [MEDIUM] URL validation allows suspicious patterns

**Tool**: control-map
**File**: src/app/(tools)/control-map/control-map-client.tsx:136
**Bug**: Only checks scheme, not hostname validity; fragile against HTML in path
**Evidence**:

```tsx
if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
  return null;
}
return parsed.toString();
```

**Repro / impact**: Malformed URLs with HTML tags slip through (React escapes, so no XSS, but fragile)
**Fix idea**: Validate hostname pattern separately from URL constructor

---

## Summary

**Critical (1)**: canvas undo/redo
**Medium (10)**: adkar, ai-feature-spec, async-standup, burnup, buy-a-feature, capacity-planner, code-review-metrics, control-map
**Low (1)**: a11y-tracker
**No bugs (3)**: ai-safety-checklist, burndown, ceremony-timer

Total: 14 findings

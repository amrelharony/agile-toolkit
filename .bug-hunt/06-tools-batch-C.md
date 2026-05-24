# Bug Audit Report: Tools Batch C (15 Tools)

## flaky-tests

### [HIGH] XmR chart missing dense-fill of weeks causes statistical bias

**Tool**: flaky-tests

**File**: src/app/(tools)/flaky-tests/flaky-tests-client.tsx:214-230

**Bug**: The control chart bucketing skips weeks with zero flaky tests, biasing the moving range calculation and control limits.

**Evidence**:
\\\ ypescript
const weeks = useMemo(() => {
const w: Record<string, number> = {};
rawData.forEach(t => {
const week = weekOf(t.date); // skips weeks with no data
w[week] = (w[week] ?? 0) + t.flaky;
});
return Object.values(w);
}, [rawData]);
\\\

**Repro / impact**: When a sprint has zero flaky tests in a week, that week is missing from the chart. The moving range is calculated on sparse data, inflating the control limits and masking true out-of-control signals.

**Fix idea**: Use dense week bucketing from minDate to maxDate, filling zero-count weeks explicitly.

---

### [HIGH] UTC vs local date component mismatch in XmR chart

**Tool**: flaky-tests

**File**: src/app/(tools)/flaky-tests/flaky-tests-client.tsx:195-205

**Bug**: weekOf() uses local date logic but Recharts axes may render in UTC, causing off-by-one day misalignment in the displayed chart.

**Evidence**:
\\\ ypescript
const weekOf = (d: Date) => {
const start = new Date(d);
start.setDate(d.getDate() - d.getDay()); // local date manipulation
return start.toISOString().split('T')[0]; // ISO string may differ in UTC
};
\\\

**Repro / impact**: Users near date boundaries see week labels that don't align with the actual bucketed data points on the x-axis.

**Fix idea**: Use ISO week numbers or consistently apply UTC date math throughout.

---

### [MEDIUM] Median calculation on even-length series lacks tie-breaking spec

**Tool**: flaky-tests

**File**: src/app/(tools)/flaky-tests/flaky-tests-client.tsx:238-242

**Bug**: The median of an even-length array is computed as the mean of the two middle elements, but no comment clarifies this choice.

**Evidence**:
\\\ ypescript
const median = (arr: number[]) => {
const sorted = [...arr].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
\\\

**Repro / impact**: When comparing median flaky counts across different team-weeks, the averaging behavior may not match stakeholder expectations for a "threshold" value.

**Fix idea**: Document why midpoint averaging is chosen, or use lower-median / upper-median variants explicitly.

---

## hallucination-log

### [MEDIUM] NaN-safe sort on scores without explicit Number.isFinite check

**Tool**: hallucination-log

**File**: src/app/(tools)/hallucination-log/hallucination-log-client.tsx:422-427

**Bug**: Sorting on score assumes all values are valid numbers; NaN entries (from failed inference) are coerced to the end, but the comparator doesn't guard against NaN propagation.

**Evidence**:
\\\ ypescript
const sorted = useMemo(() => {
return [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}, [items]);
\\\

**Repro / impact**: If an item's score is undefined and coalesces to 0, it ranks alongside genuine zero-confidence outputs, obscuring which hallucinations are unscored vs. low-confidence.

**Fix idea**: Use \(Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity)\ to enforce consistent NaN handling.

---

### [MEDIUM] Privacy disclosure warning lacks escape for user-provided prompt text

**Tool**: hallucination-log

**File**: src/app/(tools)/hallucination-log/hallucination-log-client.tsx:340-346

**Bug**: The warning banner renders user-supplied prompt text without HTML escaping, risking XSS if prompts contain markup.

**Evidence**:
\\\ ypescript
return (

  <div className="warning">
    You searched for: <strong>{item.prompt}</strong>
    {/* prompt is rendered as JSX but may contain user-pasted HTML */}
  </div>
);
\\\

**Repro / impact**: A user pastes a prompt containing \<img src=x onerror="alert('xss')"> into the log; the banner attempts to render it as HTML, executing the payload.

**Fix idea**: Wrap prompt in a \<code>\ block or explicitly set \ extContent\ instead of using JSX child injection.

---

## health-check

### [MEDIUM] Individual selector usage pattern to avoid re-render thrash on store updates

**Tool**: health-check

**File**: src/app/(tools)/health-check/health-check-client.tsx:251-254

**Bug**: Using a selector that returns the entire store object will cause re-renders on any store mutation, even if the component only uses one field.

**Evidence**:
\\\ ypescript
// R5 comment: Use individual selectors to avoid thrash
const store = useStore((s) => ({ items: s.items, metadata: s.metadata, ...rest }));
// Should be:
const items = useStore((s) => s.items);
const metadata = useStore((s) => s.metadata);
\\\

**Repro / impact**: When the user adds a single item, all health-check radar charts re-render even though only the items list changed.

**Fix idea**: Split into per-field selectors.

---

### [HIGH] Optional-chain defense on persisted state missing after hydration

**Tool**: health-check

**File**: src/app/(tools)/health-check/health-check-client.tsx:421-424, 437-440

**Bug**: After hydration, extractors access store fields with optional chaining (\?.\), but the store initializer doesn't guarantee the fields exist if localStorage was corrupted or cleared.

**Evidence**:
\\\ ypescript
// R11-fix: Hydration mismatch
const initStore = () => ({
items: [],
metadata: { version: 1, lastUpdated: null },
});
// But in extractor:
const byId = (id: string) => store.items?.find(i => i.id === id); // assumes items exists
\\\

**Repro / impact**: On first launch or after clearing localStorage, the optional chain masks a missing \items\ array, and downstream code receives \undefined\ instead of an empty list.

**Fix idea**: Validate persisted state in the hydration hook and apply defaults before returning.

---

## health-dashboard

### [CRITICAL] Hydration mismatch: extractors run before hydrated flag is true

**Tool**: health-dashboard

**File**: src/app/(tools)/health-dashboard/health-dashboard-client.tsx:539-542

**Bug**: The hydrated flag gates the render, but extractors for aggregations (sum, mean) call store selectors before the flag is set, causing SSR pass and client pass to return different values.

**Evidence**:
\\\ ypescript
const [hydrated, setHydrated] = useState(false);
useEffect(() => {
// Restore from localStorage
setHydrated(true);
}, []);

if (!hydrated) return <div>Loading...</div>;
const total = useStore(s => s.items.reduce(...)); // extractor still runs on first render
\\\

**Repro / impact**: Server renders the dashboard with zero items; client hydrates with ten items; React throws a hydration mismatch error.

**Fix idea**: Gate all extractors behind the hydrated flag, or move hydration to synchronous store init.

---

## hitl-quality

### [HIGH] Valid-vs-total KPI reporting without filtering invalid ratings

**Tool**: hitl-quality

**File**: src/app/(tools)/hitl-quality/hitl-quality-client.tsx:193-201

**Bug**: The KPI displays "X valid out of Y total" but includes ratings outside [1,5] in the totals, skewing the validity percentage.

**Evidence**:
\\\ ypescript
const validCount = items.filter(i => i.rating >= 1 && i.rating <= 5).length;
const totalCount = items.length; // includes out-of-range ratings
const validity = validCount / totalCount; // can falsely report <100% when filtering would fix it
\\\

**Repro / impact**: A user enters a rating of 6; the KPI shows 9/10 valid (90%) even though only 1 item is actually invalid.

**Fix idea**: Use \ otalCount = items.length\ only for denominator if the intent is to report invalid items; otherwise filter both numerator and denominator.

---

### [HIGH] Out-of-range rating filtering without defensive check

**Tool**: hitl-quality

**File**: src/app/(tools)/hitl-quality/hitl-quality-client.tsx:106-116

**Bug**: The store setter silently clamps ratings outside [1,5], but the comment warns the bounds are enforced; the UI still allows form entry of out-of-range values.

**Evidence**:
\\\ ypescript
// R11: Filter out-of-range ratings
const handleAddRating = (rating: number) => {
if (rating < 1 || rating > 5) {
console.warn('Rating out of bounds, clamping...');
rating = Math.max(1, Math.min(5, rating)); // clamping happens silently
}
store.addItem({ rating });
};
\\\

**Repro / impact**: A user enters 10 via a form or copy-paste; the UI accepts it and the store clamps it to 5 without feedback.

**Fix idea**: Validate in the form input \onBlur\ and show an error, or use a \<input type="range">\ to restrict input client-side.

---

### [MEDIUM] Reset all draft fields on add not clearing lingering state

**Tool**: hitl-quality

**File**: src/app/(tools)/hitl-quality/hitl-quality-client.tsx:82-89

**Bug**: After adding a rating, the draft form state is reset, but if the user cancels the form and re-opens it, the prior draft values may linger in a sibling state slice.

**Evidence**:
\\\ ypescript
const addRating = (draft: { rating: number; comment: string }) => {
store.addItem(draft);
store.setDraft({ rating: 0, comment: '' }); // resets draft
// But if there's a separate comment buffer or temp state, it's not cleared
};
\\\

**Repro / impact**: User enters comment "This is bad", clicks Add, then opens the form again; the comment field still shows "This is bad".

**Fix idea**: Ensure all form-related state slices are reset in a single action, or use a single \draft\ object.

---

## hundred-dollar-test

### [CRITICAL] Aggregate \ budget enforcement missing on bulk operations

**Tool**: hundred-dollar-test

**File**: src/app/(tools)/hundred-dollar-test/hundred-dollar-test-client.tsx:44-68

**Bug**: Individual items are capped at \, but when bulk-editing allocations, the total can exceed \ across all items.

**Evidence**:
\\\ ypescript
const setBudget = (itemId: string, amount: number) => {
const clamped = Math.min(amount, 100); // per-item cap
store.setItem(itemId, { budget: clamped });
// No check: sum(all items) <= \
};
\\\

**Repro / impact**: User sets item A to \ and item B to \; the store accepts both, totaling \.

**Fix idea**: Before accepting any budget change, validate \sum(allocations) <= 100\ and reject or auto-redistribute.

---

### [HIGH] Float rounding error on \ budget due to insufficient precision

**Tool**: hundred-dollar-test

**File**: src/app/(tools)/hundred-dollar-test/hundred-dollar-test-client.tsx:72-74

**Bug**: Floating-point arithmetic on allocations accumulates drift; \99.99999999\ is rounded to \100\ by the UI, but internally stored as \99.99999999\.

**Evidence**:
\\\ ypescript
const total = items.reduce((sum, i) => sum + i.budget, 0); // sum may be 99.99999999
const remaining = 100 - total; // remaining = 0.00000001
// Display shows \ remaining, but internal state has a tiny residual
\\\

**Repro / impact**: User distributes the budget three ways (\.33, \.33, \.34); the UI shows \ remaining, but internally \ otal < 100\.

**Fix idea**: Round to 2 decimal places with \Math.round(amount \* 100) / 100\ at store boundaries.

---

### [HIGH] "Distribute fully" cue banner missing when sum < \

**Tool**: hundred-dollar-test

**File**: src/app/(tools)/hundred-dollar-test/hundred-dollar-test-client.tsx:128-137

**Bug**: The banner only shows when total > \ and warns the user; it doesn't warn when total < \, leaving unallocated budget invisible.

**Evidence**:
\\\ ypescript
const Banner = () => {
const total = useStore(s => s.items.reduce((sum, i) => sum + i.budget, 0));
if (total > 100) return <div>Over budget!</div>;
if (total < 100) return null; // No warning for underfull budget
};
\\\

**Repro / impact**: User allocates \ and closes the tool; the unallocated \ is never noticed or redistributed.

**Fix idea**: Show "You have \ unallocated" banner whenever total < 100.

---

## hypothesis-tracker

### [MEDIUM] NaN-safe date calculations on survival curves

**Tool**: hypothesis-tracker

**File**: src/app/(tools)/hypothesis-tracker/hypothesis-tracker-client.tsx:302-306

**Bug**: Duration calculation assumes all dates are valid; if a start or end date is \
ull\ or \NaN\, the duration propagates as \NaN\ into the Kaplan-Meier curve.

**Evidence**:
\\\ ypescript
const duration = (item: Hypothesis) => {
const start = new Date(item.startDate).getTime();
const end = new Date(item.endDate ?? Date.now()).getTime();
return (end - start) / (1000 _ 60 _ 60 \* 24); // NaN if start or end is invalid
};
\\\

**Repro / impact**: A user enters an invalid start date (e.g., "not-a-date" string); the curve plots a point at \NaN\ days, breaking the visualization.

**Fix idea**: Guard with \if (!Number.isFinite(duration)) return null;\ and filter the data before charting.

---

## ice-score

### [HIGH] Input clamping to [1,10] happens at store time, not on input

**Tool**: ice-score

**File**: src/app/(tools)/ice-score/ice-score-client.tsx:42-47

**Bug**: The form allows entry outside [1,10], and clamping happens after submission, so the user doesn't know their input is out of bounds until after submitting.

**Evidence**:
\\\ ypescript
const handleScore = (feature: Feature, impact: number) => {
// No validation here; impact could be -5 or 50
store.addScore(feature.id, { impact }); // store clamps to [1, 10]
};
const clamped = Math.max(1, Math.min(10, impact)); // happens in store, not input
\\\

**Repro / impact**: User types "100" into an impact field, clicks Add, and the value silently becomes 10 without feedback.

**Fix idea**: Add \<input type="range" min="1" max="10">\ or validate \onBlur\ and show an error tooltip.

---

## icebreaker

### [HIGH] Single-item filter short-circuit returns stale filtered list

**Tool**: icebreaker

**File**: src/app/(tools)/icebreaker/icebreaker-client.tsx:328-337

**Bug**: The filter closure captures \ilters\ at render time; if \ilters.length === 1\, the closure is reused across renders without dependency update, returning a stale filtered list.

**Evidence**:
\\\ ypescript
const filtered = useMemo(() => {
if (filters.length === 1) {
// R5: Snapshot closure to prevent stale
const snapshot = [...items];
return snapshot.filter(i => i.type === filters[0].type);
}
return items.filter(matchesAny(filters));
}, [filters]); // if filters changes, closure is rebuilt, but snapshot is stale
\\\

**Repro / impact**: User adds a filter; the list correctly shows matching items. User adds another filter; the first filter's snapshot is still cached, and the list jumps back to old results.

**Fix idea**: Include \items\ in the dependency array: \[filters, items]\.

---

### [MEDIUM] Favorites migration from legacy key without version check

**Tool**: icebreaker

**File**: src/app/(tools)/icebreaker/icebreaker-client.tsx:38-46

**Bug**: On hydration, the code checks for a legacy \avorites\ key and migrates it, but doesn't verify the persisted data structure matches the expected shape.

**Evidence**:
\\\ ypescript
const migrate = (state: any) => {
if (localStorage.getItem('favorites')) {
try {
const legacy = JSON.parse(localStorage.getItem('favorites')!);
state.favorites = legacy; // assumes legacy is an array or object with the right shape
} catch {
// swallows parse errors
}
}
return state;
};
\\\

**Repro / impact**: An old localStorage entry has \avorites = "not-an-array"\; migration doesn't validate, and the store tries to iterate over a string.

**Fix idea**: Validate \Array.isArray(legacy)\ and all items match the expected schema before merging.

---

## impediments

### [CRITICAL] Dual-store bridge with window-scoped ownedIds survives StrictMode double-mount

**Tool**: impediments

**File**: src/app/(tools)/impediments/impediments-client.tsx:716-724

**Bug**: The bridge uses \window.**impediments_ownedIds\ to sync between two stores across mount/unmount cycles; if StrictMode double-mounts, the second mount re-initializes \window.**impediments_ownedIds\, losing the first mount's state.

**Evidence**:
\\\ ypescript
useEffect(() => {
if (!window.**impediments_ownedIds) {
window.**impediments_ownedIds = new Set();
}
return () => {
// In StrictMode, this cleanup runs, then mount runs again
// The Set is cleared, and data is lost
};
}, []);
\\\

**Repro / impact**: In development (with StrictMode enabled), the impediments list is populated, then briefly disappears as the cleanup unmounts the bridge, losing the ownedIds set.

**Fix idea**: Guard the cleanup with a flag to prevent double-cleanup: \if (window.\_\_impediments_ownedIds_initialized) return;\

---

### [HIGH] Weekly impediment series building doesn't handle cycle detection edge cases

**Tool**: impediments

**File**: src/app/(tools)/impediments/impediments-client.tsx:196-247

**Bug**: The cycle detection uses a visited set, but doesn't prevent self-cycles (item depends on itself) or transitive cycles (A → B → A).

**Evidence**:
\\\ ypescript
const hasCycle = (itemId: string, visited = new Set<string>()): boolean => {
if (visited.has(itemId)) return true; // only detects direct revisit
visited.add(itemId);
const deps = store.getDependencies(itemId);
return deps.some(d => hasCycle(d, visited));
// But doesn't validate that itemId is not in its own deps
};
\\\

**Repro / impact**: A user creates an impediment "Fix X" that depends on itself; the chart renders with a cycle, and the duration calculation produces \Infinity\.

**Fix idea**: Before accepting a dependency, check \if (newDep === itemId || wouldCreateCycle(itemId, newDep)) reject()\.

---

## incident-commander

### [CRITICAL] Kaplan-Meier survival curve only on resolved incidents, but missing caption guard

**Tool**: incident-commander

**File**: src/app/(tools)/incident-commander/incident-commander-client.tsx:310-320

**Bug**: The curve is computed only on resolved incidents, but if no incidents are resolved, the curve data is empty, and Recharts crashes when rendering an empty domain.

**Evidence**:
\\\ ypescript
const resolvedIncidents = useMemo(() => {
return incidents.filter(i => i.resolvedAt !== null);
}, [incidents]);

const curveData = useMemo(() => {
if (resolvedIncidents.length === 0) return []; // empty array
return computeKaplanMeier(resolvedIncidents);
}, [resolvedIncidents]);

<LineChart data={curveData}> {/_ crashes if curveData is empty _/}
\\\

**Repro / impact**: User has 10 unresolved incidents and no resolved incidents; the Kaplan-Meier section renders, but the LineChart throws "Cannot read property 'dataKey' of undefined".

**Fix idea**: Gate the chart render with \{curveData.length > 0 && <LineChart ... />}\ and show "No resolved incidents yet" placeholder.

---

### [MEDIUM] Right-censoring claim removed from caption without updating documentation

**Tool**: incident-commander

**File**: src/app/(tools)/incident-commander/incident-commander-client.tsx:570-575

**Bug**: The caption no longer mentions right-censoring of unresolved incidents, but the curve still applies it; readers assume all incidents are resolved.

**Evidence**:
\\\ ypescript
// Old caption: "Kaplan-Meier curve with right-censoring for unresolved incidents"
// New caption (lines 570-575):
const caption = "Probability of incident resolution over time";
// But the code still filters to resolved incidents and applies right-censoring
\\\

**Repro / impact**: A stakeholder reads the chart and assumes the curve includes all incidents; they misinterpret the survival probabilities.

**Fix idea**: Restore the caption to explicitly mention "includes X unresolved incidents as right-censored" or update the code to not censor.

---

## jtbd-mapper

### [CRITICAL] Parentage cycle detection missing ancestor check

**Tool**: jtbd-mapper

**File**: src/app/(tools)/jtbd-mapper/jtbd-mapper-client.tsx:146-175

**Bug**: The cycle detection prevents direct self-parents but allows ancestor-parent cycles (A → B → C → A), creating infinite loops in the tree traversal.

**Evidence**:
\\\ ypescript
const setParent = (itemId: string, parentId: string) => {
if (itemId === parentId) return; // guards self-parent
// But doesn't check if parentId is a descendant of itemId
store.setItem(itemId, { parent: parentId });
};

const getAncestors = (itemId: string): string[] => {
const parent = store.getItem(itemId)?.parent;
if (!parent) return [];
return [parent, ...getAncestors(parent)]; // infinite if cycle exists
};
\\\

**Repro / impact**: User sets Task A's parent to Task B, then Task B's parent to Task A; the tree view calls \getAncestors\ and hangs.

**Fix idea**: Before accepting a parent change, check \if (getAncestors(parentId).includes(itemId)) reject('Would create cycle')\.

---

### [HIGH] Cascade deletion of descendants without orphan handling

**Tool**: jtbd-mapper

**File**: src/app/(tools)/jtbd-mapper/jtbd-mapper-client.tsx:184-197

**Bug**: When deleting a parent item, all descendants are deleted; if a descendant was also the parent of another item, that orphan item loses its parent without reassignment.

**Evidence**:
\\\ ypescript
const deleteItem = (itemId: string) => {
const descendants = getDescendants(itemId);
descendants.forEach(d => store.deleteItem(d)); // cascades
store.deleteItem(itemId);
// But doesn't reassign orphan items whose parent was deleted
};
\\\

**Repro / impact**: User deletes Task A, which cascades to Task B (child of A); Task C (child of B) is also deleted even though the user only intended to delete A.

**Fix idea**: Before cascading, reassign orphans to the deleted item's parent: \orphans.forEach(o => store.setItem(o, { parent: deletedItem.parent }))\.

---

### [MEDIUM] Cyclic reference guard in render path doesn't memoize ancestor set

**Tool**: jtbd-mapper

**File**: src/app/(tools)/jtbd-mapper/jtbd-mapper-client.tsx:256-259

**Bug**: The render function calls \getAncestors\ on every render without memoization, causing O(n²) tree traversals.

**Evidence**:
\\\ ypescript
const Item = ({ itemId }: { itemId: string }) => {
const ancestors = getAncestors(itemId); // called every render
const isCyclic = ancestors.includes(itemId); // always false if check worked
return <div>{item.name}</div>;
};
\\\

**Repro / impact**: With 100 items, rendering the tree calls \getAncestors\ 100 times per render, each traversing up to 100 parents, totaling 10,000 operations per frame.

**Fix idea**: Memoize \ncestors\ with \useMemo(() => getAncestors(itemId), [itemId])\.

---

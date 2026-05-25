# Manual side-channel findings (2026-05-25)

Manual review running alongside the 12 audit agents. Captures findings the agents' narrower scopes wouldn't naturally surface.

---

## Confirmed bugs

### [Low-medium] icebreaker: `handleSpin` missing `selected?.id` dep makes the "don't redraw the same prompt" gate useless

- File: `src/app/(tools)/icebreaker/icebreaker-client.tsx:342, 367`
- What triggers it: User clicks "Spin" once. `selected` updates to item A (via setSelected during the spin loop). User clicks "Spin" again. The `handleSpin` callback was wrapped in `useCallback(..., [filtered, log])` so its identity didn't change when `selected` updated — the callback closes over the value of `selected` from the _first_ render (null on first mount, or the value from the last `[filtered, log]` change).
- What happens: `prevId = selected?.id` resolves to the stale value (often `null` on first mount). The `snapshot.length > 1 && prevId` gate is then false, so the "exclude the previously-drawn item" filter doesn't fire. The user sees the same prompt drawn back-to-back — exactly the UX the comment at lines 339–341 was trying to prevent.
- Suggested fix: Add `selected?.id` to the dep array of the `useCallback`. The lint warning (`react-hooks/exhaustive-deps`) already flags it correctly.

### [Low] release-planner: `updateConfig` / `updateConfigQuiet` re-created every render, defeating slider memoization

- File: `src/app/(tools)/release-planner/release-planner-client.tsx:265-268, 385-392`
- What triggers it: `updateConfigQuiet` and `updateConfig` are declared as plain function expressions inside the render body, so they get a new identity on every render. They're then used as the only dep of `useCallback(handleScopeAdjustment, [updateConfigQuiet])` and `useCallback(handleScopeAdjustmentCommit, [updateConfig])`. Because the dep identity changes every render, the `useCallback` cache is invalidated every render, and the slider-bound handlers are re-created every render too.
- What happens: Wasted re-renders on every parent re-render — every slider drag is a parent re-render, which now also re-creates the handlers, which may trigger any descendant `React.memo`'d slider to re-render. Not functionally broken (the comment-tagged history-spam fix from BUG_REPORT.md still works) but the memoization layer the author intended is silently no-op.
- Suggested fix: Wrap `updateConfigQuiet` and `updateConfig` in their own `useCallback`s with `[updateConfigRaw, log]` as deps. Lint warning at the same line confirms.

---

## Not bugs (lint false positives, behavior intentional)

- **The "unnecessary dependency: 'events'" lint pattern across 9 tools** (async-standup:248, dependency-map:261, pi-planning:214, sprint-compare:332, sprint-goal:281, sprint-review:1056/1066, standup:722, value-stream:167). The author subscribes to `events` via `useHistoryStore((s) => s.events)` and uses it as a cache-bust dep in a `useMemo` that calls `selectEvents(...)` (a non-hook selector that reads the same store). The lint rule doesn't see the read-through, but the dep is doing real cache-bust work — removing it would freeze the count at first render and break the entire intent of the comment block ("Subscribes to the history store's events array so external logging is picked up."). Architectural pattern, not a bug.

- **health-dashboard:824 `refreshKey` unnecessary dep**: same pattern — `refreshKey` increment is the manual cache-bust on the AI prompt config. Removing it would defeat the Refresh button.

- **tiptap-inline-editor:167 ref-cleanup warning**: `initialRef.current` is captured once on mount (a string) and never reassigned. Cleanup compares `latestRef.current === initialRef.current` (string equality of values, not ref identity), so the lint's "ref may have changed by cleanup" worry doesn't apply. Defensive intent is correctly implemented; the lint rule can't model `useRef(immutableScalar)`.

- **6 files with `as any`**: `gamification/opfs.ts` (3x — `createWritable` API is missing in older lib.dom.d.ts; legitimate type-system hole), `gamification/engine.ts` + `emotion/engine.ts` (window.bridge dev hooks, intentional), `health-dashboard-client.tsx` + `sprint-goal-client.tsx` + `tag-filter-row.tsx` — I read tag-filter-row.tsx top-to-bottom and found NO `as any` (grep false match). Worth a clean-up pass but not bugs.

---

## Observations / process

- The previous bug audit (`BUG_REPORT.md` dated 2026-05-24) was thorough but predates Phase 0-4. Anything the audit cleared in that file should be re-verified if the surrounding code changed.
- 9 of the 11 `events`-dep lint warnings are the SAME pattern. Worth a one-line `// eslint-disable-next-line react-hooks/exhaustive-deps` with a comment ("intentional cache-bust subscription") so future bug audits don't keep re-investigating.
- 90 vitest tests all pass; coverage is 45% statements / 49% branches. The uncovered area is heaviest in `lib/actions/server-store.ts` (5% — service-role MCP write path) and `lib/history/sync.ts` (4% — owner-side sync engine) — both surfaces where a regression has the highest blast radius.

# Shared Components Audit — agent summary (inline)

Note: agent returned summary inline rather than file:line snippets. Use as starting point; verify against current code before action.

## High

### [HIGH] Stale closure in insights-engine.tsx

**File**: src/components/shared/insights-engine.tsx
**Bug**: `dismissInsight` callback captures `dismissedIds` in closure; rapid calls may use stale state.
**Fix idea**: Use functional setState (`setDismissedIds(prev => ...)`).

### [HIGH] Race condition in ai-run-panel.tsx

**File**: src/components/shared/ai-run-panel.tsx
**Bug**: `withRetry` keeps `lastTokenCount` outside React state; multiple instances corrupt each other's token counts.
**Fix idea**: Move counter into `useRef` per-instance, or pass through args.

### [HIGH] Missing abort-signal check in agent-conversation.tsx

**File**: src/components/agent/agent-conversation.tsx
**Bug**: Streaming continues setState after abort signal fires; can run on unmounted component.
**Fix idea**: Check `signal.aborted` before each setState in stream callback.

## Medium

### [MEDIUM] Hydration mismatch risk in header.tsx

**File**: src/components/layout/header.tsx
**Bug**: Scroll listener uses RAF with class state; server renders scrollY===0, client may differ → flicker.
**Fix idea**: Defer `isScrolled` update until after mount with a `useEffect`.

### [MEDIUM] O(n) Date parsing in tool-history-drawer-content.tsx

**File**: src/components/history/tool-history-drawer-content.tsx
**Bug**: `timeAgo` runs per render per item; 500+ items + frequent updates = scroll jank.
**Fix idea**: Memoize per row, or compute on history-write only.

### [MEDIUM] Missing deps in sidebar.tsx click-outside/Escape handlers

**File**: src/components/layout/sidebar.tsx
**Bug**: `onClose` ref'd from closure; stale if parent doesn't re-render sidebar.
**Fix idea**: Wrap onClose in `useRef` updated on every render, read from ref inside handler.

### [MEDIUM] Unsafe localStorage access (Safari Private mode)

**Files**: src/components/shared/ai-run-panel.tsx, src/components/shared/workspace-sync-button.tsx
**Bug**: localStorage reads/writes not in try/catch — quota-exceeded throws → component crash.
**Fix idea**: Wrap all access in try/catch, or use existing `safe-storage` helper.

### [MEDIUM] Duplicate keys in trophy-case.tsx

**File**: src/components/gamification/trophy-case.tsx
**Bug**: `key={${e.at}-${i}}` — same timestamp + same index range collides → bad reconciliation.
**Fix idea**: Use a stable id, or nanoid-tag the event at insert time.

## Low

### [LOW] No memoization for kpi-grid responsive class

**File**: src/components/shared/kpi-grid.tsx
**Fix idea**: useMemo the class string.

### [LOW] Volume slider missing aria-label

**File**: src/components/shared/sonification-toggle.tsx:146
**Fix idea**: Add `aria-label="Volume"`.

### [LOW] Optional chain renders "undefined:" in trophy-case

**File**: src/components/gamification/trophy-case.tsx:350
**Bug**: `e.meta?.toolId` template literal — when meta exists but toolId missing, renders `undefined:`.
**Fix idea**: Short-circuit before rendering: `e.meta?.toolId ? `${e.meta.toolId}: ` : ''`.

### [LOW] Dynamic import without error boundary

**File**: src/components/shared/ai-prompt-drawer-content.tsx
**Bug**: Dynamic `AiRunPanel` import — chunk-load failure crashes drawer.
**Fix idea**: Wrap in `<ErrorBoundary>` with retry button.

## Architectural

### [LOW] Multiplayer-chip / workspace-sync split selectors

**Bug**: Two components read different Zustand selectors without coordination → momentary inconsistency.

### [MEDIUM] Cmd/Ctrl+J listener leak in agent-sheet.tsx:120

**Bug**: keydown listener not removed on unmount; remount → duplicate listeners.
**Fix idea**: Return cleanup function from the useEffect that registers the listener.

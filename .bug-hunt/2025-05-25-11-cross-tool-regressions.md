# Cross-tool regression scan (2026-05-25)

Scope: every consumer of the shared infrastructure that changed in Phases 0-4
(`use-room.ts`, `use-history-logger.ts`, `presence-identity.tsx`, the new
`GuestProfileProvider`, and `use-collaborative-session.ts`).

## Consumer inventory

Realtime room (`@/lib/realtime/use-room` -> `useRoom`):

- `src/lib/whiteboard/use-canvas-room.ts` (line 248) - explicit `validateState: false`, used by canvas.
- `src/app/(tools)/planning-poker/use-poker-session.ts` (line 49) - explicit `validateState: false`, used by both owner + guest poker.
- `src/lib/collab/use-collaborative-session.ts` (line 217) - default validator now rejects all peer state. Consumer never reads `room.state`, so neutral.

Realtime presence (`@/lib/realtime/use-presence` -> `usePresence`):

- No callers. Hook is orphaned (Grep finds no `usePresence(` call sites).

Canvas presence (`@/lib/whiteboard/use-canvas-presence` -> `useCanvasPresence`):

- `src/app/(tools)/canvas/components/whiteboard-canvas.tsx` (line 317).

PresenceIdentityProvider mount points:

- `src/app/(guest)/layout.tsx` (line 30).

GuestProfileProvider mount points:

- `src/app/(guest)/layout.tsx` (line 25).

useGuestProfile consumers:

- `src/lib/history/use-history-logger.ts` (line 70).
- `src/lib/collab/use-collaborative-session.ts` (line 93).

useHistoryLogger consumers (mounted in guest tree):

- `src/app/(tools)/planning-poker/session-screen.tsx:221` - reached from `(guest)/guest/planning-poker/[roomCode]/guest-poker-client.tsx`.
- `src/app/(tools)/canvas/components/whiteboard-canvas.tsx:246` - reached from `(guest)/guest/canvas/[boardId]/guest-canvas-client.tsx`.

useCollaborativeSession consumers:

- `src/app/(guest)/guest/[tool]/[entityId]/guest-tool-placeholder.tsx` (line 27).

`broadcastActivity` callers:

- `src/app/(tools)/canvas/components/whiteboard-canvas.tsx:337` (only canvas).

`subscribeToEvent` callers:

- `src/lib/whiteboard/use-canvas-room.ts` (lines 350, 384, 416, 448, 468).
- `src/app/(tools)/planning-poker/use-poker-session.ts` (line 77).
- `src/lib/collab/use-collaborative-session.ts` (line 228, re-exported).
- `src/app/(guest)/guest/[tool]/[entityId]/guest-tool-placeholder.tsx` (line 31).

useHistoryLogger consumers (owner-tree only - included for completeness): 100+ owner-side tool clients (kanban, retro, standup, etc.) — none mount in guest tree.

## Confirmed regressions

### [HIGH] Guest canvas presence always reports name "Anonymous"

- File: `src/app/(tools)/canvas/components/whiteboard-canvas.tsx:317`
- Caused by: Phase 2 (presence-identity / guest identity threading)
- What triggers it: any guest visiting `/guest/canvas/[boardId]`.
- What happens:
  `useCanvasPresence(channelName, { id: roomUserId })` passes ONLY the id. Inside
  `use-canvas-presence.ts:165` the hook falls back to `hint?.name ?? "Anonymous"` and
  `hint?.color ?? colorFor(name)`. So every guest broadcasts presence as "Anonymous"
  with the same derived color. Symptoms:
  1. Cursor labels for guests show "Anonymous" to the owner (and to each other).
  2. `WhiteboardCanvas.logActivity` (line 329) uses `self.name || "Anonymous"` as the
     `author` of activity events — owner's activity stream shows "Anonymous added 1
     sticky" regardless of which squad member did it.
  3. `broadcastActivity` fans this "Anonymous" author out so every peer's local
     `whiteboardActivityLog` (persisted to localStorage) is contaminated with the
     same misattribution.
     `PresenceIdentityProvider` only feeds `useRoom`; `useCanvasPresence` does not
     consult it.
- Suggested fix: either (a) make `useCanvasPresence` read
  `usePresenceIdentityOverride()` for default name/color (symmetric with `useRoom`),
  or (b) thread the full guest profile through `WhiteboardCanvas` and pass
  `{ id: roomUserId, name: profile.displayName, color: profile.color }` to
  `useCanvasPresence`. (a) is cleaner because it auto-applies to any future
  canvas-presence caller.

### [HIGH] Guest canvas activity log poisons local workspace store

- File: `src/app/(tools)/canvas/components/whiteboard-canvas.tsx:322-340`
- Caused by: Phase 3 (canvas squad-guest adoption)
- What triggers it: a guest editing the canvas on a shared browser.
- What happens: `logActivity` calls `appendActivity(event)` which writes to
  `whiteboardActivityLog` in the workspace store, and that slot is persisted to
  localStorage (workspace-store.ts:1382 in `partialize`, persisted via the
  `agile-toolkit:workspace` key). The guest tree mounts no `AuthProvider` /
  `HistorySyncProvider`, but the workspace store IS rehydrated by
  `guest-canvas-client.tsx:52`, so writes survive sign-out. After the guest leaves
  and the owner signs in on the same browser, the owner's canvas activity panel
  shows entries authored by "Anonymous" from the guest's session.
- Suggested fix: in guest mode, gate the local `appendActivity` so only
  `broadcastActivity` fires (owner is the one who persists the activity log to
  cloud). Alternative: `guest-canvas-client.tsx` clears `whiteboardActivityLog` on
  sign-out (mirrors the `agile-toolkit:user` sweep at `guest-home-client.tsx:69`).

### [HIGH] Cross-tool authorization leak in guest history logger

- File: `src/lib/history/use-history-logger.ts:115-127` + `src/app/api/guest/log/route.ts:80-160`
- Caused by: Phase 0 (history multi-author plumbing)
- What triggers it: a guest with an invite for tool A (e.g. `canvas`, role=editor) opens any other tool that calls `useHistoryLogger` (e.g. `planning-poker`, `standup` if it ever ships in the guest tree).
- What happens: the guest-mode POST body deliberately omits `entityId`. The endpoint
  then runs the squad-level fallback (route.ts:132-155): picks the most-privileged
  active invite IN THE SQUAD across ALL `tool_id`s, and accepts the write under that
  invite's `owner_id`. The action allowlist is per-role only, not per-tool — so an
  editor-on-canvas guest can write `vote_cast` rows under `tool_id=planning-poker`,
  `entry_added` rows under `tool_id=standup`, etc. Right now this is only reachable
  via the planning-poker session-screen (which is the only non-canvas guest path
  that mounts `useHistoryLogger`), but it widens every time a tool joins the guest
  tree without thinking about per-tool authz.
- Suggested fix: tighten the squad-level fallback to require the picked invite's
  `tool_id` to match the request's `toolId`, OR have `useHistoryLogger` thread
  `entityId` for guests when the calling component has one (Planning Poker's
  session-screen already knows the roomCode; canvas's whiteboard-canvas knows
  the boardId).

### [MEDIUM] guest-tool-placeholder re-subscribes its broadcast handler every render

- File: `src/app/(guest)/guest/[tool]/[entityId]/guest-tool-placeholder.tsx:30-37`
- Caused by: Phase 4 (planning poker adoption introduced the pattern, copied here)
- What triggers it: any parent re-render of the placeholder (state change, prop change).
- What happens: `useEffect(() => collab.subscribeToEvent(...), [collab])`. The
  `collab` object returned by `useCollaborativeSession` is a fresh literal on every
  render (no `useMemo`). The effect tears down + re-binds the listener every render.
  Pings that land inside the cleanup -> re-subscribe gap are silently lost; the
  re-subscription does NOT receive Supabase's buffer. Bandwidth-wasteful and racy.
- Suggested fix: destructure once -> `const { subscribeToEvent } = collab;` then dep
  on `[subscribeToEvent]` (which is a `useCallback` with `[]` deps inside `useRoom`
  and is identity-stable). Long-term: `useCollaborativeSession` should `useMemo` its
  return value.

### [MEDIUM] subscribeToEvent leaks per-channel listeners when last handler unsubscribes

- File: `src/lib/realtime/use-room.ts:179-215`
- Caused by: Phase 2 (Map fix in use-room)
- What triggers it: any consumer that dynamically subscribes / unsubscribes to
  varying event names (e.g. per-entity event channels like `"poker:state:${id}"`).
- What happens: `bindEventToChannel` adds the listener to `boundEventsRef` but the
  cleanup returned by `subscribeToEvent` only removes the handler from the Set; the
  `channel.on(...)` binding stays alive until the channel itself is torn down. When
  the last handler for an event is removed, the channel still pays the cost of
  dispatching that broadcast through the empty Set. Today's consumers use a fixed
  small set of event names so the leak is bounded; with any future use of dynamic
  event names it grows unbounded per channel.
- Suggested fix: when `handlers.size === 0` inside the unsubscribe cleanup, remove
  the binding via `channel.off` (or track the disposer returned by `channel.on` so
  the listener can be cleanly removed).

### [MEDIUM] use-room mid-session identity change is silently ignored by the live channel

- File: `src/lib/realtime/use-room.ts:217-310`
- Caused by: Phase 2 (presence-identity precedence ladder)
- What triggers it: a tree where `PresenceIdentityProvider`'s identity value
  changes after mount (e.g. a future "switch profile" flow inside the guest tree).
- What happens: the effect's deps are only `[toolId, roomId, isLocalOnly]`. The
  identity is captured into `me` at line 226 and stamped into the channel name
  (`presence: { key: me.id }`) at line 230. After the channel mounts, the
  per-render assignment `userRef.current = contextIdentity` updates the ref but
  the live channel keeps tracking the OLD id and presence-key. Outbound broadcasts
  call `roomRef.current.userId`/`channelRef.current.send(...)`, so the `by` field
  reflects the new identity while presence still reflects the old — peers see two
  identities for the same person (one in presence, one in patches). Not currently
  triggered (guest identity is fixed at sign-in) but a latent footgun.
- Suggested fix: include `userRef.current?.id` (or a stable identity selector) in
  the effect deps, OR document that identity must be set before the first render
  that supplies a non-null roomId.

## Dismissed (consumer is fine)

- All 100+ owner-side tools using `useHistoryLogger` (kanban, retro, standup,
  velocity, etc.): they mount only under `(tools)/` which renders inside
  AppShell + AuthProvider + GuestProfileProvider-absent. The logger correctly
  routes to the local store path. No regression.
- `usePokerSession`: explicitly passes `validateState: () => false` so the
  default-validator change is neutral. The host-side merge logic, ghost-cleanup
  and heartbeat are unchanged and depend only on `room.userId`/`room.members`
  semantics that survive the Phase 2 changes.
- `useCanvasRoom`: same — explicit `validateState: false`, all event flows go
  through the `whiteboard:*` channel with their own validators.
- `useCollaborativeSession`: calls `useRoom<unknown>` without a validator, but
  never reads `room.state`/`room.setState` — the silent rejection of peer state
  is intentional. Subscribers wire through `room.subscribeToEvent`/`broadcast`.
- `MultiplayerChip`: present in `src/components/shared/multiplayer-chip.tsx`
  but Grep finds zero callers. Dead code; not a regression vector for now.
- Sonification / haptics imports inside `session-screen.tsx`: `emit()` is a
  non-hook store-reader and silently no-ops if the provider isn't mounted, so
  guest tree calls are safe.
- `guest-canvas-client.tsx`: triggers `useWorkspaceStore.persist.rehydrate()`
  before mounting `WhiteboardCanvas`. Rehydration works because workspace-store
  doesn't depend on AuthProvider. Confirmed safe.

## Open questions

1. The squad-level fallback in `/api/guest/log` was clearly designed (the
   comments explain it), but a cross-tool authorization leak across `tool_id`s
   should at least be opt-in. Was that the intended design — or should the
   fallback require `request.toolId === picked_invite.tool_id`? Worth confirming
   before recommending the fix.
2. `useCanvasPresence` predates `PresenceIdentityProvider`. Should it be unified
   under the same context, or is the design intent to keep canvas presence
   independent (because it carries cursor/viewport state that doesn't apply to
   `useRoom`'s general consumers)? If unified, `usePresence` should also read
   the override so any future caller benefits.
3. The activity-log contamination on guest sign-out: should we clear ONLY the
   workspace-store `whiteboardActivityLog`, or the entire workspace state on
   guest sign-out? Today's `guest-home-client.tsx` only sweeps the
   `agile-toolkit:user` slot.

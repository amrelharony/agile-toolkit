# Collab + realtime audit (2026-05-25)

Scope: `src/lib/collab/use-collaborative-session.ts`, `src/lib/realtime/use-room.ts`,
`src/lib/realtime/use-presence.ts`, `src/lib/realtime/presence-identity.tsx`,
`src/lib/realtime/supabase-client.ts`, `src/lib/auth/guest-profile-provider.tsx`.
Also touched consumer paths in `whiteboard/use-canvas-room.ts`,
`(tools)/planning-poker/use-poker-session.ts`,
`(guest)/guest/[tool]/[entityId]/guest-tool-placeholder.tsx`, and
`(guest)/layout.tsx`.

Verified the Phase 2 commit claim: `use-room.ts:179-215` now binds
`channel.on("broadcast", { event }, …)` per event name via `bindEventToChannel`,
and the mount effect at lines 282-295 also iterates `eventHandlersRef.current`
when a new channel comes up. Pre-Phase-2 (commit `584c948`'s `use-room.ts`)
populated the Map but never iterated it — confirmed by `git show`. The fix is
real and the round-trip (subscribe before mount → effect rebinds; subscribe after
mount → immediate bind) is sound.

---

## Confirmed bugs

### [High] Owner-mode `useCollaborativeSession` never threads auth identity into `useRoom`

- File: `src/lib/collab/use-collaborative-session.ts:217`
- What triggers it: any owner who mounts `useCollaborativeSession` and inspects
  `members` (or whose peers do).
- What happens: `useRoom<unknown>(toolId, roomId, null)` is called with no
  `identity` option. In the owner tree there is also no
  `<PresenceIdentityProvider>` (grepped — only mounted in `(guest)/layout.tsx`),
  so `use-room.ts:151-152` falls through to `getOrCreateUser()`. That returns a
  `localStorage`-backed `Player NNN` nanoid identity. As a result, owner-side
  presence members carry the localStorage name and a hash-of-nanoid color,
  not the owner's `auth.profile.display_name` / `OWNER_COLOR`. The hook's
  `author` is computed correctly (line 102-125) but never wired through. The
  docstring explicitly promises "a uniform participants list and `attribute()`
  helper" — that's violated for owner mode.
- Suggested fix: pass `identity` to `useRoom` when in owner/guest mode, e.g.
  ```ts
  const room = useRoom<unknown>(toolId, roomId, null, {
    identity: author ? { id: author.id, name: author.displayName } : undefined,
  });
  ```
  Guest mode already works via `PresenceIdentityProvider`; this would also
  bring owner-mode in line and remove the silent `agile-toolkit:user`
  localStorage write on owner pages.

### [Medium] `useCollaborativeSession` returns a fresh object literal every render

- File: `src/lib/collab/use-collaborative-session.ts:221-231`
- What triggers it: any consumer that puts the returned `collab` value in a
  `useEffect` dep array. The Phase 2 placeholder
  `guest-tool-placeholder.tsx:30-37` already does so.
- What happens: the return object is constructed inline each render, so
  identity changes on every parent re-render. The placeholder's subscribe
  effect tears down and re-attaches `subscribeToEvent("guest-placeholder-ping",
…)` on each render — the underlying `eventHandlersRef` Set churns
  add → delete → add at render cadence. Functionally tolerated by the
  bindEventToChannel idempotency, but it's exactly the anti-pattern the
  surrounding code warns about (`use-canvas-room.ts:265-273`,
  `use-poker-session.ts:54-60`). When more tools adopt the framework this
  thrash compounds.
- Suggested fix: wrap the return in `useMemo` keyed on
  `[session, author, attribute, log, room.members, room.broadcast, room.subscribeToEvent, room.isConnected, room.isLocalOnly]`,
  or fix the placeholder's dep array to `[collab.subscribeToEvent]` and
  document the rule for future adopters.

### [Medium] `assignColor(me.id)` overrides the guest's chosen profile color in `useRoom` presence

- File: `src/lib/realtime/use-room.ts:301-306`
- What triggers it: any guest joins a room via `useRoom` (i.e.,
  `useCollaborativeSession` in guest mode; today the placeholder + poker).
- What happens: presence `track()` always sends `color: assignColor(me.id)`,
  which is a hash of the user id mapped onto the 8-entry `COLORS` palette.
  The guest's stored `squad_profiles.color` (selected during onboarding,
  rendered in their nameplate, etc.) is never broadcast. Peers' member lists
  show every guest in a palette-rotated color that doesn't match what the
  owner sees on the share modal or the guest sees in their own header.
  Canvas dodges this because it uses a separate `useCanvasPresence` channel
  with a richer color whitelist — poker / placeholder / future adopters do
  not.
- Suggested fix: let the caller supply a `color` override alongside
  `identity` (the option already exists conceptually), and pass it in
  `track()` instead of `assignColor(me.id)`. Validate it through
  `safeColor` widened to the same regex `use-presence.ts:147` uses (any
  `#rgb`/`#rrggbb(aa)`/`rgb()`/`rgba()`/`hsl()`/`hsla()` or short named
  color) rather than the 8-entry hard-coded `COLOR_SET`.

### [Medium] `useEffect` cleanup leaves stale `members` state when `roomId` flips to null

- File: `src/lib/realtime/use-room.ts:217-221`
- What triggers it: a consumer dynamically sets `roomId` to null (e.g.,
  user leaves the session, entity is deleted, route guard demounts the
  inner tree but parent still renders).
- What happens: the effect early-returns with only `setIsConnected(false)`.
  The previous effect's cleanup (lines 312-336) ran on the prior commit
  and DID call `setMembers([])`, so this is mostly fine — until you
  consider the very first mount where isLocalOnly is true (no cleanup
  attached) and subsequent transitions. The bigger issue is when
  `isLocalOnly` becomes true mid-session via env-var change in tests:
  members linger. Functional symptom is rare in prod but visible in dev
  HMR.
- Suggested fix: call `setMembers([])` in the early-return branch too,
  matching the cleanup symmetry.

### [Low] `subscribeToEvent` channel listener leaks when the last handler unsubscribes

- File: `src/lib/realtime/use-room.ts:199-215`
- What triggers it: any consumer calls `subscribeToEvent` then unsubscribes
  before the channel teardown.
- What happens: the returned `off()` only deletes the handler from the Set
  (line 211). The `boundEventsRef.current.has(event)` flag stays `true`, and
  the `channel.on("broadcast", { event }, …)` listener registered at line
  182 remains attached. It keeps receiving messages and early-returning at
  line 184. Wasted bandwidth (Supabase keeps shipping events for an event
  name no one listens to anymore) until the room is torn down. The leak is
  bounded — only one listener per event-name regardless of how many times
  it gets subscribed/unsubscribed — so this is housekeeping, not a memory
  bomb. Real cost is the receive-side decode + dispatch through an empty
  Set on every inbound packet.
- Suggested fix: in `off()`, if `handlers.size === 0`, clear that event
  from `eventHandlersRef.current` AND `boundEventsRef.current`, and call
  `channel.off("broadcast", { event })` (supabase-js does support per-event
  removal via the same filter object). Optional — depends on whether the
  hot path's empty-Set early return is cheap enough.

### [Low] Channel-name composition is `tool:${toolId}:room:${roomId}` with no escaping

- File: `src/lib/realtime/use-room.ts:228`
- What triggers it: a `toolId` or `roomId` that contains a colon. The
  `roomId` comes from `entityId` straight through
  `use-collaborative-session.ts:216-217` and is user-suppliable for some
  tools (poker uses a 4-character user-typed room code; canvas uses an
  internal nanoid).
- What happens: `tool:canvas:room:abc:def` and
  `tool:canvas:room:abc` followed by a separate room `def` are not
  obviously isomorphic, but Supabase channels keyed on the resulting
  string would collide if two different `(toolId, entityId)` pairs encode
  to the same channel name. Today's tool/entity inputs are tightly
  constrained (poker code regex, canvas nanoid, retro slug) so
  exploitation requires malice or future carelessness.
- Suggested fix: percent-encode (or stricter — reject) `:` inside the
  composed segments, or use a delimiter that can't appear in any valid
  id (e.g., `tool|${toolId}|room|${roomId}`). Matches the spirit of the
  hardened payload validators upstream.

### [Low] `Promise.resolve(channel.untrack())…removeChannel(channel)` cleanup is not actually chained

- File: `src/lib/realtime/use-room.ts:320-327` (mirrored in
  `use-presence.ts:254-257`).
- What triggers it: every channel teardown.
- What happens: the comment claims "chain untrack → unsubscribe →
  removeChannel" but the `removeChannel` call (line 324) runs
  synchronously, NOT awaiting the `.then(unsubscribe())` promise. In
  practice supabase-js's `removeChannel` itself calls `unsubscribe` and
  `untrack` is effectively fire-and-forget on the wire, so the LEAVE
  presence usually still goes out — but the documented invariant is
  not enforced by the code.
- Suggested fix: either drop the chain (and the misleading comment) or
  actually await the chain before calling `removeChannel`:
  ```ts
  void (async () => {
    try {
      await channel.untrack();
    } catch {}
    try {
      await channel.unsubscribe();
    } catch {}
    try {
      getSupabaseClient()?.removeChannel(channel);
    } catch {}
  })();
  ```

### [Low] `useEffect` channel-mount deps omit `user.id`

- File: `src/lib/realtime/use-room.ts:343`
- What triggers it: the consumer's identity (via `options.identity` or
  `PresenceIdentityProvider`) changes mid-mount. Today the providers
  treat identity as immutable, but a future flow that lets the user
  rename in-session would hit this.
- What happens: the channel keeps its old presence key (`config.presence
.key`, line 230) because the effect doesn't re-mount on identity
  change. The next `setState`/`broadcast` would carry the NEW
  `userRef.current.id` while inbound `state-sync`'s self-echo check at
  line 246 uses the OLD captured `me.id`. Echo suppression silently
  breaks for the user that renamed.
- Suggested fix: include `user.id` (or `user`) in the dep array, and
  accept the trade-off that identity changes re-mount the channel.

### [Low] `userRef` mutation during render

- File: `src/lib/realtime/use-room.ts:147-153`
- What triggers it: every render of any caller.
- What happens: the four-line precedence ladder writes to
  `userRef.current` during render. React's docs explicitly call this
  out as an anti-pattern (refs are for imperative state outside the
  render cycle); concurrent rendering or Suspense can cause a render to
  be discarded after the ref has been mutated, leaving a value the
  committed UI never saw. Today it's tolerated because the value is
  derived from already-resolved props/context, but it's still a hazard.
- Suggested fix: replace with a `useState`-with-lazy-init guarded by
  prior precedence checks, or move the ladder into a `useMemo` and keep
  the ref only for callback access. (`useState(() => identity ??
contextIdentity ?? getOrCreateUser())` plus `useEffect` to sync
  override changes is the canonical shape.)

---

## Dismissed / already defended

- **Subscribe-before-channel-mount fan-out** — verified: when subscribers
  register before the effect runs, the effect's `handlers.forEach
(bindEventToChannel)` loop (line 293) wires them; when they register
  after, the `if (channelRef.current)` branch (line 207) wires inline.
- **Phase-2 sync ref-init claim** — verified at
  `use-collaborative-session.ts:135-161` and `use-history-logger.ts:76-82`.
  The first `log()` call after a guest mount sees populated
  `guestClientIdRef` + `guestRunIdRef` because the writes happen in render,
  not in `useEffect`. StrictMode double-mount is safe because the
  second render finds the ref already populated and skips.
- **Self-echo via the default Supabase broadcast config** — no
  `config: { broadcast: { self: true } }` anywhere, so the placeholder's
  "no by-id filter" handler at `guest-tool-placeholder.tsx:31` doesn't
  echo to itself.
- **`localStorage` clobbering across owner / guest tabs** — guest tree
  mounts `PresenceIdentityProvider` so `useRoom` never falls into
  `getOrCreateUser()` (which is what writes `agile-toolkit:user`). Owner
  tree still writes that slot, but a guest tab on the same browser
  ignores it via the context override.
- **Hostile-peer XSS via presence `color`** — `safeColor` allowlists the 8
  COLORS palette before render in `use-room.ts:271`; richer canvas
  channel uses `COLOR_SAFE_RE` in `use-canvas-presence.ts:46`. Both
  block CSS-injection cookie exfil.
- **Reconnect double-fire of custom events** — `boundEventsRef` is
  cleared on teardown, `eventHandlersRef` is preserved, and the mount
  effect re-binds once per event. No duplicate registrations.
- **`channel.on()` after `channel.subscribe()` swallowing events** — the
  effect (line 236-295) wires every listener before `channel.subscribe`
  at line 297, including the dynamic `bindEventToChannel` loop at 293.
- **SSR safety for `crypto.randomUUID` / `localStorage`** —
  `getSupabaseClient`, `isRealtimeAvailable`, `getOrCreateUser`,
  `ensureGuestClientId`, and `usePresence`'s id generator all gate on
  `typeof window !== "undefined"` or `typeof crypto !== "undefined"`.
- **Guest mode log POST sending `entityId: ""`** — collab hook calls
  `useRoom(toolId, entityId || null, …)` and `/api/guest/log` validates
  `entityId.length >= 1`, so an empty string is treated identically to
  null (squad-scoped auth path).
- **Heartbeat in poker churning on parent re-render** — the heartbeat
  effect's deps are `[isHost, roomCode, room.isLocalOnly, room.isConnected]`,
  all primitives. `room` itself (a fresh object every render) is read
  through `roomRef.current`, so the `setInterval(HEARTBEAT_MS)` is not
  recreated on render storms.
- **Canvas drift-recovery thundering herd** — `DRIFT_REQUEST_JITTER_MS`
  randomises the request gap and `pendingDriftIds.delete(id)` cancels
  on observation of a peer's request first (`use-canvas-room.ts:401-423`).
- **`removeChannel` not freeing the channels[] map** — `getSupabaseClient
()?.removeChannel(channel)` runs in both `use-room.ts:324` and
  `use-presence.ts:257`.
- **Self-echo in canvas / poker** — both check `patch.by === me`
  / `env.by === userRef.current.userId` before applying.
- **Auth provider request-ordering** — `seqRef` guards out-of-order
  `applySession` replays (`auth-provider.tsx:42-43, 102-107`).

---

## Open questions

- Should `useCollaborativeSession` thread `auth.profile.color` for owner
  presence the same way the squad guest's `profile.color` should be
  threaded? Today there's no owner-side color stored at all (only
  `OWNER_COLOR = "#00f0ff"` hard-coded in
  `use-collaborative-session.ts:81`). If owner presence shows up as the
  cyan brand color but their auth profile carries a different display
  color elsewhere, that may be intentional.
- The `useCollaborativeSession` hook calls `useHistoryLogger(toolId)`
  regardless of mode (line 129). In guest mode the logger is wired but
  unused (collab's own POST path handles guest logging at line 184).
  Is that intentional duplication for future "owner-tools-call-
  useHistoryLogger-directly" parity, or should we skip the
  `useHistoryLogger` call entirely in guest mode? Today it's harmless
  (the guest branch of `useHistoryLogger` only fires when called) but
  it's an extra hook invocation per render.
- The `useCollaborativeSession` log path posts `entityId` as-is even
  when no `entityId` is in scope (e.g., a future tool that calls the
  hook for cross-tool logging). The route accepts that and falls into
  the squad-level path, but the hook's typing requires `entityId:
string` — there's no clear API for "log this without an entity".
  Worth aligning with how tools that don't have a per-entity surface
  (workspace-level dashboards) would adopt the framework.

# Canvas multiplayer audit (2026-05-25)

Scope: `src/lib/whiteboard/use-canvas-room.ts`, the `broadcastActivity` wiring in `src/app/(tools)/canvas/components/whiteboard-canvas.tsx`, `src/app/(tools)/canvas/components/share-modal.tsx`, `src/app/(guest)/guest/canvas/[boardId]/{page,guest-canvas-client}.tsx`. Cross-checked: `src/lib/whiteboard/use-canvas-presence.ts`, `src/lib/realtime/{use-room,presence-identity}.{ts,tsx}`, `src/lib/stores/workspace-store.ts:883`, `src/app/(guest)/layout.tsx`.

## Confirmed bugs

### [High] Activity author is permanently "Anonymous" — Phase 3 design intent never works

- File: `src/app/(tools)/canvas/components/whiteboard-canvas.tsx:317` (the call), `src/lib/whiteboard/use-canvas-presence.ts:165` (the fallback)
- What triggers it: Any local activity (`logActivity("added", ...)`) on the canvas, by either owner or guest.
- What happens: `WhiteboardCanvas` calls `useCanvasPresence(channelName, { id: roomUserId })` — passing only `id`, never `name`. Inside `useCanvasPresence`, line 165: `const name = hint?.name ?? "Anonymous";`. Because no name is forwarded, `self.name === "Anonymous"` for **every** caller (owner and guest). At line 329, `author: self.name || "Anonymous"` is therefore always `"Anonymous"`. `broadcastActivity` then ships `author: "Anonymous"` to peers. The owner's stated Phase 3 goal — "Alice added 1 sticky" appearing in their activity stream when a guest edits — never works; every line reads "Anonymous added X". `GuestCanvasClient` has `profile.displayName` in scope but never threads it to `WhiteboardCanvas` (the prop doesn't exist). Owner side has no name available there at all.
- Suggested fix: Thread the display name down. Either (a) accept a `presenceName?: string` prop on `WhiteboardCanvas` and pass it to `useCanvasPresence(channelName, { id: roomUserId, name: presenceName })`, populating from `profile.displayName` in `guest-canvas-client.tsx:137` and from `getOrCreateUser().name` (or a workspace setting) in owner-side `canvas-client.tsx`; or (b) extend `useCanvasPresence` to read `usePresenceIdentityOverride()` so the guest path picks up the layout-provided identity automatically, and have the owner client mount a `PresenceIdentityProvider` too. Once `self.name` carries the real name, the existing `author: self.name || "Anonymous"` line works.

### [Medium] No identity binding on `whiteboard:activity` — any editor (or any peer with devtools) can spoof the `author` field

- File: `src/lib/whiteboard/use-canvas-room.ts:199-214` (validator), `:468-474` (handler), `:550-558` (broadcaster)
- What triggers it: A peer (legitimate editor or a viewer/commenter bypassing the local `readOnly` gate via devtools) calls `room.broadcast("whiteboard:activity", { id, boardId, at, author: "Owner Bob", kind, summary })` with `author` set to any string.
- What happens: `isValidActivityEvent` checks only **lengths**, not identity. There is no `by` field on `WhiteboardActivityEvent`, no cross-check against `room.userId`, and no membership check against the presence channel. The receiver appends the event under the spoofed author. The legitimate "Owner Bob" sees `Owner Bob did X` in their own log — for an action they never took. Patches and heartbeats both carry a `by` field and the receiver skips `by === me` echoes; activity is the only multiplayer event in this file without that defence. Also note `broadcastActivity` itself doesn't re-stamp `author` from `roomRef.current.userId` — it just forwards whatever the caller passed, so even a non-hostile bug elsewhere can ship the wrong author.
- Suggested fix: Add a `by: string` field to `WhiteboardActivityEvent`. Have `broadcastActivity` overwrite `event.by = roomRef.current.userId` before sending (don't trust caller). Have the receiver derive the rendered author from `by` (resolve via presence members) OR at minimum reject events whose `by` doesn't appear in the current presence roster. The `readOnly` sender-side gate is necessary but not sufficient — receivers must enforce it too, since `readOnly` is a UI state any peer can flip.

### [Medium] Guest joining mid-session never receives prior activity history

- File: `src/lib/whiteboard/use-canvas-room.ts:455-474` and `src/app/(guest)/guest/canvas/[boardId]/guest-canvas-client.tsx:55-72`
- What triggers it: An owner has been editing a board for a while and has 50 activity log lines. They share with a guest; guest opens the board.
- What happens: Whiteboard objects eventually sync via the drift-recovery heartbeat (≤10 s, documented at `guest-canvas-client.tsx:23`). Activity, however, only fans out at the moment of creation. There is no snapshot/request mechanism for `whiteboardActivityLog` — no equivalent of `whiteboard:heartbeat` → `whiteboard:request` → bulk-reply pattern. The guest's local activity log starts empty and only fills with events broadcast after they joined. If the owner's `ActivityStream` panel is the way they see "Alice did X", the inverse case (guest sees what the owner did before they arrived) is silently broken. The class comment at line 460 only addresses the owner-sees-guest direction.
- Suggested fix: On `whiteboard:request`, when the responder is an editor and has activity log lines for this board, include a bounded slice (say last 50) of `whiteboardActivityLog` in the response. Receiver dedups by `id`. Or add a dedicated `whiteboard:activity-bootstrap` request/reply event that runs once per channel mount.

### [Medium] `whiteboard:activity` validator accepts arbitrarily-old timestamps and RTL/control characters in author

- File: `src/lib/whiteboard/use-canvas-room.ts:204-214`
- What triggers it: Hostile peer broadcasts an event with `at: 0` or `at: -1`, or with `author: "Bob‮ something"` (RTL override).
- What happens: Line 208 caps `at` from above (`> Date.now() + 5*60_000`) but has no lower bound — `at: 0` (1970) is accepted and lands in the log. Line 209 checks length but not character content; RTL overrides survive and render with flipped text on receivers' activity panels. `useCanvasPresence`'s sanitizer at `use-canvas-presence.ts:72` rejects RTL in presence names for exactly this reason, so the two surfaces are inconsistent. The store's `appendWhiteboardActivity` (workspace-store.ts:889-908) also has no RTL/timestamp-floor check.
- Suggested fix: Add `if (r.at < Date.now() - 24 * 60 * 60_000) return false;` (or whatever lower bound matches the activity log's retention) and `if (RTL_OVERRIDE_RE.test(r.author)) return false;` (mirror `use-canvas-presence.ts:72`). Apply the same to `summary` and `kind`. Mirror the same checks in `workspace-store.ts:appendWhiteboardActivity` so a buggy local AI prompt can't slip past either gate.

### [Low] `broadcastActivity` fires even when the local mutation that produced the activity didn't apply

- File: `src/app/(tools)/canvas/components/whiteboard-canvas.tsx:322-340`
- What triggers it: A caller does `upsertMany(objs); logActivity("added", "...");` but the `upsertMany` body rejects the objects (e.g. invalid via store-internal guards, or `objs.length === 0` after filtering).
- What happens: `logActivity` doesn't gate on whether the mutation succeeded. The append happens locally; the broadcast goes out. Peers see "Alice added 3 stickies" in their stream but no stickies appear (because no patch was generated). It is not catastrophic, but the activity stream drifts from the actual board state. Note: `WhiteboardCanvas` callsites all do this in the form `upsertMany(stickies); ...; logActivity(...)`, so any silent failure in `upsertMany` (e.g., the rolling cap rejecting the batch) decouples the two.
- Suggested fix: Either pass back a "did anything change" boolean from the mutation actions and gate `logActivity` on it, or accept the drift as documentation-level. The dedup window (event-id) on receivers handles the inverse case (event received twice), but no mechanism removes a phantom activity once broadcast.

### [Low] Dedup window for inbound `whiteboard:activity` is bounded by the rolling log, not by a dedicated window

- File: `src/lib/whiteboard/use-canvas-room.ts:471-473`
- What triggers it: A buffered/retransmitted broadcast arrives more than 200 board-events after its original delivery (only realistic if Supabase ever flips broadcast.self on, or implements offline replay; today this is hypothetical).
- What happens: The local log has rotated past the event's id, so `log.some(e => e.id === raw.id)` is false. The event is appended again. Dedup is "for as long as the entry is in the bounded rolling log" — not a dedicated dedup window. This is also `O(N)` per inbound event (currently small but worth noting). Comment at line 463-467 promises dedup against reconnect re-delivery; if Supabase ever buffers across long-lived reconnects (it currently doesn't), this would silently start letting duplicates through.
- Suggested fix: Maintain a small ring (Set bounded to, say, 500 most-recent ids) dedicated to dedup, sized independently of the visible activity log. Pop oldest when full. Also defends against the activity log itself being cleared by the user (`replaceWorkspace` / `resetWorkspace`) — today that would also clear the dedup state mid-session.

## Dismissed / already defended

### Self-echo on `whiteboard:activity`

- The handler at `:468-474` has no `by === me` check (the event has no `by` field), but the dedup-by-id at `:472` is reached **after** the sender already locally appended at `whiteboard-canvas.tsx:333`. Supabase Realtime defaults to `broadcast.self = false`, so under normal operation no echo arrives anyway. Defended (though see "no identity binding" above for the spoofing-from-other-peer concern, which is different).

### Self-echo prevention against owner/guest id collision

- Owner id is `nanoid(10)` from `getOrCreateUser()`. Guest id is a UUID from `session.profileId`. Different spaces; collision probability negligible.

### SSR safety of `use-canvas-room.ts`

- `requestAnimationFrame` is guarded (`:377`), `document` access is guarded (`:649,:663,:669`), `crypto.randomUUID` in id generator has a fallback (`whiteboard-canvas.tsx:104-112`), and the differ has no browser-only APIs. Hook compiles and runs under SSR fine.

### Diff-sync echo loop on inbound patch flush

- `differRef.current?.reset(merged)` runs BEFORE `upsertMany`/`removeMany` at `:345-347`, so the outbound subscriber sees zero delta on the post-merge state. Explicitly defended in the comment at `:339-345`.

### Diff-sync vs activity-broadcast race

- They are independent broadcasts on the same channel; the patch broadcast is throttled with `BROADCAST_MIN_GAP_MS=100`, activity is immediate. Both apply idempotently on the receiver; ordering doesn't matter for correctness. The receiver's activity dedup-by-id covers reordering.

### Board-switch latch on the outbound patch sender

- `currentBoardIdRef.current !== boardId` check at `:603` defends against a stale `pendingTimer` firing after board switch. Documented at `:597-603`.

### Subscription `Map` cleanup on board switch

- The effect at `:287-497` cleans up `offPatch / offHeartbeat / offRequest / offFocus / offActivity`, the drift timer, the pending rAF, and drains the inbound queue. The outer outbound-broadcast effect at `:585-625` cleans its own subscriber + timer. `useRoom`'s effect at `use-room.ts:312-336` tears down the channel and clears `boundEvents`. No leak.

### Permission gating on viewer / commenter for activity

- `broadcastActivity` at `:550-558` early-returns when `readOnly`. `broadcastFocus` (`:521`), the outbound patch effect (`:590`), heartbeat (`:645`), and drift-response (`:429`) all gate on `readOnly`. Viewers and commenters cannot broadcast activity events via the public API. (Devtools bypass is the separate "no identity binding" bug above.)

### Esc handler on share-modal `<select>` exemption

- `share-modal.tsx:75-81` adds `target.tagName === "SELECT"` to the form-control exemption list. Pressing Esc on an open `<select>` dropdown collapses the dropdown without closing the modal. Stable callback ref (`:56-59`) prevents stale-closure on `onClose`. Documented intent matches behaviour.

### Guest identity matches `resolveGuestInvite`'s profileId

- `(guest)/layout.tsx:31` mounts `PresenceIdentityProvider` with `id: profile.id` = `session.profileId`. `guest/canvas/[boardId]/page.tsx:35` passes the same `session.profileId` as `profile.id` to `GuestCanvasClient`. `useRoom` reads the context identity via `usePresenceIdentityOverride()` (`use-room.ts:146,149`). So `room.userId` matches the profileId used to resolve the invite — both layers agree on who the guest is.

### `boardId` URL parameter pollution of channel names

- The server page (`guest/canvas/[boardId]/page.tsx:22-30`) gates entry through `resolveGuestInvite({ entityId: params.boardId })`, which does an exact-match Postgres query. Malformed boardIds simply have no matching invite and 404. So channel names are only ever constructed from boardIds that exist as `session_invites.entity_id` values in the DB.

### Diff-sync patches racing activity broadcasts

- Both are independent. Order-of-arrival doesn't matter for correctness; the user-visible "sticky appears then activity line lands" vs reverse is cosmetic, and the standard callsite order (`upsertMany(...); logActivity(...);`) ships patch first by the time the activity broadcast is enqueued.

## Open questions

1. **Owner-side identity threading.** The owner's `canvas-client.tsx` does not mount a `PresenceIdentityProvider`, so the room identity comes from `getOrCreateUser()` (localStorage, name = `"Player NNN"`). Should the owner's actual workspace `teamName` / signed-in user name flow into the presence identity? Today the owner is "Player 423" in their own activity log too. That's a Phase-3-adjacent (not Phase-3-introduced) issue but it interacts with the headline bug above.
2. **Guest viewing activity stream.** `ActivityStream` is mounted only in the owner-side `canvas-client.tsx`; the guest doesn't see it (see `guest-canvas-client.tsx:88-148` — no `ActivityStream`). If guests are never meant to see the activity stream, then the "guest joining mid-session never receives prior activity" finding above downgrades to cosmetic. Worth confirming the design intent: is the activity stream owner-only or shared?
3. **`canComment` activity emission.** A commenter dropping a comment thread (`use-canvas-pointer-machine.ts:404-411`) doesn't currently call `logActivity` — no "Bob commented" line. Probably an oversight; worth confirming intentional vs missed.
4. **StrictMode double-mount of Supabase channels.** The `untrack → unsubscribe → removeChannel` chain in `use-room.ts:320-327` is async; in React 18 StrictMode the second mount can start subscribing before the first channel's removal lands. This is pre-existing and out of Phase 3 scope, but worth flagging because the channel name `tool:canvas:room:${boardId}` is the same across mounts and Supabase v2's de-dupe behaviour here isn't documented.

# Kudos Phase 0-2 audit (2026-05-25)

Audit covers commits fb2bb11 (Phase 0), 91018a9 (Phase 1), d92f855 (Phase 2). Read-only — no edits made. Phase 3/4/5 work is in progress in the working tree and was not touched.

## Confirmed bugs

### [High] Built-in theme strings stored & returned as `{id: "awesome"}` objects, breaking round-trip

- File: `src/app/api/kudos/route.ts:32` (POST), `src/app/api/guest/kudos/route.ts:93` (POST), `src/app/api/kudos/route.ts:162-165` (GET)
- Trigger: any kudos with a built-in `theme: "awesome"` (the seven catalog ids — the common case). On POST, `kudosToRow` wraps the string as `{id: "awesome"}` because the DB column is jsonb; on GET, the response returns the row's `theme` field verbatim as `r.theme as unknown`. The returned object is `{id: "awesome"}` with no `title/emoji/hex`.
- Effect:
  1. A cross-device boot that hydrates from `GET /api/kudos` will receive theme objects that fail `parseKudos` (no `title/emoji/hex` → `parseCustomTheme` returns null → `invalid_theme`). Those rows can never re-enter the workspace store cleanly.
  2. `getKudosTheme` (kudos/types.ts:109-124) falls through to the custom-theme branch and renders `hex: undefined`, `headerBg: ""` — broken visual.
  3. Even before any cross-device fetch, the cloud-sync POST → DB cycle silently mutates the persisted shape of every owner-authored kudos.
- Suggested fix: in `kudosToRow`, store the bare string when theme is a built-in (`theme: k.theme` regardless of type), or unwrap on GET (`theme: typeof r.theme === "object" && r.theme && Object.keys(r.theme).length === 1 ? r.theme.id : r.theme`). Pick one and apply symmetrically. Migration 0016 line 40 already declares `theme jsonb` so storing as a bare JSON string `"awesome"` is legal.

### [High] BroadcastChannel cross-tab dedup never broadcasts — receive-only

- File: `src/lib/kudos/cloud-sync.ts:176-205`
- Trigger: two tabs open on the owner side. The `BroadcastChannel("agile-toolkit:kudos:cloud-sync")` listens on line 178-184 and deletes from the pending queue on incoming id. The comment on line 201-203 explicitly says "Tell sibling tabs about every successful drain" — but there is NO `broadcastChannel.postMessage(id)` anywhere in the file. The "tell sibling tabs" path is never executed.
- Effect: every tab that has the same kudos in its pending queue will POST it. The server upsert is idempotent (`onConflict: "id"`) so no data corruption, but: (1) duplicate POSTs hit the rate-limit faster on a workspace with N tabs open, (2) the documented dedup behaviour is a lie, (3) the dedup path is exercised in no test because the producer is missing — anything that codifies this protocol will silently break.
- Suggested fix: after `pending.delete(post.kudos.id)` on line 131, call `broadcastChannel?.postMessage(post.kudos.id)`.

### [High] Owner gets double XP (sent + received) for every kudos they send

- File: `src/lib/signals/signal-bridge.ts:559-563`, `src/lib/kudos/receive-bridge.ts:35-45`, `src/app/(tools)/kudos/kudos-client.tsx:191`
- Trigger: owner sends a kudos. The sender path calls `emit("kudos","sent")` → gamification awards 25 XP (engine.ts:222). Then `upsertKudos` adds to workspace store → signal-bridge diff fires both `kudos.sent` AND `kudos.received` (the `localViewerProfileId === null ? !k.toProfileId` branch matches any owner-untargeted kudos, which is every owner-authored card without a squad recipient). The `receive-bridge` subscribes to `kudos.received` and calls `emit("kudos","received")` → gamification awards another 15 XP (engine.ts:223).
- Effect: every owner kudos with no `toProfileId` yields 25+15 = 40 XP for the sender. The `receiver-10` achievement (10 received) unlocks just from sending your own kudos.
- Suggested fix: in `signal-bridge.ts:559-563`, change the owner-mode branch to require recipient ≠ sender, e.g. `localViewerProfileId === null ? (!k.toProfileId && k.fromProfileId !== undefined) : k.toProfileId === localViewerProfileId`. Or just don't auto-mark owner-untargeted kudos as received-by-owner. The current logic is misnamed — "owner self-receives every workspace-wide kudos" only makes sense for KUDOS THE OWNER DIDN'T SEND.

### [High] `setLocalViewerProfileId` is dead code on guest pages (intended-but-not-wired)

- File: `src/lib/auth/guest-profile-provider.tsx:47-50`, `src/lib/signals/signal-bridge.ts:18-21`, `src/components/layout/app-shell.tsx:109`
- Trigger: any guest opens `/guest/kudos/[entityId]`. The `GuestProfileProvider` calls `setLocalViewerProfileId(profile.id)` on mount. But `installSignalBridge()` is only called from `app-shell.tsx`, which is skipped for guest routes (per the comment in (guest)/layout.tsx, "AppShell ... skips its sidebar/header/providers"). Guest pages also don't run `upsertKudos` (the realtime hook uses `setEphemeralKudos`, not workspace-store), so even if the bridge ran, the diff would never fire on guest activity.
- Effect:
  1. `kudos.received` (and therefore receiver XP) never fires for guests. The receive-bridge documents "subscribes to ... `kudos.received` ... emit("kudos","received")" but on guest tabs this signal never fires.
  2. The `setLocalViewerProfileId` effect is dead code on every guest page — it mutates module state in `signal-bridge.ts` that nobody reads.
  3. `kudos.received` does fire on the owner side, but with the `localViewerProfileId === null` owner-mode branch (which has the double-XP bug above), not with the intended guest-targeted branch.
- Suggested fix: either (a) install a lightweight signal bridge on guest pages too that diffs `useKudosRoom`'s ephemeral list and fires `kudos.received` when `toProfileId === setLocalViewerProfileId`'s value, or (b) remove the `setLocalViewerProfileId` effect from `GuestProfileProvider` and fix the comment claim that "the bridge needs to know the local viewer's profile id".

### [High] `/api/guest/kudos` route is unreachable — guest client never POSTs

- File: `src/app/api/guest/kudos/route.ts:28-121`, `src/app/(guest)/guest/kudos/[entityId]/guest-kudos-client.tsx:116-130`, `src/app/(tools)/kudos/use-kudos-room.ts:193-203`
- Trigger: guest submits a kudos. `handleSubmit` calls `room.sendKudos(kudos)`. `sendKudos` for `persistence === "ephemeral"` (guest mode, line 201) does `setEphemeralKudos` + realtime broadcast. There is no `fetch("/api/guest/kudos", ...)` anywhere in the codebase (verified by grep across `src/`).
- Effect: kudos sent by guests are NEVER written to the cloud. They live only in the guest's `useState` and the realtime ephemeral broadcast. If the owner is offline at the moment of send, the kudos is lost. The route handler — fairness window, RLS bypass, parse, rate limit, invite check — is dead code currently. Worse, when the owner IS online, the owner's `upsertKudos` writes the row to the owner's workspace store, signal-bridge fires `kudos.sent`, and cloud-sync POSTs `/api/kudos` with `kudosToRow` setting `squad_id: null` and `from_profile_id: <guest's id>` — so the row lands with the GUEST's profile id but `squad_id: null`, losing the squad context that the `/api/guest/kudos` path would have preserved.
- Suggested fix: either wire the guest client to POST `/api/guest/kudos` (so squad context lands in DB before the realtime echo) or delete the route and the dead comment in `cloud-sync.ts:19` claiming guests use it.

### [Medium] Parser accepts empty string `toProfileId` / `fromProfileId` / `teamName`

- File: `src/lib/kudos/parse.ts:176-185`, `parse.ts:186-189`
- Trigger: a tampered payload sets `"toProfileId": ""` or `"fromProfileId": ""`. The check is `typeof === "string"` and `length > ID_MAX`. Empty string passes (length === 0 is not blocked, unlike `id`/`replyTo`/`message` which DO block length 0).
- Effect: (1) signal-bridge's "addressed to me" check `k.toProfileId === localViewerProfileId` could match if the viewer's id is "" (defensive concern). (2) The DB column is `uuid` — `kudosToRow` line 34/36 passes `k.toProfileId ?? null`, so `""` lands as `""`, which the uuid cast rejects → 500 from the POST handler with a server-error log. The error message includes "" in plain text. (3) the history-log entry stored via `log(KUDOS_ACTIONS.KUDOS_SENT, { toProfileId: ""})` is meaningless data.
- Suggested fix: add `|| raw.toProfileId.length === 0` to the rejection condition (treat empty exactly like undefined-missing). Same for `fromProfileId`, `teamName`.

### [Medium] Fairness trigger blocks back-fill / re-upsert of an existing maxed-out pair

- File: `supabase/migrations/0016_kudos_table.sql:221-256`, `src/lib/kudos/cloud-sync.ts:83`, `src/lib/kudos/backfill.ts:29-35`
- Trigger: a (sender, recipient) pair already has 5 kudos in the last 24h. The owner refreshes a tab triggering backfill, OR cloud-sync re-attempts an existing row after a network blip. The POST uses `upsert(row, { onConflict: "id" })` which Postgres handles as `INSERT ... ON CONFLICT DO UPDATE`. The BEFORE INSERT trigger fires UNCONDITIONALLY before the conflict resolution, sees ≥ 5 rows in the window (including the row currently being upserted), and raises `kudos.fairness_window_exceeded`.
- Effect: backfill drops the row silently (`postOne` returns false; backfill ignores the boolean — line 64-65). Cloud-sync interprets the 429 (POST returns 429 on this error per route.ts:88-89) as `retry`, retries with backoff up to `MAX_ATTEMPTS=4`, then drops with a console.warn. The row stays orphaned in the workspace store but never reaches the cloud. Next refresh resets `attempt` to 1 (rehydrate sets `attempt: 1` on line 83 of cloud-sync.ts), so it'll retry indefinitely, never succeed, every login.
- Suggested fix: scope the trigger to only count rows where `id <> new.id` — or skip the trigger when this is an upsert (`tg_op = 'INSERT' AND NOT EXISTS (SELECT 1 FROM kudos WHERE id = new.id)`). Postgres doesn't expose "is this insert resolving as update" cleanly inside BEFORE INSERT; a stronger fix is to subtract one when `new.id` is already present.

### [Medium] Cloud-sync rehydrate resets `attempt` to 1 on every page load

- File: `src/lib/kudos/cloud-sync.ts:80-84`
- Trigger: a row gets dropped after `MAX_ATTEMPTS` attempts; the queue is persisted to localStorage each tick. Page reload → `rehydrate()` re-reads from localStorage and seeds every entry with `attempt: 1, notBefore: now`.
- Effect: a row whose POST consistently fails (e.g. validation error that returns a non-4xx-non-429 status, or the fairness-trigger issue above) is retried fresh on every reload. The `MAX_ATTEMPTS` ceiling is meaningless across reloads. Over time the localStorage entry grows monotonically with rows that will never succeed. Each reload also re-fires the entire retry budget against the API.
- Suggested fix: persist `attempt` and `notBefore` alongside `kudos`, or stamp a deadline and drop on rehydrate when expired. Or store rows that have been "given up on" in a separate dead-letter slot.

### [Medium] `/api/guest/kudos` allows cross-squad recipient targeting

- File: `src/app/api/guest/kudos/route.ts:95`
- Trigger: a guest in squad A submits a kudos with `toProfileId` pointing to a squad_profile in squad B (any squad — they can guess UUIDs, but more realistically they query their own squad and then swap the id). The route validates the GUEST identity (line 70-78 enforces invite for kudos+workspace) and replaces `from_profile_id` with the cookie's id (line 97) — but does NOT validate that `to_profile_id` belongs to the same squad as `session.squadId`.
- Effect: cross-squad targeting: a guest in squad A can send a kudos addressed to a member of squad B (different owner if the owner has multiple squads). DB FK ensures the profile exists; nothing checks it's in the right squad. If the owner runs multiple squads, internal members can be referenced by guests from other squads.
- Suggested fix: before insert, query `squad_profiles` and ensure `squad_id = session.squadId` for the supplied `to_profile_id`. Reject with 403/400 otherwise.

### [Medium] Cloud-sync POST stampede on every peer that receives a broadcast

- File: `src/lib/signals/signal-bridge.ts:551-572`, `src/lib/kudos/cloud-sync.ts:187-197`
- Trigger: guest A sends a kudos via realtime to owner. Owner's `useKudosRoom` calls `upsertOwnerKudos` (workspace store). Signal-bridge diff sees a new row and fires `kudos.sent`. Cloud-sync subscribes and POSTs `/api/kudos`. Now imagine two owner tabs open: both upsert (storage sync), both fire `kudos.sent`, both POST. The DB upsert is idempotent so no corruption, but each tab's pending queue stores it, retries on backoff, etc. Also the fairness-trigger problem (Medium #2 above) gets hit twice per send.
- Effect: 2 × N redundant POSTs for N tabs. Combined with the broken cross-tab dedup (High #2), the fan-out compounds.
- Suggested fix: same fix as the cross-tab dedup — once the POST succeeds, broadcast the id so siblings drop their copy.

### [Low] `kudos_select_squad_member` policy is permanently dead but burns RLS planner cycles

- File: `supabase/migrations/0016_kudos_table.sql:145-160`
- Trigger: every SELECT on `public.kudos` by an authenticated user. Postgres evaluates both `kudos_select_owner` and `kudos_select_squad_member` and OR's them (RLS for `select`). The squad-member policy contains `and false` on line 158 making it never match.
- Effect: minor planner overhead per query. More importantly, the policy is misleading — a maintainer adding multi-tenant support might think this policy "already works"; in reality it's a placeholder.
- Suggested fix: drop the policy and add a comment explaining future multi-tenant intent. Or make the placeholder more obvious (e.g. `using (false)` standalone, with a comment).

### [Low] Stale comments / dead-code housekeeping

- File: `src/lib/kudos/cloud-sync.ts:18-21` — claims guest writes go through `/api/guest/kudos` (they don't; see High #5).
- File: `src/lib/auth/guest-profile-provider.tsx:41-46` — describes a mechanism (`localViewerProfileId` informing signal-bridge) that doesn't run on guest pages (see High #4).
- File: `src/app/api/kudos/[id]/reactions/route.ts:11-15` — claims "the RPC tolerates any uuid that satisfies its type check" — accurate, but read together with parse.ts:125-126 (which allows any 1-64 char string as `byProfileId`), there's an impedance mismatch: parser accepts a non-UUID string, but the RPC requires uuid. A reaction posted with a guest-profile-id formatted as not-a-uuid would fail at the RPC. Guests don't reach the RPC currently (it's owner-only and a guest reaction route doesn't exist yet), so this is dormant.

### [Low] GET /api/kudos pagination cursor uses `sent_at` only — duplicate-timestamp boundary

- File: `src/app/api/kudos/route.ts:132-141`
- Trigger: two kudos rows have identical `sent_at` (clock granularity = ms; collision possible if two peers send within the same ms). The cursor `before=<sent_at>` returns rows strictly `<`, so two rows with the same `sent_at` are both either included or excluded from consecutive pages depending on which side of the cursor the user lands.
- Effect: a row at the exact page boundary either repeats (if the previous page's last row had the same `sent_at` as the new page's first row, the duplicate appears) or is dropped entirely.
- Suggested fix: add a secondary cursor on `id` (lexicographic tiebreak), or paginate on a composite `(sent_at, id)` key.

## Defended / not bugs

- **parseKudos version stamping** is correct — `inputVersion === undefined` correctly maps to "upgraded" and `sawV2Field` correctly tracks v2-field presence (custom-theme too, line 195). Verified all 7 v2 fields flip `sawV2Field`.
- **Custom theme id regex `^[a-z0-9-]{1,32}$`** is conservative; doesn't allow path traversal, NUL bytes, prototype keys.
- **Emoji codepoint cap** uses `Array.from(s).length` to correctly count code points for ZWJ sequences (line 56-61).
- **Far-future `sentAt` rejection** (line 174) correctly bounds backdate attacks while allowing past rows.
- **Signal-bus rAF flush** snapshots queue + listeners before iterating (signal-bus.ts:172-177); re-entrant emits queue cleanly into next frame, and unsubscribes during dispatch don't tear the iteration.
- **`upsertKudos` dedup-by-id** replaces in place (workspace-store.ts:933-939) and writes the parsed-and-upgraded shape back, so v1 rows mature to v2-stamped on re-broadcast.
- **JSON-import path** (workspace-store.ts:1101-1112) routes through `parseKudos` and slices to 500 — symmetric with the live upsert.
- **Rate limit per-profile in `consumeGuestRateToken`** (line 38, \_rate-limit.ts) — single bucket per profile id covers the kudos route correctly; instance-local caveat is documented.
- **RPC `kudos_add_reaction`** is correctly SECURITY DEFINER with `set search_path = public`; the `for update` lock on line 294 prevents concurrent appends from racing the cap check; idempotency check on line 308-313 is correct.
- **Migration idempotency**: `create table if not exists` + `drop policy if exists` + `create or replace function` + `drop trigger if exists` covers re-runs cleanly.
- **`KUDOS_ACTIONS.KUDOS_SENT`** correctly added to the `MILESTONE_PAIRS` set (event-actions.ts:973). Other three actions intentionally non-milestone.
- **`ALL_SIGNAL_KINDS` sync with `SignalKind` union** — all 5 kudos kinds present and INVALIDATION_MATRIX has entries for each.
- **GET `/api/kudos` UUID validation on `to_profile_id`** (route.ts:144) prevents arbitrary string injection.

## Open questions

- Was the intent for guest pages to install the signal-bridge (so guest receivers get receive XP) and for guests to POST `/api/guest/kudos` (so the server is the source of truth)? Confirming this directs the fix for High #4 and High #5.
- Should owners get XP for sending kudos to themselves at all? Currently the receive-bridge implies yes (the broken double-attribution path); a stricter rule (no self-XP) is also defensible.
- Should the fairness trigger ignore `upsert` re-inserts of an already-present row id? This is the cleanest fix for Medium #2 but adds a subquery to every BEFORE INSERT.

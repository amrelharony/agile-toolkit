# Agile Toolkit — Deep Bug Audit Report

> **Round 4 (2026-07-27) is appended at the bottom of this file.** 33 fixes.
> The report below is round 3 and is kept verbatim — its "Verified FALSE"
> table is still the authoritative do-not-re-litigate list.

**Date:** 2026-05-24
**Scope:** 109 tools + shared lib + shared components + API/auth/MCP + middleware + RLS migrations + CSP
**Method:** 10 parallel Explore agents → manual verification of every cited file:line → targeted fixes.

## TL;DR

- Baseline was clean (typecheck + 44/44 vitest + green production build) and still is.
- **5 real bugs fixed** (2 auth-critical + 3 API hardening + 4 tool fixes, in one commit-able patch).
- **+8 vitest cases** locking the auth fixes (now 52/52).
- **The vast majority of agent-reported "Critical" and "High" findings were false positives** — code that was already defended (often with an inline comment documenting the prior fix) or hallucinated snippets that didn't match the file.

If you skim only one section, read **"What I changed"** below.

---

## What I changed (the actual diff)

### Auth — verified and fixed

- [src/lib/auth/require-user.ts](src/lib/auth/require-user.ts:83) — provider check now rejects `undefined` (was passing silently); identities-empty path now requires `email_confirmed_at` (was permissive).
- [test/auth/require-user.test.ts](test/auth/require-user.test.ts) — new file, 8 cases covering: undefined provider, non-Google provider, empty identities w/ no `email_confirmed_at`, empty identities w/ `email_confirmed_at` set, matched-identity `email_verified === false`, identity-not-matching-this-email, happy path, email-not-on-allowlist.

### API hardening — verified and fixed

- [src/app/api/mcp/route.ts](src/app/api/mcp/route.ts:126) — 1 MiB body-size guard (returns 413 on oversize).
- [src/app/api/access-tokens/route.ts](src/app/api/access-tokens/route.ts:52) — default 90-day `expires_at` when caller doesn't pass one (was forever).
- [src/app/api/access-tokens/route.ts:27](src/app/api/access-tokens/route.ts:27) + [POST:74](src/app/api/access-tokens/route.ts:74) + [[id]/route.ts:27,41](src/app/api/access-tokens/[id]/route.ts:27) — server-log Supabase errors, return generic `server_error` to client (no schema leak).

### Tool bugs — verified and fixed

- [src/app/(tools)/release-planner/release-planner-client.tsx](<src/app/(tools)/release-planner/release-planner-client.tsx:494>) — three numeric inputs (backlog, scopeBuffer, sprintLengthDays) were firing `RELEASE_UPDATED` history events per keystroke. Re-wired to `updateConfigQuiet` on `onChange` + logged `updateConfig` on `onBlur`. (Infrastructure was already in place — just the inputs hadn't been wired through.)
- [src/app/(tools)/wsjf/wsjf-client.tsx](<src/app/(tools)/wsjf/wsjf-client.tsx:68>) and [weighted-decision-client.tsx](<src/app/(tools)/weighted-decision/weighted-decision-client.tsx:119>) — rank-prefix label truncation. Truncate title to 14 chars _before_ prepending `#N. ` so the rank stays inside the YAxis tick width.
- [src/app/(tools)/onboarding-tracker/onboarding-tracker-client.tsx](<src/app/(tools)/onboarding-tracker/onboarding-tracker-client.tsx:106>) — `isAtRisk` now guards `targetDays <= 0` early (was instant-firing "at risk" with target=0).

---

## Verification grid — agent claims vs reality

The audit fired 10 parallel Explore agents producing ~150 raw findings. Below is the verified outcome for the loudest ("Critical/High") ones. I re-read each cited file before keeping or rejecting.

### Verified TRUE (fixed above)

| Claim                                         | File                                                            | Action                                       |
| --------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Provider check passes when undefined          | `src/lib/auth/require-user.ts:84`                               | Fixed: drop `!== undefined`                  |
| identities=[] skips email_verified            | `src/lib/auth/require-user.ts:94-101`                           | Fixed: require `email_confirmed_at` as floor |
| MCP body has no size limit                    | `src/app/api/mcp/route.ts:127`                                  | Fixed: 1 MiB cap, 413                        |
| Token expires_at defaults to null             | `src/app/api/access-tokens/route.ts:52`                         | Fixed: 90-day default                        |
| Supabase error echoed to client               | `src/app/api/access-tokens/route.ts:27,75; [id]/route.ts:27,41` | Fixed: generic error, log server-side        |
| Release-planner keystroke-spams history       | `release-planner-client.tsx:494-535`                            | Fixed: quiet/blur split                      |
| WSJF/weighted-decision label truncation       | `wsjf-client.tsx:68`, `weighted-decision-client.tsx:119`        | Fixed: truncate before prefix                |
| onboarding-tracker `isAtRisk` w/ targetDays=0 | `onboarding-tracker-client.tsx:106`                             | Fixed: early-return                          |

### Verified FALSE (agent hallucinated or the fix was already in place)

| Claim                                                   | Reality                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Cross-correlation NaN tie-break crashes                 | `src/lib/analytics/cross-correlation.ts:45` already filters NaN AND checks `defined.length === 0` |
| Mann-Kendall variance integer overflow at n>5000        | `n*(n-1)*(2n+5)/18` is well within IEEE 754 double range at any plausible n                       |
| Sync engine misses userId check on DELETE               | `engine.ts:321,342` filters realtime by `user_id=eq.${userId}` server-side, plus RLS              |
| Canvas undo/redo corruption                             | Standard correct swap-with-current implementation; works                                          |
| Insights-engine stale closure                           | `insights-engine.tsx:155` already uses functional setState                                        |
| AI-run-panel `lastTokenCount` cross-instance corruption | No such variable exists in the file                                                               |
| Agent-conversation missing abort check                  | File doesn't stream; abort is in `src/lib/agent/client.ts:53-104` and correct                     |
| Agent-sheet keydown listener leak                       | `agent-sheet.tsx:88` returns cleanup function                                                     |
| Trophy-case duplicate keys at same timestamp            | Key includes index → always unique within map                                                     |
| Trophy-case renders "undefined:"                        | `e.meta?.toolId ? ... : ""` already conditional                                                   |
| LocalStorage in workspace-sync / ai-run-panel           | No direct localStorage calls in those files                                                       |
| adkar NaN propagation in `avgDaysPerStage`              | Guarded by `Number.isFinite(d) && d >= 0` before push                                             |
| dora-scorecard band fns fall through on NaN             | `Number.isFinite(perWeek)` guard already present                                                  |
| Maturity weighted score divides by zero                 | Divisor is constant `MATURITY_DIMENSIONS.length`, never 0                                         |
| NPS divides by zero                                     | Guarded by `if (nps.length === 0) return 0`                                                       |
| Risk-register `buildWeeklyRiskSeries` RangeError        | Already uses `reduce` instead of spread, inline comment documents fix                             |
| Retro export emits dangling groupedWith                 | `buildExportJson` doesn't include `groupedWith` at all                                            |
| Retro cycle detection misses child id                   | Child id checked separately via `cursor === id`                                                   |
| Velocity bridge `__velocityBridgeOwnedIds` lost on HMR  | Window-attached set is intentional StrictMode fix                                                 |
| Estimation-guide prototype pollution via shared-state   | No patch-applying code present in file                                                            |
| async-standup midnight race                             | 1-minute tick re-renders + handler re-reads `todayLocalISO()`                                     |
| oncall-roster setDate across DST                        | Deliberate per its comment; ms-arithmetic is the bug they avoided                                 |
| feature-flag-tracker UTC/local week drift               | Already fixed; comment documents the switch to local                                              |
| LLM-eval-tracker dedup not cleared on model change      | Dedupe key includes the group/model + persisted; correct                                          |
| Mood-tracker placeholder permanent                      | Filtered from analytics by design; user re-completes later                                        |
| Wardley/working-agreement focused draft sync            | Intentional design — don't clobber in-progress typing                                             |
| one-on-one notes draft cleared                          | Already deps `[activeMeeting?.id]` only, fix documented                                           |
| RLHF-log CSV not escaped                                | Uses shared `exportToCSV` which escapes quotes/commas/newlines/CR + formula-injection defence     |
| Code-review-metrics parseCsv throws uncaught            | Wrapped in try/catch with toast                                                                   |
| Dependency-map self-edge → false cycle                  | UI blocks self-edge + `validEdges` filter strips them                                             |
| Value-stream IQR dedup misses tied stage                | `outliers.filter` keeps each occurrence; second tied stage IS flagged                             |
| Epic-roadmap year-input overflow                        | Year capped at 2200 + `MAX_QUARTERS_SPAN = 40` enforced                                           |
| Flaky-tests sparse weeks bias XmR                       | Already dense-fills missing weeks                                                                 |
| Release-readiness p-chart at exactly 4 releases         | `< 4 → null` means 4+ renders correctly                                                           |
| Runbook-scorer Mann-Kendall on n<5                      | Guarded `if (reviewed.length < 5) return null`                                                    |
| Cycle-time stale trend state                            | `useMemo` returns null when length < 5, no staleness possible                                     |

### Documented trade-off (no change needed)

- **MCP rate limit is instance-local** — `src/app/api/mcp/route.ts:10-22` has an inline comment explaining this is intentional for a single-user toolkit; Redis would be needed for strict global enforcement but isn't worth the dependency.
- **CSP uses `*.supabase.co` wildcard** — `next.config.mjs:36` documented as "tighten in production if you want defense-in-depth". Already mitigated by SOP + CORS.

---

## Coverage map

| Surface                                                                                    | Status                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| All 109 tools (108 `_client.tsx` files + `canvas/` sub-tree)                               | Audited                                                                                    |
| `src/lib/analytics/` (16 files)                                                            | Audited                                                                                    |
| `src/lib/stores/` (13 files)                                                               | Audited                                                                                    |
| `src/lib/sync/` (7 files)                                                                  | Audited                                                                                    |
| `src/lib/realtime/` (3 files)                                                              | Audited                                                                                    |
| `src/lib/auth/`, `src/lib/mcp/`, `src/lib/llm/`                                            | Audited                                                                                    |
| `src/components/shared/` (25 components)                                                   | Audited                                                                                    |
| `src/components/charts/`, `layout/`, `auth/`, `ai/`, `agent/`, `history/`, `gamification/` | Audited                                                                                    |
| `src/middleware.ts`                                                                        | Audited                                                                                    |
| `src/app/api/{mcp,access-tokens,agent}/`                                                   | Audited + hardened                                                                         |
| `supabase/migrations/0001..0008`                                                           | Audited; RLS policies confirmed per-user-scoped, anon revoked, `to authenticated` explicit |
| `next.config.mjs` CSP                                                                      | Audited                                                                                    |

---

## Methodology notes

1. **Agent quality varies sharply.** Of the ~150 raw findings, my spot-check on the loudest "Critical/High" claims found roughly 70% to be false positives — most often because the agent didn't read the inline-comment fix-history and re-raised an already-fixed bug. Always verify against the actual file before acting.
2. **Explore agents cannot Write files.** Several batch agents (B, D, F, G) returned summaries inline rather than writing reports. I saved those to `.bug-hunt/` myself.
3. **Batch G ran out of scope** on its first invocation; I followed up by reading the 12 missed tools directly. All 12 turned out to be clean (heavily defended with documented prior-fix comments).

Per-area raw agent reports live in `.bug-hunt/01..10-*.md` for historical reference. Treat them as starting hypotheses, not actionable lists.

---

## Recommended follow-ups (out of scope for this pass)

1. Migrate the MCP rate limiter to Redis/Upstash if/when this tool ever multi-instances.
2. Tighten the `*.supabase.co` wildcard in `next.config.mjs` to your specific project subdomain in production.
3. Consider rate-limiting `/api/access-tokens` POST to prevent abuse (currently relies on Supabase session being valid + email allowlist).
4. The `expires_at IS NULL` clause in `resolve_pat` (migration 0006) still permits unbounded legacy tokens. Now that the API default-stamps a 90-day expiry, you could add a periodic backfill to set expiry on the remaining null rows.

---

---

# Round 4 — 2026-07-27

**Scope:** whole tree — 110 tools, shared lib + components, API/auth/MCP + middleware,
sync/realtime/stores, analytics, gamification, Supabase migrations, build config.
**Method:** 11 parallel audit agents (read-only, forbidden from editing), every finding
re-verified against the actual file before it was accepted, then fixed in 4 parallel
fix agents + direct edits. Baseline and final state both green:
typecheck clean, lint clean, production build green, **1492 to 1496 tests passing**.

Agents produced ~45 candidate findings. **33 were confirmed and fixed**; the rest were
rejected on re-read (already defended, unreachable, or cosmetic) and are listed under
"Rejected" so a future round does not re-litigate them.

## Highest-severity: silent cross-device data loss (sync)

| #   | File                                  | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/sync/use-cloud-persisted.ts` | Hydration did not arm the `remoteAppliedRef` sentinel, so the post-hydrate write effect called `markDirty()`. `BlobAdapter.pull()` early-returns when dirty, so **every cold page load skipped its initial pull and force-pushed the local value over the cloud row.** Device B's edit was destroyed by device A merely reloading; a fresh device pushed `initial` (e.g. `[]`) over real data. `usePersisted` aliases this hook, so ~50 files were affected. Fixed by arming the sentinel in all four hydration branches.          |
| 2   | `src/lib/sync/engine.ts`              | `stop()` cleared push timers and called `resetSyncState()` (wiping `dirty` / `pendingDeletes`) **without flushing**. Sign-out, and every auth-state change including the ~hourly `TOKEN_REFRESHED`, therefore discarded any edit still inside its 1s debounce — the next `start()` pulled the older cloud row over it. Lost tombstones also resurrected deleted entities on every device. Fixed: `resetSyncState()` now runs in `start()` only on an actual user change (its BUG-S13 rationale), plus a best-effort flush on stop. |

## Auth / API / MCP

| #   | File                                                    | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | `src/middleware.ts`                                     | The guest-cookie strip mutated only the response, so the render it fired on still resolved a guest session — the owner got a page mounted in guest mode whose writes then 401'd (the browser had already dropped the cookie). Now deletes from `request.cookies` and forwards via `NextResponse.next({ request })`.                                                                                                                                                                                                                                                           |
| 4   | `src/middleware.ts`                                     | `hasOwnerSessionCookie` used `endsWith("-auth-token")`, which never matches `@supabase/ssr`'s chunked cookies (`sb-<ref>-auth-token.0`, `.1`) — the common case for Google OAuth, where the session exceeds the 3180-byte chunk threshold. The strip above never fired for those users.                                                                                                                                                                                                                                                                                       |
| 5   | `src/lib/mcp/rate-limit.ts`, `src/app/api/mcp/route.ts` | Rate-limit **cost** and capability **authorization** shared one function, and the `intent.*` id prefix won. `intent.summarize_workspace` declares `category: "read"` because it only reads, so a read-only PAT was denied the one intent that mutates nothing. Split into `rateCategoryForAction` (cost, prefix wins) and `capabilityCategoryForAction` (mutation, declared category wins).                                                                                                                                                                                   |
| 6   | `mcp-server/src/index.ts`                               | The `isNotification` suppression sat _after_ the JSON-RPC parse-and-return, so it was unreachable — the route answers every non-2xx with a well-formed envelope. Notifications got an unsolicited response for an id they never issued, and the stderr diagnostic was never written.                                                                                                                                                                                                                                                                                          |
| 7   | `supabase/migrations/0025_...sql` (new)                 | `revoke ... from public` does **not** remove Supabase's stock default-privilege `EXECUTE` grant to `anon`/`authenticated` (that is an explicit role grant, not a PUBLIC one). `purge_old_history_events` — `SECURITY DEFINER`, caller-supplied retention, no user predicate — was callable with the public anon key, i.e. an unauthenticated request could delete every user's history. Also `purge_expired_rooms`, both `resolve_pat` overloads, and `kudos_add_reaction` (whose 0024 `auth.uid() is null` guard treats anon as service-role). **Needs `supabase db push`.** |

## Build config — whole classes of dead CSS

| #   | File                 | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `tailwind.config.ts` | `content` omitted `./src/lib/**`, but three components mounted app-wide live there (`WeatherWidget`, `KudosHeaderBeacon`, `HolidayEngine`). Utilities used only by them were never generated: the kudos unread badge rendered unpositioned, its popover had no width or scroll cap, and every holiday overlay ignored its fixed offsets and landed in flow position over the header.                                               |
| 9   | `tailwind.config.ts` | `danger` was never a defined color, so **~169** `text-danger` / `bg-danger/5` / `border-danger/40` utilities across the app emitted nothing — critical insights rendered flatter than the amber warnings beneath them, `<CalloutAlert tone="danger">` lost its red band, and the AI run panel's error state was chrome-identical to success. Aliased to `var(--destructive)`; `stat-card.tsx` had worked around it locally in R10. |

## Input handling — fields users literally could not type into

`ui/input` and `ui/textarea` are bare controlled elements. When `onChange` normalises the
value and the result equals current state, React bails out of the re-render and its
controlled-input restore writes the OLD value back into the DOM node.

| #   | File                                           | Bug                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10  | `rfc-tracker-client.tsx`                       | `setDecision` trimmed on every keystroke, so typing "We will use SSE" produced `WewilluseSSE`. Now `BlurTextarea`.                                                                                                                                                                                                                                     |
| 11  | `raci-client.tsx`                              | Same, in the `md:hidden` **mobile** branch only — the desktop branch already used `BlurInput`/`BlurTextarea`. Every sub-768px user hit it.                                                                                                                                                                                                             |
| 12  | `cfd-client.tsx`                               | `renameColumn` trims and rejects duplicates but still returns new state, so a space could never be typed into a column name; select-all+Delete snapped the old name back.                                                                                                                                                                              |
| 13  | `daci-client.tsx`, `rapid-decision-client.tsx` | `value={buf \|\| committed.join(", ")}` with `onBlur` resetting `buf` to `""` — `"" \|\| "Alice, Bob"` means a committed list could never be cleared, and `add()` fell back to the stale array, re-adding the names the user had just deleted. Buffers are now `string \| null`, where `null` means "no buffer" and `""` means "deliberately emptied". |

## Calculation / logic

| #   | File                                                  | Bug                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 14  | `epic-roadmap-client.tsx`                             | `forecastLinear` evaluates horizons as literal x values. Points are `quarterIndex` (about 8105 for 2026 Q1) but the horizon passed was `progressSeries.length` (2, 3...), extrapolating ~8100 units outside the fitted domain: two epics at 70% and 50% one quarter apart projected **81100%**.                                                        |
| 15  | `health-dashboard/synced-kpis.ts`                     | `saveCheck()` archives to `history` and resets `current` to a pristine **all-green** form, but the KPI read `current` — so saving an all-red check reported **100% / "On Track"**, pinned the sparkline at 100 and made the trend arrow always point up. Now reads the latest saved check; `current` is a fallback only before the first save.         |
| 16  | `control-chart.ts`                                    | `pChartLimits` clamps `ucl` at 1.0 and `westernElectricRules` back-derived sigma from that clamped value — measured 0.01875 vs a true 0.08146. Rule 5 then fired on every point and, because the loop `continue`s, Rule 2 was never evaluated, so refinement's "DoR adherence drift" alert could never fire. `sigma` is now carried through unclamped. |
| 17  | `scoring-rubric.ts`                                   | `detectOutliers` used `sorted[floor(n*0.75)]` as Q3; at n=4 that **is** the maximum, so no high outlier was ever detectable — `[1,2,3,1000]` flagged nothing. Now uses the existing `quantile()` helper.                                                                                                                                               |
| 18  | `token-cost-tracker-client.tsx`                       | `ceil(elapsed) + 1` double-counted the first partial day, halving the projection: $50 logged today against a $1000 budget projected $750 and never tripped the over-budget banner (true value $1500).                                                                                                                                                  |
| 19  | `velocity-client.tsx`                                 | The "sprints meeting commitment" footer counted _planned_ sprints in its denominator while the KPI beside it counted only _completed_ ones, rendering "1 / 2" next to "100% predictable".                                                                                                                                                              |
| 20  | `stacey-matrix-client.tsx`                            | `parseFloat("0") \|\| 0.5` — `0` is falsy but valid, so the textbook chaotic case (0, 0) was silently relocated to the dead centre and classified "complex".                                                                                                                                                                                           |
| 21  | `oncall-roster-client.tsx`                            | The fixed 26-bucket window emitted pre-adoption weeks as real zeros, so Mann-Kendall over ~21 structural zeros reported a **significant upward trend** for perfectly flat paging (`p=0.022`), and the `< 5` / `< 4` guards were dead (length was only ever 0 or 26).                                                                                   |
| 22  | `vuln-burndown-client.tsx`, `a11y-tracker-client.tsx` | `resolvedAt` is deliberately preserved across a resolved-to-open transition, but the chart and age keyed off the timestamp rather than `status` — a re-opened item froze its age, never counted as an SLA breach, and vanished from the burn-down while the "Open" KPI still counted it.                                                               |
| 23  | `board-insights.ts`                                   | The "oversized object" filter scanned all objects while the median sampled only `SIZED_KINDS`. For `line`/`arrow`, `w`/`h` are signed deltas, not a bounding box, so a diagonal arrow was flagged oversized (and one drawn up-and-right had a negative "area").                                                                                        |
| 24  | `tech-debt-client.tsx`                                | The `[1,5]` clamp bounded the range but not the domain: a fractional `impact: 2.5` (reachable via the agent action, which declares `z.number()` with no `.int()`) yielded `grid[1.5]` then `undefined[c]++` then TypeError in a `useMemo`, unmounting the route on every mount thereafter.                                                             |
| 25  | `nps-csat-client.tsx`                                 | Clamping ran only in the score field's `onBlur`, so picking "CSAT (1-5)" and clicking Add without focusing the score saved `{kind:"csat", score:8}` — the CSAT KPI rendered "8.0" under a "(1-5)" hint.                                                                                                                                                |
| 26  | `capacity-planner-client.tsx`                         | `Number("")` is `0`, not `NaN`, so an emptied field sailed past the `!Number.isFinite` guard the comment above it says exists to stop exactly this — clearing Focus Factor committed 0 and zeroed Total Capacity into the synced workspace.                                                                                                            |
| 27  | `story-mapper-client.tsx`                             | The JSON export re-keyed by step **name** while the board is keyed by step **id**; `addStep` hardcodes "New Step", so two same-named columns collapsed in `Object.fromEntries` and an entire column's cards were silently dropped. The clipboard export was unaffected, so the two disagreed.                                                          |
| 28  | `history/page.tsx`                                    | `visible` sliced with the raw `page` while the footer clamped with `safePage` — after the purge cron trimmed rows the list rendered empty under "Page 2 of 2".                                                                                                                                                                                         |

## Privacy / lifecycle / robustness

| #   | File                                                        | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 29  | kudos settings (6 call sites)                               | **Every toggle in the Kudos settings dialog was inert.** The dialog says "Turn off any feature you do not want sent to the LLM", but turning Sentiment analysis off still shipped the full message body to the user's BYOK provider; duplicate-detection and fairness likewise; both beacons ignored their switches; and custom themes could never be selected. All six now wired.                                                                                                                                                               |
| 30  | `lib/kudos/cloud-sync.ts`                                   | No in-flight claim, and `notBefore` only advanced after the fetch settled — the 250ms tick re-POSTed the same row (8 concurrent POSTs for a 2s response) and the settle callbacks burned all 4 attempts in one round-trip, dropping the kudos. The documented 0.5/1/2/4s backoff never happened.                                                                                                                                                                                                                                                 |
| 31  | `lib/history/export.ts`, `tool-history-drawer-content.tsx`  | `JSON.stringify(undefined)` returns `undefined`, so `s.length` threw. A blank optional field (e.g. adkar's owner) made "Export to Markdown" silently produce no file, and the drawer copy threw during render.                                                                                                                                                                                                                                                                                                                                   |
| 32  | `lib/agent/client.ts`                                       | `detectMode` memoised _failures_, so one cold-start 502 forced BYOK for the whole page session — "No GLM key available..." on every send until reload. The sibling probe already only cached successes.                                                                                                                                                                                                                                                                                                                                          |
| 33  | `mascot-assistant.tsx`, `conversation-list.tsx`, canvas (3) | `pointercancel` unhandled, so a touch drag converted to a scroll left the mascot pinned with the chat panel anchored to the wrong corner; synchronous `revokeObjectURL` could cancel the export download in Firefox/Safari; table column-resize divided a screen delta by a world width (only zoom 1 was correct); template apply remapped only connector ids, so saved mind maps re-applied as disconnected bubbles and two applies shared a `groupId`; click-created widgets pushed no undo snapshot, so Cmd+Z reverted the previous edit too. |
| 34  | `scripts/generate-action-registry.mjs`                      | `shouldSkip` matched `/\/_/` against the **absolute** path, so any checkout under a `_`-prefixed directory (e.g. Azure Pipelines' `C:\agent\_work\...`) skipped every module, wrote a 0-import registry, logged success and passed the build — leaving the agent with no tools at runtime. Reproduced end-to-end: 2 modules collected pre-fix vs 98 post-fix. Now also exits non-zero on zero modules.                                                                                                                                           |

## Rejected on re-read (do not re-litigate)

Beyond round 3's list: cross-correlation NaN handling (dead code, no importers);
`bootstrap.ts` BCa (verified line-by-line against Efron & Tibshirani); `survival.ts`
Kaplan-Meier tie handling; `monte-carlo` degenerate iterations (guarded at both call
sites); `clustering.ts` bounds; mascot-3d GPU/RAF teardown (complete and correct);
`particle-background` worker lifecycle (documented as intentional); sidebar scroll-lock
refcount; all `BlurInput` consumers (none inside a `<form>`); index-as-key across all
scopes (all on read-only or append-only lists); RLS end state across 0001-0024 (every
table owner-scoped; the loud 0003/0001/0016 policies are each dropped by a later
migration); CSP (nothing the app loads is blocked); module-scope env reads (all inside
function bodies or literal-defaulted); `risk-register`'s preserved `resolvedAt`
(deliberate, and nothing there uses it as a live "is open" test — unlike #22).

## Known-latent, deliberately not fixed

- **`/api/kudos` `?before=` cursor** drops rows tied on `sent_at` (the secondary `id` sort
  makes the boundary deterministic, not lossless). No in-app caller passes `?before=`
  today; fixing it properly means a compound cursor and an API change.
- **`particles/engine.ts`** assumes `requestAnimationFrame` exists on the worker global.
  It is Chromium-only there, while `OffscreenCanvas` (which the caller gates on) ships in
  Firefox 105+/Safari 16.4+. Worker failures are also unobserved — nothing listens to the
  worker's `error` message. Blank background, no diagnostics.
- **`signal-bus` flush queue** is uncapped while `requestAnimationFrame` is parked in a
  hidden tab.
- **`maturity-client.tsx`** derives and writes the workspace `maturityLevel` scalar on
  mount, overwriting a value set independently via the agent action.
- **`kudos-wall.tsx`** drops replies attached to a non-newest dedup-cluster member.

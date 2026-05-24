# Agile Toolkit — Deep Bug Audit Report

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

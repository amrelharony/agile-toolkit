/**
 * Per-PAT operation capability ("access level").
 *
 * Orthogonal to squad scope (which restricts WHICH data a token sees): this
 * restricts WHAT operations a token may perform, enforced server-side at the
 * MCP route on every `tools/call`. It gives a stolen, shared, or
 * prompt-injected token a real ceiling — `requiresConfirmation` is only a UI
 * affordance and is NOT enforced over MCP (see context.ts), so a token is
 * otherwise an unconfirmed destructive capability.
 *
 * Levels are an ordered ladder that mirrors the rate-limit category ladder
 * (read < write < intent):
 *
 *   full   (default) — read + write + intent. Preserves pre-0022 behaviour;
 *                      every existing token is `full`.
 *   write            — read + write, but NOT intents (the most powerful
 *                      compositions, which fan out to many writes).
 *   read             — read-only. Cannot create / update / delete anything.
 *
 * Handshake + discovery methods (initialize, tools/list, notifications) are
 * always allowed regardless of level — they do no mutation.
 */

import type { RateCategory } from "./rate-limit";

export type AccessLevel = "full" | "write" | "read";

export const ACCESS_LEVELS: readonly AccessLevel[] = ["full", "write", "read"] as const;

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v);
}

// Power rank of an action category and the highest rank each level may invoke.
const CATEGORY_RANK: Record<RateCategory, number> = { read: 0, write: 1, intent: 2 };
const LEVEL_MAX_RANK: Record<AccessLevel, number> = { read: 0, write: 1, full: 2 };

/** True if a token at `level` is permitted to invoke an action in `category`. */
export function levelAllowsCategory(level: AccessLevel, category: RateCategory): boolean {
  return CATEGORY_RANK[category] <= LEVEL_MAX_RANK[level];
}

/**
 * Coerce a raw `access_level` (as returned by `resolve_pat`) into a usable
 * AccessLevel. Two DISTINCT fallbacks, by intent:
 *
 *   • null / undefined — a stale RPC return from a pre-0022 deploy, before the
 *     column existed — resolves to 'full'. Preserves legacy behaviour so a
 *     half-applied deploy doesn't lock out legitimate writers.
 *   • any NON-null value we don't recognise (e.g. a typo'd 'writ') — fails
 *     CLOSED to 'read'. A malformed level must restrict, never silently
 *     escalate to full privilege.
 */
export function coerceAccessLevel(value: string | null | undefined): AccessLevel {
  if (isAccessLevel(value)) return value;
  return value == null ? "full" : "read";
}

/**
 * Parse a CALLER-REQUESTED access_level at PAT-mint time. Distinct from
 * {@link coerceAccessLevel}, which resolves a value read back FROM the DB:
 *
 *   • undefined (field omitted) → 'full', preserving pre-0023 mint behaviour.
 *   • a recognised level → used as-is.
 *   • anything else (null, a malformed string, a non-string) → REJECTED
 *     (returns null) so the route can answer 400 instead of silently minting
 *     a BROADER token than the caller asked for.
 *
 * access_level is the only enforced authorization-granularity ceiling over
 * MCP (requiresConfirmation is not enforced there — see actions/context.ts),
 * so failing OPEN to 'full' on malformed mint input is unsafe.
 */
export function parseRequestedAccessLevel(value: unknown): AccessLevel | null {
  if (value === undefined) return "full";
  return isAccessLevel(value) ? value : null;
}

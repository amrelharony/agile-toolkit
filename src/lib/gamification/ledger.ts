"use client";

/**
 * The XP ledger: the only way outcome XP is earned.
 *
 * `recordOutcome(id, {key?, meta?, at?})`
 *   1. rejects a key already paid (`claims` for 45 days, `onceKeys` forever);
 *   2. applies the outcome's daily cap, then the global 300/day cap;
 *   3. stores the claim and today's totals in one functional update;
 *   4. awards the XP (if any) through the engine;
 *   5. dispatches `outcome:<id>` so achievements and challenges move — also
 *      when a cap left the XP at 0, never for a repeat.
 *
 * The decision itself (`planOutcome`) is pure so the rules can be tested as a
 * table without the store.
 */

import { useVDnaStore } from "@/lib/stores/vdna-store";
import { awardXp, dispatch } from "./engine";
import {
  CLAIM_RETENTION_DAYS,
  GLOBAL_DAILY_XP_CAP,
  getOutcome,
  localDateOf,
  matchEventOutcome,
  type OutcomeDef,
  type OutcomeId,
} from "./outcomes";
import { ONCE_KEYS_CAP } from "./vdna-migrate";
import type { XpDay } from "./types";

export type OutcomeReason =
  /** XP paid (possibly trimmed by the global cap). */
  | "awarded"
  /** The key was already paid. Nothing recorded, nothing dispatched. */
  | "duplicate"
  /** The outcome's own daily cap is used up: 0 XP, still dispatched. */
  | "outcome-cap"
  /** Today's 300 outcome XP are used up: 0 XP, still dispatched. */
  | "global-cap"
  /** No such outcome. */
  | "unknown";

export interface OutcomeResult {
  awarded: boolean;
  xp: number;
  reason: OutcomeReason;
}

export interface RecordOptions {
  /** Idempotency key (an entity: `risk:<id>`, `kudos:<id>`…). */
  key?: string;
  /** Carried on the `outcome:<id>` event and into the XP event's meta. */
  meta?: Record<string, unknown>;
  /** When it happened; defaults to now. Decides which local day it counts on. */
  at?: Date | string | number;
}

/** The ledger's slice of the profile. */
export interface LedgerState {
  xpDay: XpDay;
  claims: Record<string, number>;
  onceKeys: string[];
}

export interface OutcomePlan {
  result: OutcomeResult;
  /** The ledger fields to store; null when nothing changes (repeat, unknown). */
  next: LedgerState | null;
  /** True when this outcome used up the last of today's global XP. */
  capReached: boolean;
}

/** Local-calendar day ordinal (DST-safe, see engine.ts). */
export function dayOrdinal(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

function toDate(at: RecordOptions["at"]): Date {
  if (at === undefined) return new Date();
  const d = at instanceof Date ? at : new Date(at);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function pruneClaims(claims: Record<string, number>, today: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, day] of Object.entries(claims)) {
    if (today - day <= CLAIM_RETENTION_DAYS) out[k] = day;
  }
  return out;
}

/** Pure: what recording `def` would do to `state`. */
export function planOutcome(
  state: LedgerState,
  def: OutcomeDef | undefined,
  opts: RecordOptions = {}
): OutcomePlan {
  if (!def)
    return { result: { awarded: false, xp: 0, reason: "unknown" }, next: null, capReached: false };
  const when = toDate(opts.at);
  const date = localDateOf(when);
  const today = dayOrdinal(when);
  const key = opts.key || undefined;

  if (key) {
    const paid = def.once ? state.onceKeys.includes(key) : key in state.claims;
    if (paid) {
      return {
        result: { awarded: false, xp: 0, reason: "duplicate" },
        next: null,
        capReached: false,
      };
    }
  }

  const day: XpDay = state.xpDay.date === date ? state.xpDay : { date, total: 0, byKey: {} };
  const count = day.byKey[def.id] ?? 0;
  const base = Math.max(0, def.xp + (def.bonusXp?.(opts.meta) ?? 0));

  let xp = 0;
  let reason: OutcomeReason;
  if (def.capPerDay !== undefined && count >= def.capPerDay) {
    reason = "outcome-cap";
  } else {
    xp = Math.max(0, Math.min(base, GLOBAL_DAILY_XP_CAP - day.total));
    reason = xp > 0 || base === 0 ? "awarded" : "global-cap";
  }

  const counted = reason === "awarded";
  const nextDay: XpDay = {
    ...day,
    total: day.total + xp,
    byKey: counted ? { ...day.byKey, [def.id]: count + 1 } : day.byKey,
  };

  // A capped outcome still claims its key: the same risk closed again
  // tomorrow mustn't pay what today's cap held back ("never overpays").
  let claims = state.claims;
  let onceKeys = state.onceKeys;
  if (key && def.once) {
    onceKeys = [...state.onceKeys, key].slice(-ONCE_KEYS_CAP);
  } else if (key) {
    claims = { ...pruneClaims(state.claims, today), [key]: today };
  }

  return {
    result: { awarded: xp > 0, xp, reason },
    next: { xpDay: nextDay, claims, onceKeys },
    capReached: day.total < GLOBAL_DAILY_XP_CAP && nextDay.total >= GLOBAL_DAILY_XP_CAP,
  };
}

export interface OutcomeRecord extends OutcomeResult {
  id: OutcomeId;
  key?: string;
  at: string;
  meta?: Record<string, unknown>;
  /** True on the outcome that used up the last of today's global XP. */
  capReached: boolean;
}

type OutcomeListener = (record: OutcomeRecord) => void;
const listeners = new Set<OutcomeListener>();

/** Hear every recorded outcome (repeats excluded), e.g. for the Activity inbox. */
export function subscribeOutcomes(fn: OutcomeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function primitiveMeta(
  m: Record<string, unknown> | undefined
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!m) return out;
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Record a finished outcome: XP within the caps, once per key, then `outcome:<id>`. */
export function recordOutcome(id: OutcomeId | string, opts: RecordOptions = {}): OutcomeResult {
  const def = getOutcome(id);
  if (!def || typeof window === "undefined") {
    return { awarded: false, xp: 0, reason: "unknown" };
  }

  // Decide inside the functional update so two outcomes in one tick can't
  // both read the same totals (same race as bumpCounter / awardXp).
  let plan: OutcomePlan | null = null;
  useVDnaStore.setState((s) => {
    plan = planOutcome({ xpDay: s.xpDay, claims: s.claims, onceKeys: s.onceKeys }, def, opts);
    return plan.next ?? {};
  });
  const done = plan as OutcomePlan | null;
  if (!done || !done.next) return done?.result ?? { awarded: false, xp: 0, reason: "unknown" };

  const { result } = done;
  if (result.xp > 0) {
    awardXp(result.xp, "outcome", {
      ...primitiveMeta(opts.meta),
      outcomeId: def.id,
      ...(opts.key ? { key: opts.key } : {}),
    });
  }
  dispatch({
    name: `outcome:${def.id}`,
    meta: { ...opts.meta, outcomeId: def.id, xp: result.xp, capped: result.reason !== "awarded" },
  });

  const record: OutcomeRecord = {
    ...result,
    id: def.id,
    key: opts.key,
    at: toDate(opts.at).toISOString(),
    meta: opts.meta,
    capReached: done.capReached,
  };
  listeners.forEach((fn) => {
    try {
      fn(record);
    } catch {
      /* a listener never breaks the ledger */
    }
  });
  return result;
}

/**
 * Entry point for a gamification event from a tool (`emit()` forwards every
 * tool event here): the engine sees the raw event first, then an event that
 * is an outcome is recorded.
 */
export function ingestEvent(name: string, meta?: Record<string, unknown>): void {
  dispatch({ name, meta });
  const match = matchEventOutcome(name);
  if (match) recordOutcome(match.id, { key: match.key, meta });
}

/**
 * A visit to a tool. The engine records the visit; the first visit ever
 * pays `first-tool`. Tools visited before the ledger existed don't pay again.
 */
export function ingestToolVisit(toolId: string): void {
  const isNew = !useVDnaStore.getState().toolsVisited.includes(toolId);
  dispatch({ name: "tool-visit", meta: { toolId } });
  if (isNew) recordOutcome("first-tool", { key: `tool:${toolId}`, meta: { toolId } });
}

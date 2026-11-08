/**
 * Schema migrations for the persisted gamification profile
 * (`agile-toolkit:vdna`). Pure and free of "use client", so the store, the
 * backup restore path and tests can all use it.
 *
 * Rules every step follows (see `lib/stores/persist-migrate.ts`):
 *   - keep every field, unknown ones included;
 *   - fill new fields only when absent or malformed, never reset them;
 *   - be idempotent: a build that predates v1 (PR A) re-stamps payloads it
 *     writes as v0, so v1 or v2 data can come back through the v0 → v1 step,
 *     and a v1 build writes v2 data back stamped 1.
 */

import { computeLevel } from "./xp-curve";
import type { XpDay } from "./types";

/**
 * Current schema version of `agile-toolkit:vdna`.
 * v1: XP ledger fields. v2: `silentMode` dropped (Settings › Notifications
 * owns celebrations) and the input-only counters stripped.
 */
export const VDNA_SCHEMA_VERSION = 2;

/** `onceKeys` keeps at most this many keys (oldest go first). */
export const ONCE_KEYS_CAP = 2000;

/**
 * Secret achievements and the once-ever key the XP ledger records when its
 * secret pays out. The key is the secret's event name, so a secret found
 * before v1 can't pay again.
 */
export const SECRET_ONCE_KEYS: Readonly<Record<string, string>> = {
  konami: "secret:konami",
  "logo-whisperer": "logo-whispered",
  "triple-tap": "secret:triple-tap",
  "footer-click": "secret:footer-click",
  "type-agile": "secret:typed-agile",
  "type-scrum": "secret:typed-scrum",
};

/*
 * Input-only counters. v1 kept them while live badges still read them; the
 * outcome catalog retired those badges and the input diet removed their
 * writers, so v2 strips them. Nothing reads or writes them any more.
 */
const RETIRED_COUNTERS: ReadonlySet<string> = new Set(["click", "hover", "logo-hover"]);
const RETIRED_COUNTER_PREFIXES = ["session-minutes", "audio-mode"] as const;

/** True for a counter key v2 strips (`click`, `hover`, `logo-hover`, `session-minutes*`, `audio-mode*`). */
export function isRetiredCounter(key: string): boolean {
  return RETIRED_COUNTERS.has(key) || RETIRED_COUNTER_PREFIXES.some((p) => key.startsWith(p));
}

export const EMPTY_XP_DAY: XpDay = { date: "", total: 0, byKey: {} };

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberRecord(value: unknown): Record<string, number> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) if (finiteNumber(v)) out[k] = v;
  return out;
}

function sanitizeXpDay(value: unknown): XpDay {
  if (!isPlainObject(value)) return { ...EMPTY_XP_DAY, byKey: {} };
  return {
    ...value,
    date: typeof value.date === "string" ? value.date : "",
    total: finiteNumber(value.total) ? value.total : 0,
    byKey: numberRecord(value.byKey) ?? {},
  };
}

function unlockedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** v0 → v1: ledger fields, secrets seeded as paid, level recomputed. Counters are kept as stored. */
function toV1(state: Obj): Obj {
  const next: Obj = { ...state };

  if (finiteNumber(state.xp)) {
    const prestige = finiteNumber(state.prestige) ? state.prestige : 0;
    next.level = computeLevel(state.xp, prestige).level;
  }

  next.xpDay = sanitizeXpDay(state.xpDay);
  next.claims = numberRecord(state.claims) ?? {};

  const once = Array.isArray(state.onceKeys)
    ? state.onceKeys.filter((k): k is string => typeof k === "string" && !!k)
    : [];
  const seeded = new Set(once);
  for (const id of unlockedIds(state.unlocked)) {
    const key = SECRET_ONCE_KEYS[id];
    if (key) seeded.add(key);
  }
  next.onceKeys = Array.from(seeded).slice(-ONCE_KEYS_CAP);

  return next;
}

/** v1 → v2: drop `silentMode`, strip the input-only counters. Everything else is kept. */
function toV2(state: Obj): Obj {
  const next: Obj = { ...state };
  delete next.silentMode;
  if (isPlainObject(state.counters)) {
    const counters: Obj = {};
    for (const [k, v] of Object.entries(state.counters)) if (!isRetiredCounter(k)) counters[k] = v;
    next.counters = counters;
  }
  return next;
}

/** True once a payload carries every v1 ledger field. */
function hasV1Shape(state: Obj): boolean {
  return isPlainObject(state.xpDay) && isPlainObject(state.claims) && Array.isArray(state.onceKeys);
}

/**
 * Bring a payload that skipped `migrate` up to v2, judged by shape. zustand
 * only calls `migrate` for a NUMERIC version that differs from the store's,
 * so an unstamped legacy payload (`{ state }` with no version) reaches the
 * merge step as-is; it predates v1, so it lacks the ledger fields. A payload
 * that has them already went through `migrate` (or is a current v2 or a
 * newer build's payload) and is returned untouched, so a rollback keeps a
 * newer payload whole. Non-objects are returned as they are for the merge
 * to reject.
 */
export function ensureVDnaShape(persisted: unknown): unknown {
  if (!isPlainObject(persisted) || hasV1Shape(persisted)) return persisted;
  return toV2(toV1(persisted));
}

/**
 * zustand `persist` migrate for the vdna store. zustand calls it for any
 * stored version other than the current one (an unstamped legacy payload
 * arrives as `undefined`). Older payloads are brought up to v2; payloads
 * from a NEWER build pass through untouched so a rollback keeps them whole.
 * A non-object payload yields `{}`, which merges as nothing (defaults).
 */
export function migrateVDna<T>(persisted: unknown, version: number | undefined): T {
  if (!isPlainObject(persisted)) return {} as T;
  if (finiteNumber(version) && version > VDNA_SCHEMA_VERSION) return persisted as T;
  // A v1-stamped payload may still be missing ledger fields (written by a
  // PR-A build that re-stamped it), so the v0 → v1 step always runs: it is
  // idempotent and only fills what's absent or malformed.
  return toV2(toV1(persisted)) as T;
}

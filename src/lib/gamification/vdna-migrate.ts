/**
 * Schema migrations for the persisted gamification profile
 * (`agile-toolkit:vdna`). Pure and free of "use client", so the store, the
 * backup restore path and tests can all use it.
 *
 * Rules every step follows (see `lib/stores/persist-migrate.ts`):
 *   - keep every field, unknown ones included;
 *   - fill new fields only when absent or malformed, never reset them;
 *   - be idempotent: a build that predates v1 (PR A) re-stamps payloads it
 *     writes as v0, so v1 data can come back through the v0 → v1 step.
 */

import { computeLevel } from "./xp-curve";
import type { XpDay } from "./types";

/** Current schema version of `agile-toolkit:vdna`. */
export const VDNA_SCHEMA_VERSION = 1;

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

/**
 * Counters fed only by raw input or time on site (clicks, hovers, session
 * minutes, audio modes tried, logo hovers). v1 stops rewarding them, so
 * they are dropped from stored profiles.
 */
export function isRetiredCounter(key: string): boolean {
  return (
    key === "click" ||
    key === "hover" ||
    key === "logo-hover" ||
    key.startsWith("session-minutes") ||
    key.startsWith("audio-mode")
  );
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

/** v0 → v1: ledger fields, secrets seeded as paid, input counters dropped, level recomputed. */
function toV1(state: Obj): Obj {
  const next: Obj = { ...state };

  if (isPlainObject(state.counters)) {
    const counters: Obj = {};
    for (const [k, v] of Object.entries(state.counters)) if (!isRetiredCounter(k)) counters[k] = v;
    next.counters = counters;
  }

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

/** True once a payload carries every v1 ledger field. */
function hasV1Shape(state: Obj): boolean {
  return isPlainObject(state.xpDay) && isPlainObject(state.claims) && Array.isArray(state.onceKeys);
}

/**
 * Bring a payload that skipped `migrate` up to v1, judged by shape. zustand
 * only calls `migrate` for a NUMERIC version that differs from the store's,
 * so an unstamped legacy payload (`{ state }` with no version) reaches the
 * merge step as-is. Payloads already in v1 shape (current or newer) are
 * returned untouched; anything else goes through the v0 → v1 step, which is
 * idempotent. Non-objects are returned as they are for the merge to reject.
 */
export function ensureVDnaShape(persisted: unknown): unknown {
  if (!isPlainObject(persisted) || hasV1Shape(persisted)) return persisted;
  return toV1(persisted);
}

/**
 * zustand `persist` migrate for the vdna store. zustand calls it for any
 * stored version other than the current one (an unstamped legacy payload
 * arrives as `undefined`). Older payloads are brought up to v1; payloads
 * from a NEWER build pass through untouched so a rollback keeps them whole.
 * A non-object payload yields `{}`, which merges as nothing (defaults).
 */
export function migrateVDna<T>(persisted: unknown, version: number | undefined): T {
  if (!isPlainObject(persisted)) return {} as T;
  if (finiteNumber(version) && version > VDNA_SCHEMA_VERSION) return persisted as T;
  return toV1(persisted) as T;
}

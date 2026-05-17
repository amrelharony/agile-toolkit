"use client";

import { useEffect } from "react";

export type SignalKind =
  | "velocity.changed"
  | "impediment.raised"
  | "impediment.resolved"
  | "risk.opened"
  | "risk.closed"
  | "okr.kr.updated"
  | "techDebt.added"
  | "techDebt.resolved"
  | "decision.recorded"
  | "story.statusChanged"
  | "sprint.completed"
  | "sprint.started"
  | "moodLogged"
  | "incident.opened"
  | "incident.resolved"
  | "vuln.opened"
  | "vuln.closed"
  | "deploy.recorded"
  | "flag.added"
  | "flag.aged"
  | "stakeholder.changed"
  | "rfc.decided"
  // Phase 19 — AI / LLM Product Management
  | "llmEval.recorded"
  | "llmEval.regressionDetected"
  | "prompt.versionPublished"
  | "hallucination.logged"
  | "hallucination.resolved"
  | "tokenCost.threshold"
  | "model.upgraded"
  | "redTeam.findingOpened"
  | "redTeam.findingClosed"
  | "agentWorkflow.created"
  | "hitl.reviewLogged"
  | "rlhf.pairLogged"
  | "vector.collectionAdded"
  | "modelCard.published"
  // Phase 20 — Prioritization Frameworks
  | "prioritization.scored"
  | "prioritization.shipped"
  // Phase 21 — Decision Frameworks
  | "decision.daciCreated"
  | "decision.rapidCreated"
  | "decision.weightedScored"
  | "decision.cynefinClassified"
  | "decision.staceyClassified"
  | "decision.polarityMapped"
  | "ooda.cycleCompleted"
  | "sixHats.thoughtLogged"
  // Phase 22 — Canvas (Miro-like whiteboard)
  | "whiteboard.boardCreated"
  | "whiteboard.boardDeleted"
  | "whiteboard.objectCreated"
  | "whiteboard.objectMoved"
  | "whiteboard.objectDeleted"
  | "whiteboard.commentAdded"
  | "whiteboard.commentMentioned"
  | "whiteboard.boardShared"
  | "whiteboard.activityLogged"
  | "whiteboard.templateApplied"
  | "whiteboard.crossToolImport";

export interface Signal<T = unknown> {
  kind: SignalKind;
  at: string;        // ISO timestamp
  toolId: string;
  payload: T;
}

type Listener = (s: Signal) => void;

// Module-level state — there's only one signal bus per app instance.
const listeners = new Map<SignalKind, Set<Listener>>();
const RING_CAP = 200;
// Fixed-size ring buffer with O(1) writes — `Array.shift()` re-indexed
// the entire backing storage on every emit at capacity.
const ringBuffer: (Signal | undefined)[] = new Array(RING_CAP);
let writeHead = 0;
let bufferSize = 0;

function pushRing(s: Signal): void {
  ringBuffer[writeHead] = s;
  writeHead = (writeHead + 1) % RING_CAP;
  bufferSize = Math.min(bufferSize + 1, RING_CAP);
}

let pendingFlush = false;
const queue: Signal[] = [];

function flush(): void {
  pendingFlush = false;
  // Snapshot the queue and clear before fanning out so re-entrant emits
  // queue cleanly into the next frame.
  const batch = queue.splice(0);
  for (const s of batch) {
    const set = listeners.get(s.kind);
    if (!set || set.size === 0) continue;
    // Iterate over a snapshot so subscribers can unsubscribe during dispatch.
    for (const fn of Array.from(set)) {
      try { fn(s); } catch {
        // Subscriber errors must not break the bus.
      }
    }
  }
}

function scheduleFlush(): void {
  if (pendingFlush) return;
  pendingFlush = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(flush);
  } else {
    // SSR / tests fall through to a microtask.
    Promise.resolve().then(flush);
  }
}

/**
 * Runtime-iterable set of every declared signal kind. Mirrors the
 * `SignalKind` union above; if you add a kind, add it here too (TS
 * doesn't let us derive a value-level list from a string union, and
 * importing `INVALIDATION_MATRIX` keys here would create a cycle
 * because invalidation.ts imports `SignalKind` from this module).
 *
 * Use {@link isValidSignalKind} to validate kinds coming from
 * untrusted sources (URL params, persisted state, remote events).
 */
export const ALL_SIGNAL_KINDS: ReadonlySet<SignalKind> = new Set<SignalKind>([
  "velocity.changed",
  "impediment.raised",
  "impediment.resolved",
  "risk.opened",
  "risk.closed",
  "okr.kr.updated",
  "techDebt.added",
  "techDebt.resolved",
  "decision.recorded",
  "story.statusChanged",
  "sprint.completed",
  "sprint.started",
  "moodLogged",
  "incident.opened",
  "incident.resolved",
  "vuln.opened",
  "vuln.closed",
  "deploy.recorded",
  "flag.added",
  "flag.aged",
  "stakeholder.changed",
  "rfc.decided",
  "llmEval.recorded",
  "llmEval.regressionDetected",
  "prompt.versionPublished",
  "hallucination.logged",
  "hallucination.resolved",
  "tokenCost.threshold",
  "model.upgraded",
  "redTeam.findingOpened",
  "redTeam.findingClosed",
  "agentWorkflow.created",
  "hitl.reviewLogged",
  "rlhf.pairLogged",
  "vector.collectionAdded",
  "modelCard.published",
  "prioritization.scored",
  "prioritization.shipped",
  "decision.daciCreated",
  "decision.rapidCreated",
  "decision.weightedScored",
  "decision.cynefinClassified",
  "decision.staceyClassified",
  "decision.polarityMapped",
  "ooda.cycleCompleted",
  "sixHats.thoughtLogged",
  "whiteboard.boardCreated",
  "whiteboard.boardDeleted",
  "whiteboard.objectCreated",
  "whiteboard.objectMoved",
  "whiteboard.objectDeleted",
  "whiteboard.commentAdded",
  "whiteboard.commentMentioned",
  "whiteboard.boardShared",
  "whiteboard.activityLogged",
  "whiteboard.templateApplied",
  "whiteboard.crossToolImport",
]);

export function isValidSignalKind(k: unknown): k is SignalKind {
  return typeof k === "string" && (ALL_SIGNAL_KINDS as ReadonlySet<string>).has(k);
}

/**
 * Emit a signal. Subscribers are notified on the next animation frame —
 * never synchronously, so the emit site can never trigger a render storm.
 * Multiple emits within the same frame are batched.
 */
export function emitSignal<T>(s: Signal<T>): void {
  // R5: validate kind against the runtime set. A typo'd or untrusted kind
  // would otherwise get dispatched + written into the ring + silently
  // skip cache invalidation (which keys off the matrix).
  if (!isValidSignalKind(s.kind)) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[signal-bus] dropping unknown signal kind:", s.kind);
    }
    return;
  }
  // Bound payload size — a runaway emitter shouldn't blow up the ring.
  // JSON-stringify is the simplest size estimate; reject signals over
  // 50KB serialized.
  // R5: cyclic payloads previously slipped through (try/catch swallowed
  // the error and `serialized` stayed `""`, passing the size check).
  // Treat unserializable as oversized and drop the signal.
  let serialized = "";
  let serializeOk = false;
  try { serialized = JSON.stringify(s.payload); serializeOk = true; } catch { serializeOk = false; }
  if (!serializeOk) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[signal-bus] dropping unserializable signal:", s.kind);
    }
    return;
  }
  if (serialized.length > 50_000) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[signal-bus] dropping oversized signal:", s.kind, serialized.length);
    }
    return;
  }
  // R5: shallow `Object.freeze` was insufficient — subscribers could
  // mutate `s.payload.nested.field` and corrupt the ring-buffer history.
  // Deep-freeze nested plain objects/arrays to lock the entire shape.
  if (s.payload && typeof s.payload === "object") {
    deepFreeze(s.payload as object);
  }
  pushRing(s as Signal);
  queue.push(s as Signal);
  scheduleFlush();
}

// R5: deep freeze helper. Safe against cycles via a visited set, only
// recurses into plain objects/arrays (skips Date/Map/Set/etc.).
function deepFreeze(value: object, seen: WeakSet<object> = new WeakSet()): void {
  if (seen.has(value)) return;
  seen.add(value);
  try { Object.freeze(value); } catch { /* already frozen / non-extensible */ }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") deepFreeze(item, seen);
    }
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v && typeof v === "object") deepFreeze(v as object, seen);
  }
}

/**
 * Subscribe imperatively. Returns an unsubscribe function. Safe to call
 * from outside React (Zustand subscribers, web workers via main-thread
 * proxy, etc.).
 */
export function subscribeSignals(kinds: SignalKind[], cb: Listener): () => void {
  // R9: validate every kind. emitSignal already validates; subscribe
  // previously didn't, so a typo'd kind silently created a new bucket
  // that no emit ever reached — the listener stayed in the listeners
  // Map forever (module-scope, never reclaimed). Unbounded growth if
  // callers dynamically build the kinds list.
  for (const k of kinds) {
    if (!isValidSignalKind(k)) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[signal-bus] subscribeSignals dropping unknown kind:", k);
      }
      continue;
    }
    let set = listeners.get(k);
    if (!set) { set = new Set(); listeners.set(k, set); }
    set.add(cb);
  }
  return () => {
    for (const k of kinds) {
      listeners.get(k)?.delete(cb);
    }
  };
}

/** React hook variant. Auto-cleans up on unmount.
 *
 * The callback is held in a ref so callers don't have to memoise it
 * with `useCallback` — passing an inline `(s) => …` would otherwise
 * recreate the function on every render, blow the deps comparison,
 * and re-subscribe (tearing down + adding a listener) every render.
 * That's both a perf hit and racy under StrictMode double-invoke. */
import { useRef } from "react";
export function useSignal(kinds: SignalKind[], cb: Listener): void {
  const cbRef = useRef(cb);
  // R5: previously `cbRef.current = cb` ran during render — a discarded
  // render in concurrent mode could mutate the ref before the committed
  // render's effect runs. Sync the ref inside a (no-dep) effect so the
  // mutation happens AFTER commit, never during render.
  useEffect(() => { cbRef.current = cb; });
  // Subscribe ONLY when the kinds list changes (compared by JSON
  // identity, since arrays are typically rebuilt each render). The
  // listener forwards through the ref, so callback churn no longer
  // re-subscribes.
  useEffect(() => {
    return subscribeSignals(kinds, (s) => cbRef.current(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(kinds)]);
}

/** Inspector: read recent signals (last 200) in chronological order. For
 *  debugging and the future history page. */
export function recentSignals(): readonly Signal[] {
  if (bufferSize === 0) return [];
  const out: Signal[] = new Array(bufferSize);
  // Until the buffer fills, entries live at [0, bufferSize). Once wrapped,
  // the oldest sits at writeHead. Iterate oldest-first so callers can render
  // a time-ordered list without reversing.
  const start = bufferSize < RING_CAP ? 0 : writeHead;
  for (let i = 0; i < bufferSize; i++) {
    out[i] = ringBuffer[(start + i) % RING_CAP] as Signal;
  }
  return out;
}

/** Test-only: clear all listeners + ring buffer. */
export function __resetSignalBus(): void {
  listeners.clear();
  for (let i = 0; i < RING_CAP; i++) ringBuffer[i] = undefined;
  writeHead = 0;
  bufferSize = 0;
  queue.length = 0;
  pendingFlush = false;
}

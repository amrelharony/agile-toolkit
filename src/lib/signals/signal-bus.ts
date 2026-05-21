"use client";

import { useEffect, useRef } from "react";

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
  | "rfc.decided";

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
 * Emit a signal. Subscribers are notified on the next animation frame —
 * never synchronously, so the emit site can never trigger a render storm.
 * Multiple emits within the same frame are batched.
 */
export function emitSignal<T>(s: Signal<T>): void {
  pushRing(s as Signal);
  queue.push(s as Signal);
  scheduleFlush();
}

/**
 * Subscribe imperatively. Returns an unsubscribe function. Safe to call
 * from outside React (Zustand subscribers, web workers via main-thread
 * proxy, etc.).
 */
export function subscribeSignals(kinds: SignalKind[], cb: Listener): () => void {
  for (const k of kinds) {
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

/**
 * React hook variant. Auto-cleans up on unmount.
 *
 * Stable across renders: even if the caller passes a new arrow function on
 * every render (very common), the underlying subscription is created ONCE
 * per `kinds` set. A ref holds the latest callback and the registered
 * listener forwards to it, so consumers can safely use inline callbacks
 * without triggering a subscribe/unsubscribe storm.
 */
export function useSignal(kinds: SignalKind[], cb: Listener): void {
  const cbRef = useRef(cb);
  // Keep the ref pointing at the latest callback every render — cheap, no
  // hooks, no effect overhead.
  cbRef.current = cb;
  const kindsKey = kinds.join("|");
  useEffect(() => {
    return subscribeSignals(kinds, (s) => cbRef.current(s));
    // We intentionally subscribe based on the kinds set only. `cb` is
    // forwarded via cbRef so its identity changing doesn't tear the
    // subscription down and rebuild it 60x per second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey]);
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

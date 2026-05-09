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
const ringBuffer: Signal[] = [];
const RING_CAP = 200;

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
  ringBuffer.push(s);
  if (ringBuffer.length > RING_CAP) ringBuffer.shift();
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

/** React hook variant. Auto-cleans up on unmount. */
export function useSignal(kinds: SignalKind[], cb: Listener): void {
  useEffect(() => subscribeSignals(kinds, cb), [JSON.stringify(kinds), cb]);
}

/** Inspector: read recent signals (last 200). For debugging and the future history page. */
export function recentSignals(): readonly Signal[] {
  return ringBuffer;
}

/** Test-only: clear all listeners + ring buffer. */
export function __resetSignalBus(): void {
  listeners.clear();
  ringBuffer.length = 0;
  queue.length = 0;
  pendingFlush = false;
}

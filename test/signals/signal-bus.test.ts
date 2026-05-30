import { describe, it, expect, beforeEach } from "vitest";
import {
  emitSignal,
  subscribeSignals,
  recentSignals,
  __resetSignalBus,
  ALL_SIGNAL_KINDS,
  type Signal,
  type SignalKind,
} from "@/lib/signals/signal-bus";

/**
 * Characterization tests for the cross-tool signal bus (Phase 2 / signal-bus).
 * Previously untested. Covers the async-fanout contract (never synchronous),
 * kind-filtered subscription + unsubscribe, batching, error isolation, and the
 * fixed-size ring buffer the inspector reads.
 */

/** Resolve after the bus's scheduled flush has run (rAF in jsdom, else microtask). */
const flushTick = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else Promise.resolve().then(() => resolve());
  });

const sig = (kind: SignalKind, payload: unknown = {}): Signal => ({
  kind,
  at: "2026-01-01T00:00:00.000Z",
  toolId: "test",
  payload,
});

beforeEach(() => __resetSignalBus());

describe("ALL_SIGNAL_KINDS", () => {
  it("has no duplicate kinds", () => {
    expect(new Set(ALL_SIGNAL_KINDS).size).toBe(ALL_SIGNAL_KINDS.length);
  });
});

describe("emit + subscribe", () => {
  it("delivers to subscribers asynchronously — never on the emit call itself", async () => {
    const seen: Signal[] = [];
    subscribeSignals(["impediment.raised"], (s) => seen.push(s));
    emitSignal(sig("impediment.raised", { id: "i1" }));
    // Synchronous: nothing delivered yet.
    expect(seen).toHaveLength(0);
    await flushTick();
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toEqual({ id: "i1" });
  });

  it("only notifies subscribers of the matching kind", async () => {
    const got: SignalKind[] = [];
    subscribeSignals(["risk.opened"], (s) => got.push(s.kind));
    emitSignal(sig("risk.opened"));
    emitSignal(sig("risk.closed")); // not subscribed
    await flushTick();
    expect(got).toEqual(["risk.opened"]);
  });

  it("batches multiple emits in the same frame into one flush", async () => {
    let flushes = 0;
    const counts: number[] = [];
    subscribeSignals(["sprint.started"], () => {
      counts.push(++flushes);
    });
    emitSignal(sig("sprint.started"));
    emitSignal(sig("sprint.started"));
    emitSignal(sig("sprint.started"));
    await flushTick();
    // All 3 delivered (one per signal) within a single flushed batch.
    expect(counts).toEqual([1, 2, 3]);
  });

  it("stops delivering after unsubscribe", async () => {
    const seen: Signal[] = [];
    const off = subscribeSignals(["okr.kr.updated"], (s) => seen.push(s));
    emitSignal(sig("okr.kr.updated"));
    await flushTick();
    expect(seen).toHaveLength(1);
    off();
    emitSignal(sig("okr.kr.updated"));
    await flushTick();
    expect(seen).toHaveLength(1); // no new delivery
  });

  it("isolates subscriber errors — a throwing listener doesn't break others", async () => {
    const good: Signal[] = [];
    subscribeSignals(["deploy.recorded"], () => {
      throw new Error("boom");
    });
    subscribeSignals(["deploy.recorded"], (s) => good.push(s));
    expect(() => emitSignal(sig("deploy.recorded"))).not.toThrow();
    await flushTick();
    expect(good).toHaveLength(1);
  });
});

describe("recentSignals (ring buffer inspector)", () => {
  it("returns emitted signals oldest-first, available synchronously", () => {
    emitSignal(sig("story.statusChanged", { n: 1 }));
    emitSignal(sig("story.statusChanged", { n: 2 }));
    const recent = recentSignals();
    expect(recent.map((s) => (s.payload as { n: number }).n)).toEqual([1, 2]);
  });

  it("caps at 200 entries, dropping the oldest", () => {
    for (let i = 0; i < 205; i++) emitSignal(sig("moodLogged", { i }));
    const recent = recentSignals();
    expect(recent).toHaveLength(200);
    // Oldest 5 (i=0..4) dropped → first retained is i=5, last is i=204.
    expect((recent[0].payload as { i: number }).i).toBe(5);
    expect((recent[199].payload as { i: number }).i).toBe(204);
  });

  it("is empty after reset", () => {
    expect(recentSignals()).toEqual([]);
  });
});

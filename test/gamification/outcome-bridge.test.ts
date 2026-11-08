import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * History log → ledger. Only this browser's own, fresh, non-guest events
 * pay; events already in the log (or arriving by rehydration) never do.
 */

const h = vi.hoisted(() => ({
  recorded: [] as { id: string; opts: Record<string, unknown> }[],
}));

vi.mock("@/lib/gamification/ledger", () => ({
  recordOutcome: (id: string, opts: Record<string, unknown>) => {
    h.recorded.push({ id, opts });
    return { awarded: true, xp: 1, reason: "awarded" };
  },
}));

import {
  OUTCOME_MAX_AGE_MS,
  installOutcomeBridge,
  isFreshOwnEvent,
} from "@/lib/gamification/outcome-bridge";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";

const OWN = "client-own";
let seq = 0;

function event(patch: Partial<HistoryEvent> = {}): HistoryEvent {
  const id = `e${++seq}`;
  return {
    id,
    clientEventId: id,
    clientId: OWN,
    toolRunId: "run-1",
    userId: null,
    toolId: "risk-register",
    action: "risk_updated",
    payload: { riskId: "r1", fields: ["status"], from: "open", to: "closed" },
    isMilestone: false,
    occurredAt: new Date().toISOString(),
    syncedAt: null,
    ...patch,
  };
}

let detach: () => void = () => {};

beforeEach(() => {
  h.recorded = [];
  useHistoryStore.setState({ events: [], clientId: OWN });
  detach = installOutcomeBridge();
});

afterEach(() => {
  detach();
});

describe("isFreshOwnEvent", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();

  it.each([
    ["own, fresh", {}, true],
    ["another device", { clientId: "other" }, false],
    ["a squad guest's event", { squadProfileId: "sq-1" }, false],
    ["59 s old", { occurredAt: at(59_000) }, true],
    ["60 s old", { occurredAt: at(OUTCOME_MAX_AGE_MS) }, false],
    ["far in the future", { occurredAt: at(-120_000) }, false],
    ["unparseable time", { occurredAt: "soon" }, false],
  ] as const)("%s", (_label, patch, expected) => {
    expect(isFreshOwnEvent(event({ occurredAt: at(1000), ...patch }), OWN, now)).toBe(expected);
  });

  it("pays nothing before this browser has a client id", () => {
    expect(isFreshOwnEvent(event({ occurredAt: at(0) }), null, now)).toBe(false);
  });
});

describe("installOutcomeBridge", () => {
  it("records a fresh closed risk with its entity key and time", () => {
    const e = event();
    useHistoryStore.getState().addEvent(e);
    expect(h.recorded).toEqual([
      {
        id: "risk-closed",
        opts: {
          key: "risk:r1",
          at: e.occurredAt,
          meta: { toolId: "risk-register", action: "risk_updated" },
        },
      },
    ]);
  });

  it("ignores events that don't match an outcome", () => {
    useHistoryStore.getState().addEvent(event({ payload: { riskId: "r1", to: "mitigating" } }));
    useHistoryStore.getState().addEvent(event({ toolId: "retro", action: "card_added" }));
    expect(h.recorded).toEqual([]);
  });

  it("skips other devices, squad guests and stale events", () => {
    const store = useHistoryStore.getState();
    store.addEvent(event({ clientId: "other-device" }));
    store.addEvent(event({ squadProfileId: "guest-1" }));
    store.addEvent(event({ occurredAt: new Date(Date.now() - 61_000).toISOString() }));
    expect(h.recorded).toEqual([]);
  });

  it("never pays for what was in the log at install time", () => {
    detach();
    useHistoryStore.setState({ events: [event()] });
    detach = installOutcomeBridge();
    useHistoryStore.getState().addEvent(event({ toolId: "retro", action: "card_added" }));
    expect(h.recorded).toEqual([]);
  });

  it("never pays for fresh events that arrive by rehydration", async () => {
    // Another tab (or a restore) wrote a fresh, own, closed risk to storage.
    const stored = event({ payload: { riskId: "r-rehydrated", to: "closed" } });
    window.localStorage.setItem(
      "agile-toolkit:history",
      JSON.stringify({ state: { events: [stored], clientId: OWN }, version: 1 })
    );
    try {
      await useHistoryStore.persist.rehydrate();
      expect(useHistoryStore.getState().events.map((e) => e.id)).toContain(stored.id);
      expect(h.recorded).toEqual([]);
      // The bridge still pays for new work afterwards.
      useHistoryStore.getState().addEvent(event({ payload: { riskId: "r-new", to: "closed" } }));
      expect(h.recorded.map((r) => r.opts.key)).toEqual(["risk:r-new"]);
    } finally {
      window.localStorage.removeItem("agile-toolkit:history");
    }
  });

  it("handles each event once, even when the store changes again", () => {
    useHistoryStore.getState().addEvent(event());
    useHistoryStore.getState().markSynced([], new Date().toISOString());
    useHistoryStore.getState().addEvent(event({ toolId: "retro", action: "card_added" }));
    expect(h.recorded).toHaveLength(1);
  });

  it("records a batch from one change in log order", () => {
    useHistoryStore
      .getState()
      .addEvents([
        event({ payload: { riskId: "a", to: "closed" } }),
        event({ toolId: "tech-debt", action: "item_resolved", payload: { itemId: "d1" } }),
      ]);
    expect(h.recorded.map((r) => r.opts.key)).toEqual(["risk:a", "debt:d1"]);
  });

  it("falls back to h:<event id> when the payload has no entity id", () => {
    const e = event({ toolId: "planning-poker", action: "estimate_committed", payload: {} });
    useHistoryStore.getState().addEvent(e);
    expect(h.recorded[0]).toMatchObject({ id: "estimate-committed", opts: { key: `h:${e.id}` } });
  });
});

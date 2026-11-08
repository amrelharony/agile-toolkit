import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The XP ledger: caps, idempotency and the local-midnight rollover. The
 * engine is mocked so the ledger's own decisions are what's measured; the
 * engine round trip is covered by xp-values.test.ts.
 *
 * The clock is moved by swapping the global Date for a subclass whose "now"
 * the test sets (not fake timers).
 */

const h = vi.hoisted(() => ({
  awarded: [] as { amount: number; source: string; meta?: Record<string, unknown> }[],
  dispatched: [] as { name: string; meta?: Record<string, unknown> }[],
}));

vi.mock("@/lib/gamification/engine", () => ({
  awardXp: (amount: number, source: string, meta?: Record<string, unknown>) =>
    h.awarded.push({ amount, source, meta }),
  dispatch: (e: { name: string; meta?: Record<string, unknown> }) => h.dispatched.push(e),
}));

import {
  ingestEvent,
  ingestToolVisit,
  planOutcome,
  recordOutcome,
  subscribeOutcomes,
  type LedgerState,
  type OutcomeRecord,
} from "@/lib/gamification/ledger";
import { GLOBAL_DAILY_XP_CAP, getOutcome } from "@/lib/gamification/outcomes";
import { ONCE_KEYS_CAP } from "@/lib/gamification/vdna-migrate";
import { useVDnaStore } from "@/lib/stores/vdna-store";

// The engine and the ledger do nothing until the profile is read from storage.
beforeAll(async () => {
  await useVDnaStore.persist.rehydrate();
});

const RealDate = Date;
let nowMs = new RealDate(2026, 10, 8, 14, 0).getTime();
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs);
    else super(...(args as [number]));
  }
  static now() {
    return nowMs;
  }
}
function setClock(day: number, hour: number, minute = 0) {
  nowMs = new RealDate(2026, 10, day, hour, minute).getTime();
}

const empty = (): LedgerState => ({
  xpDay: { date: "", total: 0, byKey: {} },
  claims: {},
  onceKeys: [],
});

const xpTotal = () => h.awarded.reduce((n, a) => n + a.amount, 0);
const outcomeEvents = (id: string) => h.dispatched.filter((d) => d.name === `outcome:${id}`);

beforeEach(() => {
  vi.stubGlobal("Date", ShiftedDate);
  setClock(8, 14);
  h.awarded = [];
  h.dispatched = [];
  useVDnaStore.setState({
    xp: 0,
    xpDay: { date: "", total: 0, byKey: {} },
    claims: {},
    onceKeys: [],
    toolsVisited: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planOutcome (pure)", () => {
  it("pays the table's XP and counts it toward today's caps", () => {
    const plan = planOutcome(empty(), getOutcome("retro-finished"), { key: "retro:a" });
    expect(plan.result).toEqual({ awarded: true, xp: 40, reason: "awarded" });
    expect(plan.next?.xpDay).toEqual({
      date: "2026-11-08",
      total: 40,
      byKey: { "retro-finished": 1 },
    });
    expect(plan.next?.claims).toEqual({ "retro:a": expect.any(Number) });
    expect(plan.next?.onceKeys).toEqual([]);
  });

  it("rejects an unknown outcome without changing anything", () => {
    expect(planOutcome(empty(), undefined)).toEqual({
      result: { awarded: false, xp: 0, reason: "unknown" },
      next: null,
      capReached: false,
    });
  });

  it("keeps once-ever keys in onceKeys, the rest in 45-day claims", () => {
    const once = planOutcome(empty(), getOutcome("risk-closed"), { key: "risk:1" });
    expect(once.next?.onceKeys).toEqual(["risk:1"]);
    expect(once.next?.claims).toEqual({});
    const claimed = planOutcome(empty(), getOutcome("kudos-sent"), { key: "kudos:1" });
    expect(claimed.next?.onceKeys).toEqual([]);
    expect(Object.keys(claimed.next?.claims ?? {})).toEqual(["kudos:1"]);
  });

  it("adds the suggested-kudos bonus from meta", () => {
    const plan = planOutcome(empty(), getOutcome("kudos-sent"), { meta: { suggested: true } });
    expect(plan.result.xp).toBe(30);
  });

  it("prunes claims older than 45 days when it writes one", () => {
    const today = Math.round(Date.UTC(2026, 10, 8) / 86_400_000);
    const state = { ...empty(), claims: { old: today - 46, recent: today - 45 } };
    const plan = planOutcome(state, getOutcome("kudos-received"), { key: "kudos-in:x" });
    expect(Object.keys(plan.next?.claims ?? {}).sort()).toEqual(["kudos-in:x", "recent"]);
  });

  it("trims onceKeys to the cap, oldest first", () => {
    const keys = Array.from({ length: ONCE_KEYS_CAP }, (_, i) => `k${i}`);
    const plan = planOutcome({ ...empty(), onceKeys: keys }, getOutcome("first-tool"), {
      key: "tool:new",
    });
    expect(plan.next?.onceKeys).toHaveLength(ONCE_KEYS_CAP);
    expect(plan.next?.onceKeys.at(-1)).toBe("tool:new");
    expect(plan.next?.onceKeys[0]).toBe("k1");
  });

  it("never evicts a secret, first-tool or story key, however many entity keys follow", () => {
    let state: LedgerState = {
      ...empty(),
      onceKeys: ["secret:konami", "logo-whispered", "tool:retro", "story:12"],
    };
    for (let i = 0; i < ONCE_KEYS_CAP + 50; i++) {
      state = planOutcome(state, getOutcome("risk-closed"), { key: `risk:${i}` }).next ?? state;
    }
    expect(state.onceKeys).toHaveLength(ONCE_KEYS_CAP);
    for (const key of ["secret:konami", "logo-whispered", "tool:retro", "story:12"]) {
      expect(state.onceKeys, key).toContain(key);
    }
    expect(state.onceKeys).not.toContain("risk:0");
    expect(state.onceKeys.at(-1)).toBe(`risk:${ONCE_KEYS_CAP + 49}`);
    // So a secret found long ago still doesn't pay again.
    expect(planOutcome(state, getOutcome("secret"), { key: "secret:konami" }).result.reason).toBe(
      "duplicate"
    );
  });

  it("keeps committed estimates out of onceKeys (45-day claims)", () => {
    const plan = planOutcome(empty(), getOutcome("estimate-committed"), { key: "estimate:s1" });
    expect(plan.next?.onceKeys).toEqual([]);
    expect(Object.keys(plan.next?.claims ?? {})).toEqual(["estimate:s1"]);
  });
});

describe("recordOutcome: idempotency", () => {
  it("pays a key once and ignores the repeat entirely", () => {
    expect(recordOutcome("risk-closed", { key: "risk:r1" })).toEqual({
      awarded: true,
      xp: 30,
      reason: "awarded",
    });
    expect(recordOutcome("risk-closed", { key: "risk:r1" })).toEqual({
      awarded: false,
      xp: 0,
      reason: "duplicate",
    });
    expect(xpTotal()).toBe(30);
    // A repeat doesn't move badges or challenges either.
    expect(outcomeEvents("risk-closed")).toHaveLength(1);
  });

  it("still refuses a once-ever key on a later day", () => {
    recordOutcome("story-read", { key: "story:3" });
    setClock(20, 10);
    expect(recordOutcome("story-read", { key: "story:3" }).reason).toBe("duplicate");
    expect(xpTotal()).toBe(15);
  });

  it("doesn't pay a secret found before the ledger existed (seeded onceKeys)", () => {
    useVDnaStore.setState({ onceKeys: ["secret:konami"] });
    expect(recordOutcome("secret", { key: "secret:konami" }).reason).toBe("duplicate");
    expect(recordOutcome("secret", { key: "secret:typed-ship" }).xp).toBe(100);
  });

  it("awards outcome XP with its id in the XP event's meta", () => {
    recordOutcome("kudos-sent", { key: "kudos:k1", meta: { suggested: false } });
    expect(h.awarded).toEqual([
      {
        amount: 20,
        source: "outcome",
        meta: { suggested: false, outcomeId: "kudos-sent", key: "kudos:k1" },
      },
    ]);
    expect(outcomeEvents("kudos-sent")[0].meta).toMatchObject({
      outcomeId: "kudos-sent",
      xp: 20,
      capped: false,
    });
  });
});

describe("recordOutcome: caps", () => {
  it("stops paying an outcome at its daily cap but still dispatches it", () => {
    for (let i = 0; i < 7; i++) recordOutcome("card-done");
    expect(xpTotal()).toBe(50); // 5 × 10
    expect(outcomeEvents("card-done")).toHaveLength(7);
    expect(
      outcomeEvents("card-done")
        .slice(5)
        .map((d) => d.meta?.capped)
    ).toEqual([true, true]);
    expect(useVDnaStore.getState().xpDay.byKey["card-done"]).toBe(5);
  });

  it("shares one cap across every source of other-resolved", () => {
    const results = [
      "incident-commander:a",
      "vuln-burndown:b",
      "a11y-tracker:c",
      "ai-red-team:d",
      "hallucination-log:e",
      "retro-actions:f",
      "incident-commander:g",
    ].map((key) => recordOutcome("other-resolved", { key }).reason);
    expect(results.slice(0, 6).every((r) => r === "awarded")).toBe(true);
    expect(results[6]).toBe("outcome-cap");
  });

  it("claims a capped key so it can't pay tomorrow", () => {
    for (let i = 0; i < 5; i++) recordOutcome("risk-closed", { key: `risk:${i}` });
    expect(recordOutcome("risk-closed", { key: "risk:late" }).reason).toBe("outcome-cap");
    setClock(9, 9);
    expect(recordOutcome("risk-closed", { key: "risk:late" }).reason).toBe("duplicate");
  });

  it("holds outcome XP to 300 a day, trimming the outcome that crosses it", () => {
    const seen: OutcomeRecord[] = [];
    const off = subscribeOutcomes((r) => seen.push(r));
    // Mix outcomes up to 295 XP, each within its own cap.
    recordOutcome("sprint-closed", { key: "sprint:1" }); // 75
    recordOutcome("retro-finished", { key: "retro:1" }); // 115
    recordOutcome("retro-finished", { key: "retro:2" }); // 155
    recordOutcome("secret", { key: "secret:konami" }); // 255
    recordOutcome("premortem-completed"); // 295
    const crossing = recordOutcome("ceremony-finished"); // 25 → only 5 left
    expect(crossing).toEqual({ awarded: true, xp: 5, reason: "awarded" });
    const after = recordOutcome("okr-achieved");
    expect(after).toEqual({ awarded: false, xp: 0, reason: "global-cap" });
    expect(xpTotal()).toBe(GLOBAL_DAILY_XP_CAP);
    // Badges and challenges still move past the cap.
    expect(outcomeEvents("okr-achieved")).toHaveLength(1);
    // The inbox's one "Today's XP is full" row hangs off capReached.
    expect(seen.filter((r) => r.capReached).map((r) => r.id)).toEqual(["ceremony-finished"]);
    off();
  });

  it("rolls the day over at local midnight, not UTC", () => {
    setClock(8, 23, 59);
    for (let i = 0; i < 3; i++) recordOutcome("ceremony-finished");
    expect(recordOutcome("ceremony-finished").reason).toBe("outcome-cap");
    setClock(9, 0, 1);
    expect(recordOutcome("ceremony-finished").reason).toBe("awarded");
    expect(useVDnaStore.getState().xpDay).toEqual({
      date: "2026-11-09",
      total: 25,
      byKey: { "ceremony-finished": 1 },
    });
  });

  it("counts an outcome on the day it happened (`at`)", () => {
    setClock(9, 0, 0);
    recordOutcome("ceremony-finished", { at: new RealDate(2026, 10, 8, 23, 59, 50) });
    expect(useVDnaStore.getState().xpDay.date).toBe("2026-11-08");
  });

  it("is not reopened by a prestige reset", () => {
    for (let i = 0; i < 5; i++) recordOutcome("card-done");
    useVDnaStore.getState().prestigeReset();
    expect(recordOutcome("card-done").reason).toBe("outcome-cap");
  });

  it("returns unknown for an id that isn't in the table", () => {
    expect(recordOutcome("click")).toEqual({ awarded: false, xp: 0, reason: "unknown" });
    expect(h.dispatched).toEqual([]);
  });
});

describe("ingest helpers", () => {
  it("hands every event to the engine and records the ones that are outcomes", () => {
    ingestEvent("tool:retro:card-add");
    ingestEvent("tool:kanban:card-done", { toolId: "kanban", eventName: "card-done" });
    expect(h.dispatched.map((d) => d.name)).toEqual([
      "tool:retro:card-add",
      "tool:kanban:card-done",
      "outcome:card-done",
    ]);
    expect(xpTotal()).toBe(10);
  });

  it("keys a secret on its event name, so it pays once ever", () => {
    ingestEvent("secret:typed-agile");
    ingestEvent("secret:typed-agile");
    expect(xpTotal()).toBe(100);
    expect(useVDnaStore.getState().onceKeys).toContain("secret:typed-agile");
  });

  it("pays first-tool for a new tool only, never for one visited before", () => {
    useVDnaStore.setState({ toolsVisited: ["retro"] });
    ingestToolVisit("retro");
    expect(xpTotal()).toBe(0);
    ingestToolVisit("kanban");
    // The mocked engine doesn't record the visit; the once key still holds.
    ingestToolVisit("kanban");
    expect(xpTotal()).toBe(5);
    expect(h.dispatched.filter((d) => d.name === "tool-visit")).toHaveLength(3);
  });
});

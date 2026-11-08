import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, awardXp } from "@/lib/gamification/engine";
import { ingestEvent, ingestToolVisit, recordOutcome } from "@/lib/gamification/ledger";
import { achievements } from "@/lib/gamification/achievements";
import { todaySeedKey, weekSeedKey } from "@/lib/gamification/challenges";
import { useVDnaStore } from "@/lib/stores/vdna-store";

/**
 * What earns XP, end to end through the real engine and ledger. XP comes
 * only from outcomes (plus achievement and challenge rewards, which are
 * held out here by pre-unlocking every badge and completing today's
 * challenges). Own file: the engine keeps combo state at module level.
 *
 * The clock is a shifted Date subclass at midday, so "night owl" and
 * "early bird" stay out of the count.
 */

const RealDate = Date;
const NOW = new RealDate(2026, 9, 16, 13, 0, 0).getTime();
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [number]));
  }
  static now() {
    return NOW;
  }
}

beforeAll(() => vi.stubGlobal("Date", ShiftedDate));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  const done = (id: string, kind: "daily" | "weekly") => ({
    id,
    kind,
    progress: 1,
    goal: 1,
    xp: 0,
    completed: true,
    seedDate: kind === "daily" ? todaySeedKey() : weekSeedKey(),
  });
  useVDnaStore.setState({
    unlocked: achievements.map((a) => a.id),
    counters: {},
    xp: 0,
    lifetimeXp: 0,
    level: 1,
    prestige: 0,
    toolsVisited: [],
    dailyChallenges: [done("d-none", "daily")],
    weeklyChallenges: [done("w-none", "weekly")],
    recentEvents: [],
    xpDay: { date: "", total: 0, byKey: {} },
    claims: {},
    onceKeys: [],
  });
});

const xp = () => useVDnaStore.getState().xp;

describe("XP for raw input", () => {
  it("awards nothing for clicks, hovers, keys, scrolls or session minutes", () => {
    useVDnaStore.setState({ unlocked: ["first-click"] });
    for (let i = 0; i < 20; i++) {
      dispatch({ name: "click" });
      dispatch({ name: "hover" });
      dispatch({ name: "key" });
      dispatch({ name: "scroll-floor" });
      dispatch({ name: "session-minute" });
    }
    const { unlocked } = useVDnaStore.getState();
    expect(useVDnaStore.getState().recentEvents.filter((e) => e.source !== "achievement")).toEqual(
      []
    );
    expect(unlocked).not.toContain("combo-3");
    expect(unlocked).not.toContain("combo-5");
  });

  it("awards nothing for exports, toggles or the old 5-XP tool events", () => {
    for (const name of [
      "export-png",
      "export-csv",
      "theme-toggle",
      "sonification-on",
      "prompt-copied",
      "workspace-push",
      "tool:retro:card-add",
      "tool:planning-poker:vote",
      "tool:kanban:card-move",
      "tool:kudos:reaction-added",
      "tool:kudos:thread-reply",
      "tool:kudos:llm-suggested-pick",
      "tool:kudos:sent",
      "tool:kudos:received",
      "tool:comics:completed",
      "tool:impediments:impediment-resolved",
    ]) {
      ingestEvent(name);
    }
    expect(xp()).toBe(0);
  });

  it("pays nothing for a repeat visit; a first visit to a tool pays once", () => {
    ingestToolVisit("kanban");
    ingestToolVisit("velocity");
    ingestToolVisit("kanban");
    ingestToolVisit("velocity");
    expect(xp()).toBe(10);
    expect(useVDnaStore.getState().toolsVisited).toEqual(["kanban", "velocity"]);
  });
});

describe("XP for outcomes", () => {
  it("pays a tool's outcome event through the ledger", () => {
    ingestEvent("tool:kanban:card-done");
    expect(xp()).toBe(10);
    expect(useVDnaStore.getState().recentEvents[0]).toMatchObject({
      amount: 10,
      source: "outcome",
      multiplier: 1,
      meta: { outcomeId: "card-done" },
    });
  });

  it("has no combo multiplier: rapid outcomes pay face value", () => {
    for (let i = 0; i < 5; i++) ingestEvent("tool:kanban:card-done");
    expect(xp()).toBe(50);
    expect(useVDnaStore.getState().recentEvents.every((e) => e.multiplier === 1)).toBe(true);
  });

  it("has no combo multiplier on achievement or challenge rewards either", () => {
    for (let i = 0; i < 4; i++) dispatch({ name: "tool:retro:card-add" });
    awardXp(100, "achievement", {});
    expect(xp()).toBe(100);
  });

  it("caps outcome XP at 300 a day", () => {
    for (let i = 0; i < 10; i++) recordOutcome("secret", { key: `secret:test-${i}` });
    expect(xp()).toBe(300);
    expect(useVDnaStore.getState().xpDay.total).toBe(300);
  });

  it("moves level with outcome XP", () => {
    recordOutcome("sprint-closed", { key: "sprint:a" });
    recordOutcome("secret", { key: "secret:konami" });
    expect(xp()).toBe(175);
    expect(useVDnaStore.getState().level).toBeGreaterThan(1);
  });
});

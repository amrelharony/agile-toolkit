import { describe, expect, it } from "vitest";
import { icebreakers } from "@/lib/constants/icebreakers";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import { blankRetroBoard } from "@/lib/retro/board";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import { createRng } from "@/lib/utils/random";
import {
  CLOSING_ACTIVITY_IDS,
  OPENING_ACTIVITY_IDS,
  formatsFromBoards,
  recentFormatIds,
  retroActivities,
  retroActivity,
  surpriseCandidates,
  surpriseFormatInput,
  surprisePlan,
  surpriseSprintInput,
  withPlanFormat,
} from "@/lib/retro/surprise";

/**
 * "Surprise me" (lib/retro/surprise): a format none of the last three
 * retros used, an opening and a closing read from the Ice Breaker by id, a
 * shuffle that changes the pick, and the inputs Amr's task takes.
 */

const fmt = (id: string) => retroFormats.find((f) => f.id === id)!;
const archived = (formatId: string, daysAgo: number, format?: RetroFormat): RetroBoard => ({
  ...blankRetroBoard(format ?? fmt(formatId)),
  id: `retro:${daysAgo}`,
  archivedAt: new Date(Date.UTC(2026, 10, 30 - daysAgo)).toISOString(),
});

describe("the activities", () => {
  it("are all the Ice Breaker's own, named by id, none copied", () => {
    const ids = new Set(icebreakers.map((i) => i.id));
    for (const id of [...OPENING_ACTIVITY_IDS, ...CLOSING_ACTIVITY_IDS])
      expect(ids.has(id), id).toBe(true);
    const opening = retroActivity("q-7", "opening")!;
    const ib = icebreakers.find((i) => i.id === "q-7")!;
    expect(opening).toMatchObject({ name: ib.name, line: ib.description, minutes: ib.timeMinutes });
  });

  it("frames a check-in as a check-out when it closes, in our own words", () => {
    expect(retroActivity("q-7", "closing")!.line).toMatch(/^As a check-out/);
    expect(retroActivity("a-7", "closing")!.line).toBe(
      icebreakers.find((i) => i.id === "a-7")!.description
    );
  });

  it("offers only the ids each role lists", () => {
    expect(retroActivity("a-7", "opening")).toBeNull();
    expect(retroActivity("g-1", "closing")).toBeNull();
    expect(retroActivities("opening")).toHaveLength(OPENING_ACTIVITY_IDS.length);
  });
});

describe("the formats", () => {
  it("knows the last three retros' formats, newest first, once each", () => {
    const boards = [
      archived("sailboat", 1),
      archived("4ls", 3),
      archived("sailboat", 5),
      archived("mad-sad-glad", 7),
      archived("daki", 9),
      { ...blankRetroBoard(fmt("start-stop-continue")), id: "retro:current" },
    ];
    expect(recentFormatIds(boards)).toEqual(["sailboat", "4ls"]);
    expect(recentFormatIds(boards, 4)).toEqual(["sailboat", "4ls", "mad-sad-glad"]);
  });

  it("finds the team's own formats on past boards, never a built-in one", () => {
    const custom: RetroFormat = {
      id: "custom-abc",
      name: "Our format",
      description: "",
      columns: [{ key: "good", label: "Good", color: "#00f0ff", icon: "" }],
    };
    const found = formatsFromBoards([
      archived("x", 1, custom),
      archived("x", 2, custom),
      archived("4ls", 3),
    ]);
    expect(found.map((f) => f.id)).toEqual(["custom-abc"]);
  });

  it("leaves the recent ones out, unless that leaves none", () => {
    const two = [fmt("sailboat"), fmt("4ls")];
    expect(surpriseCandidates(two, ["sailboat"]).map((f) => f.id)).toEqual(["4ls"]);
    expect(surpriseCandidates(two, ["sailboat", "4ls"]).map((f) => f.id)).toEqual([
      "sailboat",
      "4ls",
    ]);
    expect(surpriseCandidates([...two, fmt("4ls")], []).map((f) => f.id)).toEqual([
      "sailboat",
      "4ls",
    ]);
  });
});

describe("a surprise plan", () => {
  it("never picks a format the last three retros used, over many seeds", () => {
    const recent = ["start-stop-continue", "4ls", "sailboat"];
    for (let seed = 0; seed < 60; seed++) {
      const plan = surprisePlan({ formats: retroFormats, recent, rng: createRng(seed) })!;
      expect(recent).not.toContain(plan.format.id);
      expect(plan.opening.role).toBe("opening");
      expect(plan.closing.role).toBe("closing");
      expect(plan.closing.id).not.toBe(plan.opening.id);
      expect(plan.avoided.sort()).toEqual([...recent].sort());
    }
  });

  it("is the same for the same seed, and Shuffle again changes the format", () => {
    const a = surprisePlan({ formats: retroFormats, recent: [], rng: createRng("s") })!;
    const b = surprisePlan({ formats: retroFormats, recent: [], rng: createRng("s") })!;
    expect(b).toEqual(a);
    for (let seed = 0; seed < 20; seed++) {
      const again = surprisePlan({
        formats: retroFormats,
        recent: [],
        rng: createRng(seed),
        previous: a,
      })!;
      expect(again.format.id).not.toBe(a.format.id);
    }
  });

  it("is null with no format, and takes Amr's pick only from the formats it has", () => {
    expect(surprisePlan({ formats: [], recent: [] })).toBeNull();
    const plan = surprisePlan({ formats: retroFormats, recent: [], rng: createRng(1) })!;
    expect(withPlanFormat(plan, retroFormats, "daki")!.format.id).toBe("daki");
    expect(withPlanFormat(plan, retroFormats, "nope")).toBeNull();
  });
});

describe("what Amr reads", () => {
  it("takes the numbers the format suggestion reads, and the fact lines capped", () => {
    const input = surpriseSprintInput(
      {
        sprintName: "Sprint 9",
        goalOutcome: { met: "partly", decidedAt: "2026-11-01" },
        committed: 30,
        completed: 21,
        sayDo: { ratio: 0.7, pct: 70, grade: "missed", score: 0.7 },
        mood: { average: 2.1, checkIns: 6, people: 3 },
      },
      true,
      Array.from({ length: 20 }, (_, i) => `Fact ${i} ${"x".repeat(400)}`)
    );
    expect(input).toMatchObject({
      name: "Sprint 9",
      goal: "partly",
      sayDo: "missed",
      mood: 2.1,
      ended: true,
    });
    expect(input.facts).toHaveLength(12);
    expect(input.facts[0]).toHaveLength(300);
    const none = surpriseSprintInput(
      {
        sprintName: "S",
        goalOutcome: null,
        committed: 0,
        completed: 0,
        sayDo: null,
        mood: { average: null, checkIns: 0, people: 0 },
      },
      false
    );
    expect(none).toMatchObject({ goal: "unknown", sayDo: "unknown", mood: null, facts: [] });
  });

  it("names a format by id, name, description and its columns' labels", () => {
    expect(surpriseFormatInput(fmt("sailboat"))).toEqual({
      id: "sailboat",
      name: "Sailboat",
      description: fmt("sailboat").description,
      columns: ["Anchor", "Wind", "Rocks", "Island"],
    });
  });
});

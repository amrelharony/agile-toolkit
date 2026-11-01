// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summariseEntries } from "@/lib/comics/entries-summary";
import {
  checkReorder,
  nextMondaySlot,
  queueWeeksLeft,
  releaseSlot,
  scheduleQueue,
  swapInQueue,
  unreleasedWeekly,
} from "@/lib/comics/queue";
import {
  nextWeeklyEp,
  parseStoryFields,
  publishProblems,
  storyState,
  type OwnerStory,
} from "@/lib/comics/story-input";

const ART = "00000000-0000-4000-8000-000000000001.webp";

function story(ep: number, releaseAt: string | null = null, alt = "Shown."): OwnerStory {
  return {
    ep,
    collection: ep <= 26 ? "book" : "weekly",
    sourceId: null,
    title: `Story ${ep}`,
    lesson: "",
    squadQuestion: "",
    castNames: [],
    themes: [],
    panels: [
      {
        pathFull: ART,
        pathSmall: ART,
        width: 10,
        height: 10,
        alt,
        dialogue: [],
        signs: [],
        needsReview: false,
        creditCorner: "bottom-right",
      },
    ],
    sharePath: ART,
    bookPage: null,
    releaseAt,
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

const NOW = Date.parse("2026-11-02T12:00:00Z");

describe("schedule dates", () => {
  it("gives 27 to 30 the launch date, then one per Monday at 07:00 UTC in number order", () => {
    // 12 Nov 2026 is a Thursday.
    const plan = scheduleQueue([33, 27, 28, 29, 30, 31, 32], "2026-11-12");
    expect(plan).toEqual([
      { ep: 27, releaseAt: "2026-11-12T07:00:00.000Z" },
      { ep: 28, releaseAt: "2026-11-12T07:00:00.000Z" },
      { ep: 29, releaseAt: "2026-11-12T07:00:00.000Z" },
      { ep: 30, releaseAt: "2026-11-12T07:00:00.000Z" },
      { ep: 31, releaseAt: "2026-11-16T07:00:00.000Z" },
      { ep: 32, releaseAt: "2026-11-23T07:00:00.000Z" },
      { ep: 33, releaseAt: "2026-11-30T07:00:00.000Z" },
    ]);
  });

  it("leaves a full week after a launch on a Monday", () => {
    const plan = scheduleQueue([30, 31], "2026-11-16")!;
    expect(plan[1].releaseAt).toBe("2026-11-23T07:00:00.000Z");
  });

  it("every date after launch is a Monday, across a month and a year end", () => {
    const eps = Array.from({ length: 100 }, (_, i) => 27 + i);
    const plan = scheduleQueue(eps, "2026-12-30")!;
    expect(plan).toHaveLength(100);
    for (const item of plan.slice(4)) {
      const date = new Date(item.releaseAt);
      expect(date.getUTCDay()).toBe(1);
      expect(date.getUTCHours()).toBe(7);
    }
    const last = plan[99].releaseAt;
    expect(last).toBe("2028-10-30T07:00:00.000Z");
  });

  it.each(["", "2026-13-01", "2026-02-30", "next week"])("refuses %j", (date) => {
    expect(scheduleQueue([27], date)).toBeNull();
    expect(releaseSlot(date)).toBeNull();
  });

  it("finds the next slot strictly after a moment", () => {
    const monday0659 = new Date("2026-11-02T06:59:00Z");
    expect(nextMondaySlot(monday0659).toISOString()).toBe("2026-11-02T07:00:00.000Z");
    const monday0700 = new Date("2026-11-02T07:00:00Z");
    expect(nextMondaySlot(monday0700).toISOString()).toBe("2026-11-09T07:00:00.000Z");
  });
});

describe("how long the queue lasts", () => {
  const week = 7 * 86_400_000;
  const inWeeks = (n: number) => new Date(NOW + n * week + 3600_000).toISOString();

  it("counts whole weeks to the last scheduled story", () => {
    expect(queueWeeksLeft([story(27, inWeeks(1)), story(28, inWeeks(6))], NOW)).toBe(6);
  });

  it("is 0 with nothing ahead, and ignores drafts and the book", () => {
    expect(queueWeeksLeft([story(27)], NOW)).toBe(0);
    expect(queueWeeksLeft([story(27, "2026-01-01T00:00:00Z")], NOW)).toBe(0);
    expect(queueWeeksLeft([story(3, inWeeks(9))], NOW)).toBe(0);
  });

  it("lists unreleased weekly stories in number order", () => {
    const list = unreleasedWeekly(
      [story(31), story(3), story(30, inWeeks(1)), story(27, "2026-01-01T00:00:00Z")],
      NOW
    );
    expect(list.map((s) => s.ep)).toEqual([30, 31]);
  });
});

describe("reorder rules", () => {
  it("accepts a reordering of queued stories, slots ascending", () => {
    const check = checkReorder([story(30), story(31), story(32)], [32, 30, 31], NOW);
    expect(check).toEqual({ ok: true, slots: [30, 31, 32], order: [32, 30, 31] });
  });

  it("never lets a released number move", () => {
    const check = checkReorder([story(30, "2026-01-01T00:00:00Z"), story(31)], [31, 30], NOW);
    expect(check).toEqual({ ok: false, error: "not_in_queue", ep: 30 });
  });

  it("refuses an unknown number", () => {
    expect(checkReorder([story(30)], [30, 99], NOW)).toMatchObject({ ok: false, ep: 99 });
  });

  it("swaps with a neighbour, and stops at the ends", () => {
    expect(swapInQueue([30, 31, 32], 31, -1)).toEqual([31, 30, 32]);
    expect(swapInQueue([30, 31, 32], 30, -1)).toBeNull();
    expect(swapInQueue([30, 31, 32], 32, 1)).toBeNull();
    expect(swapInQueue([30, 31], 99, 1)).toBeNull();
  });
});

describe("story fields", () => {
  it("drops unknown keys rather than saving them", () => {
    const parsed = parseStoryFields({ title: "A", research_refs: ["CA1"], release_at: "x" });
    expect(parsed).toEqual({ ok: true, fields: { title: "A" } });
  });

  it("drops anything unknown inside a panel", () => {
    const parsed = parseStoryFields({
      panels: [{ alt: "Shown", continuity: ["private"], framing: "wide" }],
    });
    expect(parsed.ok && parsed.fields.panels?.[0]).not.toHaveProperty("continuity");
    expect(parsed.ok && parsed.fields.panels?.[0]).not.toHaveProperty("framing");
  });

  it("strips control characters", () => {
    expect(parseStoryFields({ title: "A\u0000B" })).toEqual({ ok: true, fields: { title: "AB" } });
  });

  it("refuses half-uploaded art", () => {
    expect(parseStoryFields({ panels: [{ pathFull: ART, pathSmall: "" }] }).ok).toBe(false);
  });

  it.each([{ themes: ["T99"] }, { themes: ["constructor"] }, { bookPage: 0 }, { sourceId: 7 }])(
    "refuses %j",
    (body) => {
      expect(parseStoryFields(body).ok).toBe(false);
    }
  );

  it.each([null, [], "x"])("refuses a body of %j", (body) => {
    expect(parseStoryFields(body).ok).toBe(false);
  });

  it("says everything that blocks publishing", () => {
    const panel = story(27).panels[0];
    expect(
      publishProblems({
        title: " ",
        panels: [
          { ...panel, alt: "" },
          { ...panel, pathFull: "", pathSmall: "" },
        ],
      })
    ).toEqual(["Add a title.", "Panel 1 has no description.", "Panel 2 has no art."]);
    expect(publishProblems({ title: "A", panels: [] })).toEqual(["Add at least one panel."]);
    expect(publishProblems(story(27))).toEqual([]);
  });

  it("tells a draft, a scheduled story and a released one apart", () => {
    expect(storyState(null, NOW)).toBe("draft");
    expect(storyState("2099-01-01T00:00:00Z", NOW)).toBe("scheduled");
    expect(storyState("2026-01-01T00:00:00Z", NOW)).toBe("released");
  });

  it("numbers a new weekly story after everything, starting at 27", () => {
    expect(nextWeeklyEp([])).toBe(27);
    expect(nextWeeklyEp([1, 26])).toBe(27);
    expect(nextWeeklyEp([27, 126])).toBe(127);
  });
});

describe("entries summary", () => {
  it("skips a count it can't read", () => {
    const summary = summariseEntries([
      { day: "2026-11-02", entry: "direct", ep: 0, building: 0, count: "not a number" },
      { day: "2026-11-02", entry: "direct", ep: 0, building: 0, count: 2 },
    ]);
    expect(summary.total).toBe(2);
  });
});

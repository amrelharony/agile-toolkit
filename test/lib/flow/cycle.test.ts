/**
 * lib/flow cycle time: one day convention for every tool.
 *
 *   - cycleDays counts whole local days, both ends: same day = 1, an
 *     evening start and a next-morning finish = 2, a UTC-evening stamp on
 *     its local day;
 *   - finishedItems keeps done items with a start, in order of completion,
 *     within a range;
 *   - cycleSummary uses the shared nearest-rank percentile and a population
 *     spread;
 *   - ageingWip lists the active items, oldest first, flagged against P85.
 */

import { describe, expect, it } from "vitest";
import {
  ageingWip,
  cardItems,
  cycleDays,
  cycleSummary,
  finishedItems,
  storyItems,
  type FlowItem,
} from "@/lib/flow";
import { movedCard } from "@/lib/kanban/flow";
import { percentile } from "@/lib/sprints/metrics";
import { card, local, localYmd, story } from "./fixtures";

/** A hand-built item, for the cases the builders don't reach. */
const item = (id: string, patch: Partial<FlowItem> = {}): FlowItem => ({
  id,
  title: `Item ${id}`,
  kind: "card",
  stage: "in_progress",
  arrivedOn: "2026-10-01",
  startedOn: null,
  doneOn: null,
  moves: [],
  basis: "history",
  blocked: false,
  ...patch,
});

describe("cycleDays", () => {
  it("counts a same-day item as 1 day and both ends of a longer one", () => {
    expect(cycleDays(local("2026-10-20", 0, 30), local("2026-10-20", 23, 30))).toBe(1);
    // An hour apart, but over midnight: two calendar days.
    expect(cycleDays(local("2026-10-20", 23, 30), local("2026-10-21", 0, 30))).toBe(2);
    expect(cycleDays("2026-10-01", "2026-10-05")).toBe(5);
    expect(cycleDays("2026-10-01", local("2026-10-05", 8))).toBe(5);
  });

  it("buckets UTC timestamps by their local day", () => {
    const start = "2026-10-20T01:00:00.000Z";
    const end = "2026-10-20T22:30:00.000Z";
    const days = (a: string, b: string) =>
      (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
        Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) /
        86_400_000 +
      1;
    expect(cycleDays(start, end)).toBe(days(localYmd(start), localYmd(end)));
  });

  it("is null when a day is missing or invalid, or the end comes first", () => {
    expect(cycleDays(null, "2026-10-05")).toBeNull();
    expect(cycleDays("2026-10-05", undefined)).toBeNull();
    expect(cycleDays("not a date", "2026-10-05")).toBeNull();
    expect(cycleDays("2026-10-05", "2026-10-04")).toBeNull();
  });
});

describe("finishedItems", () => {
  const items = [
    ...storyItems([
      story("late", {
        status: "done",
        startedAt: local("2026-10-02"),
        doneAt: local("2026-10-09"),
      }),
      story("open", { status: "review", startedAt: local("2026-10-02") }),
    ]),
    ...cardItems([
      movedCard(
        movedCard(card("early", { column: "ready" }), "in_progress", local("2026-10-03")),
        "done",
        local("2026-10-03", 18)
      ),
      // Dropped straight into Done: no start, so no cycle time.
      movedCard(card("dropped", { column: "ready" }), "done", local("2026-10-04")),
    ]),
  ];

  it("keeps the done items with a start, in order of completion", () => {
    expect(finishedItems(items)).toEqual([
      {
        id: "early",
        title: "Card early",
        kind: "card",
        startedOn: "2026-10-03",
        doneOn: "2026-10-03",
        days: 1,
      },
      {
        id: "late",
        title: "Story late",
        kind: "story",
        startedOn: "2026-10-02",
        doneOn: "2026-10-09",
        days: 8,
      },
    ]);
  });

  it("keeps only those done within the range, both ends included", () => {
    expect(finishedItems(items, { from: "2026-10-04" }).map((f) => f.id)).toEqual(["late"]);
    expect(finishedItems(items, { to: "2026-10-03" }).map((f) => f.id)).toEqual(["early"]);
    expect(finishedItems(items, { from: "2026-10-03", to: "2026-10-09" })).toHaveLength(2);
    expect(finishedItems(items, { from: "2026-10-10" })).toEqual([]);
    expect(finishedItems([])).toEqual([]);
  });

  it("drops a reopened item, whose done stamp no longer counts", () => {
    const reopened = movedCard(
      movedCard(
        card("r", { column: "in_progress", startedAt: local("2026-10-01") }),
        "done",
        local("2026-10-02")
      ),
      "review",
      local("2026-10-03")
    );
    expect(finishedItems(cardItems([reopened]))).toEqual([]);
  });
});

describe("cycleSummary", () => {
  it("is empty without days", () => {
    expect(cycleSummary([])).toEqual({
      count: 0,
      average: null,
      median: null,
      p85: null,
      p95: null,
      spread: null,
    });
  });

  it("takes the percentiles from the shared nearest-rank percentile and a population spread", () => {
    const days = [10, 1, 3, 2, 4];
    expect(cycleSummary(days)).toEqual({
      count: 5,
      average: 4,
      median: 3,
      p85: 10,
      p95: 10,
      spread: Math.sqrt(10),
    });
    expect(cycleSummary(days).p85).toBe(percentile(days, 85));
    expect(cycleSummary([2, Number.NaN, 4]).count).toBe(2);
    expect(cycleSummary([7])).toMatchObject({ count: 1, average: 7, p85: 7, spread: 0 });
  });
});

describe("ageingWip", () => {
  const items = [
    item("young", { startedOn: "2026-10-20", owner: "Ben" }),
    item("old", { stage: "review", startedOn: "2026-10-10", blocked: true }),
    item("queued", { stage: "ready" }),
    item("done", { stage: "done", startedOn: "2026-10-01", doneOn: "2026-10-05" }),
    item("mid", { kind: "story", startedOn: "2026-10-15" }),
    // No start: aged from the day it entered its stage.
    item("unstarted", { moves: [{ to: "in_progress", from: "ready", at: local("2026-10-18") }] }),
  ];

  it("lists the active items oldest first, aged like a cycle time", () => {
    const ageing = ageingWip(items, "2026-10-20", 7);
    expect(ageing.map((a) => [a.id, a.ageDays])).toEqual([
      ["old", 11],
      ["mid", 6],
      ["unstarted", 3],
      ["young", 1],
    ]);
    expect(ageing[0]).toEqual({
      id: "old",
      title: "Item old",
      kind: "card",
      stage: "review",
      startedOn: "2026-10-10",
      ageDays: 11,
      overP85: true,
      blocked: true,
    });
    expect(ageing.map((a) => a.overP85)).toEqual([true, false, false, false]);
    expect(ageing[3].owner).toBe("Ben");
  });

  it("flags nothing without a P85, and nothing without a valid today", () => {
    expect(ageingWip(items, "2026-10-20", null).every((a) => a.overP85 === null)).toBe(true);
    expect(ageingWip(items, "someday", 7)).toEqual([]);
    expect(ageingWip([], "2026-10-20", 7)).toEqual([]);
    // A start dated after today (another device's clock) has just started.
    expect(ageingWip([item("x", { startedOn: "2026-10-21" })], "2026-10-20", 7)[0].ageDays).toBe(1);
  });
});

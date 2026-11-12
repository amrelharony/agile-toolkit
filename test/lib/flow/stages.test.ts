/**
 * lib/flow stages: cycle time by stage.
 *
 *   - an item's time in each stage over its cycle, from its recorded moves,
 *     in elapsed days that add up to the time it took;
 *   - the cycle starts at the last attempt (back to a queue starts afresh),
 *     and a stint in Done before a reopen stays in it;
 *   - items placed from stamps alone are counted apart, never guessed;
 *   - each stage's median and P85 wait for 5 items, its share doesn't;
 *   - flow efficiency waits for 3 items and for active and waiting time to
 *     be told apart, by the statuses the person marks.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAITING,
  cardItems,
  cleanStageIds,
  itemEfficiency,
  itemStageTimes,
  stageBreakdown,
  stageDuration,
  stageSentence,
  storyItems,
  type FlowItem,
} from "@/lib/flow";
import { momentOf } from "@/lib/flow/stages";
import type { Story, StoryStatus } from "@/lib/stores/workspace-types";
import { card, local, story } from "./fixtures";

/*
 * Every day here is in July 2026, a month no time zone changes its clocks
 * in, so the elapsed days come out whole on any machine.
 */

/**
 * A story moved through `steps` ([status, day, hour]) from To do, with the
 * stamps setStoryStatus writes: the start of the last attempt, the done.
 */
function moved(id: string, steps: [StoryStatus, string, number][]): Story {
  let from: StoryStatus = "todo";
  let startedAt: string | undefined;
  let doneAt: string | undefined;
  const statusHistory = [{ status: "todo" as StoryStatus, at: local("2026-07-01", 9) }];
  for (const [status, day, hour] of steps) {
    const at = local(day, hour);
    statusHistory.push({ status, from, at } as (typeof statusHistory)[number]);
    if (status === "todo" || status === "backlog") startedAt = undefined;
    else if (!startedAt) startedAt = at;
    doneAt = status === "done" ? at : undefined;
    from = status;
  }
  return {
    ...story(id),
    status: from,
    statusHistory,
    ...(startedAt ? { startedAt } : {}),
    ...(doneAt ? { doneAt } : {}),
  };
}

const items = (stories: Story[]) => storyItems(stories);
const one = (s: Story) => itemStageTimes(items([s])[0]);

describe("itemStageTimes", () => {
  it("splits the cycle into the stages it was in, in elapsed days", () => {
    const t = one(
      moved("a", [
        ["in_progress", "2026-07-05", 9],
        ["review", "2026-07-07", 9],
        ["done", "2026-07-08", 21],
      ])
    );
    expect(t).not.toBeNull();
    expect(t!.stages.map((s) => s.stage)).toEqual(["in_progress", "review"]);
    expect(t!.stages[0].days).toBeCloseTo(2, 5);
    expect(t!.stages[1].days).toBeCloseTo(1.5, 5);
    expect(t!.elapsedDays).toBeCloseTo(3.5, 5);
    // The cycle time keeps its whole-day count: 5th to 8th, both counted.
    expect(t!.cycleDays).toBe(4);
    expect(t!.startedOn).toBe("2026-07-05");
    expect(t!.doneOn).toBe("2026-07-08");
  });

  it("adds up time spent going back and forth between active stages", () => {
    const t = one(
      moved("b", [
        ["in_progress", "2026-07-05", 9],
        ["review", "2026-07-06", 9],
        ["in_progress", "2026-07-06", 21],
        ["review", "2026-07-07", 9],
        ["done", "2026-07-07", 21],
      ])
    );
    expect(t!.stages.find((s) => s.stage === "in_progress")!.days).toBeCloseTo(1.5, 5);
    expect(t!.stages.find((s) => s.stage === "review")!.days).toBeCloseTo(1, 5);
  });

  it("starts at the last attempt: a move back to To do starts the cycle afresh", () => {
    const t = one(
      moved("c", [
        ["in_progress", "2026-07-02", 9],
        ["todo", "2026-07-03", 9],
        ["in_progress", "2026-07-06", 9],
        ["done", "2026-07-07", 9],
      ])
    );
    expect(t!.startedOn).toBe("2026-07-06");
    expect(t!.stages).toEqual([{ stage: "in_progress", days: 1 }]);
  });

  it("keeps a stint in Done before a reopen in the cycle", () => {
    const t = one(
      moved("d", [
        ["in_progress", "2026-07-05", 9],
        ["done", "2026-07-06", 9],
        ["in_progress", "2026-07-08", 9],
        ["done", "2026-07-08", 21],
      ])
    );
    expect(t!.stages.map((s) => [s.stage, s.days])).toEqual([
      ["in_progress", 1.5],
      ["done", 2],
    ]);
  });

  it("reads nothing for work not finished, dropped straight into Done, or placed from stamps", () => {
    expect(one(moved("e", [["in_progress", "2026-07-05", 9]]))).toBeNull();
    // To do straight to Done: no start, so no cycle (it still counts as throughput).
    expect(one(moved("f", [["done", "2026-07-05", 9]]))).toBeNull();
    // A story from before the history was kept: its stages would be a guess.
    const stamped = {
      ...story("g"),
      status: "done" as const,
      startedAt: local("2026-07-01"),
      doneAt: local("2026-07-04"),
    };
    expect(items([stamped])[0].basis).toBe("stamps");
    expect(one(stamped)).toBeNull();
  });

  it("reads Flow-board cards from their column history", () => {
    const c = card("k1", {
      column: "done",
      createdAt: local("2026-07-01", 9),
      startedAt: local("2026-07-05", 9),
      completedAt: local("2026-07-09", 9),
      history: [
        { column: "ready", from: "backlog", at: local("2026-07-02", 9) },
        { column: "in_progress", from: "ready", at: local("2026-07-05", 9) },
        { column: "review", from: "in_progress", at: local("2026-07-06", 9) },
        { column: "done", from: "review", at: local("2026-07-09", 9) },
      ],
    });
    const t = itemStageTimes(cardItems([c])[0]);
    // Ready came before the start: it isn't part of the cycle.
    expect(t!.stages.map((s) => [s.stage, s.days])).toEqual([
      ["in_progress", 1],
      ["review", 3],
    ]);
    expect(t!.kind).toBe("card");
  });

  it("times a plain date from a date-only write from local midnight", () => {
    expect(momentOf("2026-07-05")).toBe(new Date(2026, 6, 5).getTime());
    expect(momentOf("not a date")).toBeNull();
  });
});

describe("stageBreakdown", () => {
  /** Five items: In progress 1–5 days, Review 2 days each. */
  const five = Array.from({ length: 5 }, (_, i) =>
    moved(`s${i}`, [
      ["in_progress", "2026-07-05", 9],
      ["review", `2026-07-${String(6 + i).padStart(2, "0")}`, 9],
      ["done", `2026-07-${String(8 + i).padStart(2, "0")}`, 9],
    ])
  );

  it("quotes each stage's median and P85 from 5 items, and its share of the time", () => {
    const b = stageBreakdown(items(five));
    expect(b.items).toHaveLength(5);
    const progress = b.stages.find((s) => s.stage === "in_progress")!;
    const review = b.stages.find((s) => s.stage === "review")!;
    expect(progress.items).toBe(5);
    expect(progress.median).toBeCloseTo(3, 5);
    expect(progress.p85).toBeCloseTo(5, 5);
    expect(review.median).toBeCloseTo(2, 5);
    // 15 days in progress, 10 in review.
    expect(progress.share).toBeCloseTo(60, 5);
    expect(review.share).toBeCloseTo(40, 5);
    expect(b.totalDays).toBeCloseTo(25, 5);
  });

  it("waits for 5 items before a median, but gives the share from the first", () => {
    const b = stageBreakdown(items(five.slice(0, 4)));
    expect(b.stages.every((s) => s.median === null && s.p85 === null)).toBe(true);
    expect(b.stages.every((s) => s.share !== null)).toBe(true);
  });

  it("can't tell flow efficiency until a status that holds time is marked waiting", () => {
    // By default only the queues wait, and none of them is in a cycle here.
    expect(DEFAULT_WAITING).toEqual(["backlog", "todo", "ready", "done"]);
    const b = stageBreakdown(items(five));
    expect(b.efficiency).toMatchObject({ pct: null, reason: "one_kind" });
    const marked = stageBreakdown(items(five), { waiting: ["review"] });
    expect(marked.efficiency.reason).toBe("ok");
    expect(marked.efficiency.pct).toBe(60);
    expect(marked.efficiency.waitingDays).toBeCloseTo(10, 5);
    expect(marked.stages.find((s) => s.stage === "review")!.waiting).toBe(true);
    // Everything marked waiting: no active time to compare with.
    const all = stageBreakdown(items(five), { waiting: ["in_progress", "review"] });
    expect(all.efficiency.reason).toBe("one_kind");
  });

  it("waits for 3 items before a flow efficiency", () => {
    const b = stageBreakdown(items(five.slice(0, 2)), { waiting: ["review"] });
    expect(b.efficiency).toMatchObject({ pct: null, reason: "not_enough" });
  });

  it("counts items placed from stamps apart, and keeps a range of done days", () => {
    const stamped: Story = {
      ...story("old"),
      status: "done",
      startedAt: local("2026-07-01"),
      doneAt: local("2026-07-04"),
    };
    const b = stageBreakdown(items([...five, stamped]));
    expect(b.approximate).toBe(1);
    expect(b.items).toHaveLength(5);
    const ranged = stageBreakdown(items(five), { from: "2026-07-10", to: "2026-07-11" });
    expect(ranged.items.map((i) => i.doneOn)).toEqual(["2026-07-10", "2026-07-11"]);
  });

  it("lists items oldest finish first, and gives each its own efficiency", () => {
    const b = stageBreakdown(items([...five].reverse()));
    expect(b.items.map((i) => i.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(itemEfficiency(b.items[0], new Set(["review"]))).toBeCloseTo(100 / 3, 5);
    expect(itemEfficiency({ stages: [] }, new Set(["review"]))).toBeNull();
  });

  it("cleans the waiting statuses it is given", () => {
    expect(cleanStageIds(["review", "nope", "todo", "review", 3])).toEqual(["todo", "review"]);
    expect(cleanStageIds("review")).toEqual([]);
    expect(stageBreakdown([], { waiting: ["bogus"] }).waiting).toEqual([]);
  });

  it("reads an empty board as nothing to say", () => {
    const b = stageBreakdown([] as FlowItem[]);
    expect(b).toMatchObject({ items: [], approximate: 0, stages: [], totalDays: 0 });
    expect(stageSentence(b)).toBeNull();
  });
});

describe("the words", () => {
  it("says where most of the time goes, with its median once quoted", () => {
    const b = stageBreakdown(
      items(
        Array.from({ length: 5 }, (_, i) =>
          moved(`w${i}`, [
            ["in_progress", "2026-07-05", 9],
            ["review", "2026-07-06", 9],
            ["done", "2026-07-09", 9],
          ])
        )
      )
    );
    expect(stageSentence(b)).toBe(
      "Most of the time from start to done is in Review: 75% of it, a median of 3 days an item."
    );
  });

  it("gives hours under a day and days with one decimal above", () => {
    expect(stageDuration(0.01)).toBe("under 1 h");
    expect(stageDuration(0.25)).toBe("6 h");
    expect(stageDuration(1)).toBe("1 day");
    expect(stageDuration(2.34)).toBe("2.3 days");
    expect(stageDuration(null)).toBe("—");
  });
});

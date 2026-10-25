/**
 * lib/flow counts: items per stage per day (the cumulative flow diagram).
 *
 *   - one point per calendar day, gaps filled, every stage present;
 *   - an item counts from its arrival; done is a running total, and a
 *     reopened item leaves it;
 *   - stamps-placed items are counted as approximate, the other board's
 *     items are left out, a corrupt range stays bounded;
 *   - wipOf / doneOf read the active and done stages.
 */

import { describe, expect, it } from "vitest";
import {
  BOARD_WORKFLOW,
  MAX_RANGE_DAYS,
  SPRINT_WORKFLOW,
  cardItems,
  dailyCounts,
  doneOf,
  storyItems,
  wipOf,
} from "@/lib/flow";
import { movedCard } from "@/lib/kanban/flow";
import { card, local, localYmd, story } from "./fixtures";

const stories = storyItems([
  story("a", {
    status: "done",
    startedAt: local("2026-10-06"),
    doneAt: local("2026-10-08"),
    statusHistory: [
      { status: "todo", from: "backlog", at: local("2026-10-05") },
      { status: "in_progress", from: "todo", at: local("2026-10-06") },
      { status: "done", from: "in_progress", at: local("2026-10-08") },
    ],
  }),
  story("b", {
    status: "review",
    startedAt: local("2026-10-07"),
    statusHistory: [
      { status: "todo", from: "backlog", at: local("2026-10-05") },
      { status: "in_progress", from: "todo", at: local("2026-10-07") },
      { status: "review", from: "in_progress", at: local("2026-10-09") },
    ],
  }),
]);

describe("dailyCounts", () => {
  it("counts each stage on every day of the range, gaps filled", () => {
    const { days, approximate, workflow } = dailyCounts(stories, SPRINT_WORKFLOW, {
      from: "2026-10-04",
      to: "2026-10-10",
    });
    expect(workflow).toBe(SPRINT_WORKFLOW);
    expect(approximate).toBe(0);
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
    const row = (i: number) => SPRINT_WORKFLOW.stages.map((s) => days[i].counts[s.id]);
    // Not on the board before they were planned in.
    expect(row(0)).toEqual([0, 0, 0, 0]);
    expect(row(1)).toEqual([2, 0, 0, 0]);
    expect(row(2)).toEqual([1, 1, 0, 0]);
    expect(row(3)).toEqual([0, 2, 0, 0]);
    expect(row(4)).toEqual([0, 1, 0, 1]);
    expect(row(5)).toEqual([0, 0, 1, 1]);
    // A quiet day repeats the last one: done stays done.
    expect(row(6)).toEqual([0, 0, 1, 1]);
  });

  it("takes a reopened item back out of done", () => {
    let c = movedCard(
      card("r", { column: "in_progress", startedAt: local("2026-10-01") }),
      "done",
      local("2026-10-02")
    );
    c = movedCard(c, "review", local("2026-10-04", 23, 30));
    const { days } = dailyCounts(cardItems([c]), BOARD_WORKFLOW, {
      from: "2026-10-02",
      to: "2026-10-05",
    });
    expect(days.map((d) => doneOf(d, BOARD_WORKFLOW))).toEqual([1, 1, 0, 0]);
    expect(days.map((d) => wipOf(d, BOARD_WORKFLOW))).toEqual([0, 0, 1, 1]);
  });

  it("buckets a move by its local day, never its UTC date", () => {
    // Late in the evening and just after midnight, local time: one of the two
    // has a different UTC date in any zone but UTC.
    const late = local("2026-10-03", 23, 45);
    const early = local("2026-10-04", 0, 15);
    const cards = cardItems([
      movedCard(card("l"), "ready", late),
      movedCard(card("e"), "ready", early),
    ]);
    const { days } = dailyCounts(cards, BOARD_WORKFLOW, { from: "2026-10-03", to: "2026-10-04" });
    expect(localYmd(late)).toBe("2026-10-03");
    expect(days.map((d) => d.counts.ready)).toEqual([1, 2]);
  });

  it("counts the items placed from their stamps, once each, among those on the chart", () => {
    const items = cardItems([
      card("s", {
        column: "review",
        startedAt: local("2026-10-02"),
        columnSince: local("2026-10-03"),
      }),
      // Rebuilt from stamps too, but arrives after the range.
      card("late", {
        createdAt: local("2026-10-20"),
        column: "in_progress",
        startedAt: local("2026-10-21"),
      }),
      movedCard(card("h"), "ready", local("2026-10-02")),
    ]);
    const counts = dailyCounts(items, BOARD_WORKFLOW, { from: "2026-10-01", to: "2026-10-05" });
    expect(counts.approximate).toBe(1);
    expect(counts.days[0].counts).toEqual({
      backlog: 2,
      ready: 0,
      in_progress: 0,
      review: 0,
      done: 0,
    });
    expect(counts.days[4].counts).toEqual({
      backlog: 0,
      ready: 1,
      in_progress: 0,
      review: 1,
      done: 0,
    });
  });

  it("leaves the other board's items out", () => {
    const mixed = [
      ...stories,
      ...cardItems([card("c", { column: "ready", columnSince: local("2026-10-01", 9) })]),
    ];
    const board = dailyCounts(mixed, BOARD_WORKFLOW, { from: "2026-10-09", to: "2026-10-09" });
    expect(board.days[0].counts).toEqual({
      backlog: 0,
      ready: 1,
      in_progress: 0,
      review: 0,
      done: 0,
    });
    const sprintBoard = dailyCounts(mixed, SPRINT_WORKFLOW, {
      from: "2026-10-09",
      to: "2026-10-09",
    });
    expect(sprintBoard.days[0].counts).toEqual({ todo: 0, in_progress: 0, review: 1, done: 1 });
  });

  it("returns zeros for no items, nothing for a backwards or invalid range, and at most MAX_RANGE_DAYS", () => {
    const empty = dailyCounts([], SPRINT_WORKFLOW, { from: "2026-10-01", to: "2026-10-02" });
    expect(empty.days).toEqual([
      { date: "2026-10-01", counts: { todo: 0, in_progress: 0, review: 0, done: 0 } },
      { date: "2026-10-02", counts: { todo: 0, in_progress: 0, review: 0, done: 0 } },
    ]);
    expect(
      dailyCounts(stories, SPRINT_WORKFLOW, { from: "2026-10-09", to: "2026-10-01" }).days
    ).toEqual([]);
    expect(dailyCounts(stories, SPRINT_WORKFLOW, { from: "soon", to: "2026-10-01" }).days).toEqual(
      []
    );
    const long = dailyCounts(stories, SPRINT_WORKFLOW, { from: "1990-01-01", to: "2026-10-10" });
    expect(long.days).toHaveLength(MAX_RANGE_DAYS);
    expect(long.days[long.days.length - 1].date).toBe("2026-10-10");
  });
});

describe("wipOf and doneOf", () => {
  it("add up the active stages and the done stage", () => {
    const day = {
      date: "2026-10-09",
      counts: { backlog: 4, ready: 2, in_progress: 3, review: 1, done: 7 },
    };
    expect(wipOf(day, BOARD_WORKFLOW)).toBe(4);
    expect(doneOf(day, BOARD_WORKFLOW)).toBe(7);
    expect(wipOf({ date: "2026-10-09", counts: {} }, SPRINT_WORKFLOW)).toBe(0);
  });
});

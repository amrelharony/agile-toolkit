/**
 * lib/impediments/blockers: a row per blocked spell and per impediment
 * raised; a linked impediment counted once, sharing its cluster; the rank
 * by blocked days, falling back to impediments raised; months; sides (own,
 * default cluster, category); the blocked-work gate and the tracking-since
 * cut; blocks from before tracking.
 */

import { describe, expect, it } from "vitest";
import type { Impediment, KanbanCard, Story } from "@/lib/stores/workspace-types";
import { BLOCK_TRACKING_SINCE } from "@/lib/flow/block-stamps";
import { addDays } from "@/lib/flow";
import {
  blockedWork,
  blockedWorkSentence,
  blockerRows,
  blockersByMonth,
  cleanClusterName,
  clusterImpediment,
  clusterPareto,
  lastDays,
  readBlockers,
  sideSplit,
  untrackedCount,
} from "@/lib/impediments/blockers";

/** Local noon of a day, as a UTC stamp. */
const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
const D0 = addDays(BLOCK_TRACKING_SINCE, 10) as string;
const day = (n: number) => addDays(D0, n) as string;
const WINDOW = { from: day(0), to: day(30), now: Date.parse(at(day(30))) };

const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "in_progress",
  sprintId: "s1",
  ...patch,
});
const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: `Card ${id}`,
  column: "in_progress",
  class: "standard",
  createdAt: day(0),
  ...patch,
});
const imp = (id: string, patch: Partial<Impediment> = {}): Impediment => ({
  id,
  title: `Impediment ${id}`,
  severity: "medium",
  raisedAt: day(2),
  ...patch,
});

const link = (targetId: string) => [{ route: "impediment" as const, targetId, at: at(day(1)) }];

describe("the rows", () => {
  it("has one per spell in the window and one per impediment raised in it", () => {
    const rows = blockerRows(
      [
        story("a", {
          blockLog: [
            { from: at(day(1), 0), to: at(day(3), 0), cluster: "Another team" },
            { from: at(addDays(D0, -40) as string), to: at(addDays(D0, -39) as string) },
          ],
        }),
      ],
      [card("c", { blocked: true, blockLog: [{ from: at(day(28), 0) }] })],
      [imp("i1", { cluster: "Waiting for a review" }), imp("old", { raisedAt: day(-20) })],
      WINDOW
    );
    expect(rows.map((r) => r.key)).toEqual([
      `story:a:${at(day(1), 0)}`,
      `card:c:${at(day(28), 0)}`,
      "impediment:i1",
    ]);
    expect(rows[0]).toMatchObject({ cluster: "Another team", side: "external", blockedDays: 2 });
    expect(rows[1]).toMatchObject({ cluster: null, open: true, blockedDays: 2.5 });
    expect(rows[2]).toMatchObject({ kind: "impediment", blockedDays: 0, daysOpen: 28, open: true });
  });

  it("counts a linked impediment once, the two sharing a cluster", () => {
    const stories = [
      story("a", {
        status: "done",
        doneAt: at(day(5)),
        blockLog: [{ from: at(day(1), 0), to: at(day(4), 0), sentTo: link("i1") }],
      }),
    ];
    const rows = blockerRows(
      stories,
      [],
      [imp("i1", { cluster: "A decision or approval" })],
      WINDOW
    );
    expect(rows.find((r) => r.kind === "story")).toMatchObject({
      cluster: "A decision or approval",
      impedimentId: "i1",
    });
    const pareto = clusterPareto(rows);
    expect(pareto.clusters).toEqual([
      expect.objectContaining({
        cluster: "A decision or approval",
        items: 1,
        impediments: 1,
        blockedDays: 3,
      }),
    ]);

    // The impediment takes the spell's cluster when it has none of its own.
    const back = blockerRows(
      [
        story("b", {
          blockLog: [
            { from: at(day(1)), to: at(day(2)), cluster: "Another team", sentTo: link("i2") },
          ],
        }),
      ],
      [],
      [imp("i2")],
      WINDOW
    );
    expect(back.find((r) => r.kind === "impediment")?.cluster).toBe("Another team");
  });

  it("leaves examples out", () => {
    const rows = blockerRows(
      [story("example-a", { blockLog: [{ from: at(day(1)), to: at(day(2)) }] })],
      [],
      [imp("example-i")],
      WINDOW
    );
    expect(rows).toEqual([]);
  });
});

describe("sides", () => {
  it("are the row's own, else the default cluster's, else the category's, else inside", () => {
    const rows = blockerRows(
      [
        story("own", {
          blockLog: [{ from: at(day(1)), to: at(day(2)), side: "external", cluster: "Team lunch" }],
        }),
        story("def", {
          blockLog: [{ from: at(day(1)), to: at(day(2)), cluster: "Access or permissions" }],
        }),
        story("none", { blockLog: [{ from: at(day(1)), to: at(day(2)) }] }),
      ],
      [],
      [
        imp("cat", { category: "external" }),
        imp("set", { category: "external", blockSide: "internal" }),
        imp("plain"),
      ],
      WINDOW
    );
    const side = (key: string) => rows.find((r) => r.id === key)?.side;
    expect([side("own"), side("def"), side("none")]).toEqual(["external", "external", "internal"]);
    expect([side("cat"), side("set"), side("plain")]).toEqual(["external", "internal", "internal"]);
    const split = sideSplit(rows, "blocked_days");
    expect(split.external.blockedDays).toBe(2);
    expect(split.internal.blockedDays).toBe(1);
    expect(split.externalPct).toBe(67);
  });
});

describe("the Pareto", () => {
  it("ranks clusters by blocked days and names the vital few", () => {
    const spell = (n: number, cluster: string) => ({
      from: at(day(1), 0),
      to: at(day(1 + n), 0),
      cluster,
    });
    const rows = blockerRows(
      [
        story("a", { blockLog: [spell(6, "Another team")] }),
        story("b", { blockLog: [spell(2, "Waiting for a review")] }),
        story("c", { blockLog: [spell(1, "Test or build environment")] }),
        story("d", { blockLog: [spell(1, "Another team")] }),
      ],
      [],
      // An impediment open for weeks never outranks item days.
      [imp("i", { cluster: "Test or build environment", raisedAt: day(1) })],
      WINDOW
    );
    const p = clusterPareto(rows);
    expect(p.measure).toBe("blocked_days");
    expect(p.clusters.map((c) => [c.cluster, c.blockedDays, c.vital])).toEqual([
      ["Another team", 7, true],
      ["Waiting for a review", 2, true],
      ["Test or build environment", 1, false],
    ]);
    expect(p.sentence).toBe("These 2 clusters hold 90% of blocked days.");
  });

  it("ranks by impediments raised while nothing has blocked days yet", () => {
    const rows = blockerRows(
      [],
      [],
      [
        imp("1", { cluster: "Another team" }),
        imp("2", { cluster: "Another team" }),
        imp("3", { cluster: "Waiting for a review" }),
        imp("4"),
      ],
      WINDOW
    );
    const p = clusterPareto(rows);
    expect(p.measure).toBe("impediments");
    expect(p.clusters.map((c) => [c.cluster, c.impediments])).toEqual([
      ["Another team", 2],
      ["Waiting for a review", 1],
    ]);
    expect(p.sentence).toMatch(/of impediments raised\.$/);
    expect(readBlockers([], [], [imp("4")], WINDOW).unclustered).toHaveLength(1);
  });

  it("keeps a cluster of impediments only once other clusters have blocked days", () => {
    const stories = [
      story("a", {
        blockLog: [{ from: at(day(1), 0), to: at(day(1), 12), cluster: "Waiting for a review" }],
      }),
    ];
    const impediments = ["1", "2", "3"].map((id) => imp(id, { cluster: "Another team" }));
    const x = readBlockers(stories, [], impediments, WINDOW);
    const p = clusterPareto(blockerRows(stories, [], impediments, WINDOW));
    expect(x.pareto).toEqual(p);
    expect(p.measure).toBe("blocked_days");
    expect(
      p.clusters.map((c) => [c.cluster, c.blockedDays, c.impediments, c.share, c.vital])
    ).toEqual([
      ["Waiting for a review", 0.5, 0, 1, true],
      ["Another team", 0, 3, 0, false],
    ]);
    expect(p.clusters[1]).toMatchObject({ side: "external", cumulative: 1, daysOpen: 84 });
    expect(p.sentence).toBe("One cluster holds all the blocked days: Waiting for a review.");
    expect(x.verdict).toMatch(/^Waiting for a review cost the most: 0\.5 blocked days/);
    expect(x.split.external.impediments).toBe(3);
  });

  it("says nothing of a share when no cluster holds any of the measure", () => {
    const rows = blockerRows(
      // Clustered, but too short to count a tenth of a day.
      [
        story("a", {
          blockLog: [{ from: at(day(1), 0), to: at(day(1), 1), cluster: "Another team" }],
        }),
      ],
      [],
      [],
      WINDOW
    );
    const p = clusterPareto(rows);
    expect(p.clusters.map((c) => [c.cluster, c.share, c.vital])).toEqual([
      ["Another team", 0, false],
    ]);
    expect(p.sentence).toBeNull();
  });

  it("counts one cluster however its name is cased or spaced", () => {
    const rows = blockerRows(
      [],
      [],
      [
        imp("1", { cluster: "Another team" }),
        imp("2", { cluster: "another  team" }),
        imp("3", { cluster: "Legal sign-off" }),
        imp("4", { cluster: "legal sign-off" }),
        imp("5", { cluster: "legal  sign-off" }),
        imp("6", { cluster: "Waiting for a review" }),
      ],
      WINDOW
    );
    const p = clusterPareto(rows);
    // A default cluster reads as the list writes it; a team's own as most of its rows spell it.
    expect(p.clusters.map((c) => [c.cluster, c.impediments])).toEqual([
      ["legal sign-off", 3],
      ["Another team", 2],
      ["Waiting for a review", 1],
    ]);
    expect(
      blockersByMonth(rows, "impediments").flatMap((m) => m.top.map((t) => t.cluster))
    ).not.toContain("another  team");
  });

  it("gives each month its top three", () => {
    const rows = blockerRows(
      [],
      [],
      [
        imp("1", { cluster: "Another team", raisedAt: day(1) }),
        imp("2", { cluster: "Another team", raisedAt: day(2) }),
        imp("3", { cluster: "Waiting for a review", raisedAt: day(25) }),
      ],
      WINDOW
    );
    const months = blockersByMonth(rows, "impediments");
    expect(months.length).toBeGreaterThanOrEqual(1);
    expect(months.flatMap((m) => m.top.map((t) => t.cluster))).toContain("Another team");
    expect(months.every((m) => m.top.length <= 3)).toBe(true);
  });
});

describe("blocked work", () => {
  const finished = (id: string, blockedDays: number, startDay = 1): Story =>
    story(id, {
      status: "done",
      startedAt: at(day(startDay), 0),
      doneAt: at(day(startDay + 10), 0),
      ...(blockedDays
        ? {
            blockLog: [
              { from: at(day(startDay + 1), 0), to: at(day(startDay + 1 + blockedDays), 0) },
            ],
          }
        : {}),
    });

  it("waits for five finished items, then says how blocked time hit them", () => {
    expect(blockedWork([finished("a", 1), finished("b", 0)], [], WINDOW)).toBeNull();
    const w = blockedWork(
      [finished("a", 1), finished("b", 0), finished("c", 2), finished("d", 4), finished("e", 0)],
      [],
      WINDOW
    );
    expect(w).toEqual({ finished: 5, blocked: 3, median: 2, p85: 4, sharePct: 14 });
    expect(blockedWorkSentence(w!)).toBe(
      "Of 5 items finished, 3 were blocked: a median of 2 days each, 14% of their time from start to done."
    );
  });

  it("leaves out work that started before tracking began", () => {
    const before = addDays(BLOCK_TRACKING_SINCE, -2) as string;
    const old = Array.from({ length: 5 }, (_, i) =>
      story(`o${i}`, { status: "done", startedAt: at(before), doneAt: at(day(3)) })
    );
    expect(blockedWork(old, [], WINDOW)).toBeNull();
  });

  it("counts blocks from before tracking apart", () => {
    expect(
      untrackedCount(
        [
          story("a", { blocked: true }),
          story("b", { blocked: true, blockLog: [{ from: at(day(1)) }] }),
        ],
        [card("c", { blocked: true }), card("example-d", { blocked: true })]
      )
    ).toBe(2);
  });
});

describe("the window", () => {
  it("is the last N local days up to today", () => {
    expect(lastDays(30, "2026-12-31", 0)).toEqual({ from: "2026-12-02", to: "2026-12-31", now: 0 });
    expect(lastDays(1, "2026-03-01", 5).from).toBe("2026-03-01");
  });

  it("reads a verdict from the top cluster and the side split", () => {
    const x = readBlockers(
      [
        story("a", {
          blockLog: [{ from: at(day(1), 0), to: at(day(3), 0), cluster: "Another team" }],
        }),
      ],
      [],
      [],
      WINDOW
    );
    expect(x.verdict).toBe(
      "Another team cost the most: 2 blocked days; 100% from outside the team."
    );
    expect(readBlockers([], [], [], WINDOW).verdict).toBe("Nothing was blocked in this window.");
  });
});

describe("cut text", () => {
  /** No lone half of an emoji: jsonb refuses one, and the row fails to sync. */
  const whole = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s);

  it("never splits an emoji in a cause, a raised description or a cluster name", () => {
    const long = `${"a".repeat(158)}😀${"b".repeat(60)}`;
    const rows = blockerRows(
      [story("s", { blockLog: [{ from: at(day(1)), to: at(day(2)), cluster: "Another team" }] })],
      [],
      [imp("i", { cluster: "Another team", description: `${"c".repeat(199)}😀 more` })],
      WINDOW
    );
    const cause = rows.find((r) => r.kind === "impediment")?.cause ?? "";
    expect(cause).toHaveLength(199);
    expect(whole(cause)).toBe(true);
    const raised = clusterImpediment(
      [...rows, { ...rows[0], key: "x", cause: long }],
      "Another team",
      { id: "n", today: day(30), from: day(0) }
    );
    expect(whole(raised.description ?? "")).toBe(true);
    expect(raised.description).toContain(`- ${"a".repeat(158)}…`);
    const name = cleanClusterName(`${"d".repeat(59)}😀`);
    expect(name).toBe("d".repeat(59));
  });
});

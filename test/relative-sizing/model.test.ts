/**
 * Relative Sizing's model, live-round helpers and stored data: buckets per
 * set and their checks, move counting and the Talk about it threshold, a
 * seeded deal, the questionnaire a round carries (32 stories on 11 buckets
 * included), counts read as votes, placements from a round (agree, close,
 * spread, withheld), what Save sizes writes, and the normaliser.
 */

import { describe, expect, it } from "vitest";
import {
  bucketsFor,
  bucketsProblem,
  dealItems,
  moveItem,
  newBoard,
  planBucketPoints,
  planCreateBoard,
  planPlace,
  sizesToWrite,
  skippedLine,
  splitLabels,
  unsizedItems,
  withAnchor,
  withBucketPoints,
  withItemRestored,
  withoutItems,
  middleBucket,
} from "@/lib/relative-sizing/model";
import {
  LIVE_BATCH_DEFAULT,
  liveBatch,
  placementsFromRound,
  sizingQuestionnaire,
  sizingTitle,
  votesFromCounts,
} from "@/lib/relative-sizing/live";
import {
  RELATIVE_SIZING_INITIAL,
  normalizeRelativeSizingState,
  type SizingBoard,
} from "@/lib/relative-sizing/state";
import { questionnaireProblem, VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { Story } from "@/lib/stores/workspace-types";

const NOW = "2026-11-23T10:00:00.000Z";
const board = (n = 4, over: Partial<SizingBoard> = {}): SizingBoard => ({
  ...newBoard(
    {
      title: "Checkout",
      bucketSet: "fibonacci",
      buckets: bucketsFor("fibonacci"),
      items: Array.from({ length: n }, (_, i) => ({
        title: `Story ${i + 1}`,
        storyId: `st${i + 1}`,
      })),
    },
    "sizing_a",
    NOW,
    (i) => `c${i + 1}`
  ),
  ...over,
});
const bucket = (b: SizingBoard, label: string) => b.buckets.find((x) => x.label === label)!.id;
const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Story 1",
  status: "backlog",
  ...over,
});

describe("buckets", () => {
  it("come from the guide's scales, our wide set, or the team's own labels", () => {
    expect(bucketsFor("fibonacci").map((b) => b.label)).toEqual([
      "1",
      "2",
      "3",
      "5",
      "8",
      "13",
      "21",
    ]);
    expect(bucketsFor("fibonacci")[3]).toEqual({ id: "b4", label: "5", points: 5 });
    expect(bucketsFor("tshirt").every((b) => b.points === undefined)).toBe(true);
    expect(bucketsFor("powers").map((b) => b.label)).toEqual(["1", "2", "4", "8", "16", "32"]);
    expect(bucketsFor("linear")).toHaveLength(10);
    expect(bucketsFor("wide").map((b) => b.label)).toEqual([
      "1",
      "2",
      "3",
      "5",
      "8",
      "13",
      "20",
      "40",
      "100",
    ]);
    expect(bucketsFor("custom", splitLabels("S, M L"))).toEqual([
      { id: "b1", label: "S" },
      { id: "b2", label: "M" },
      { id: "b3", label: "L" },
    ]);
  });

  it("refuse a repeat, a card that isn't a size, too few and too many", () => {
    const l = (...labels: string[]) => labels.map((label) => ({ label }));
    expect(bucketsProblem(l("1", "2", "3"))).toBeNull();
    expect(bucketsProblem(l("S", " s "))).toMatch(/twice/);
    for (const bad of ["?", "∞", "coffee", "☕"])
      expect(bucketsProblem(l("1", bad))).toMatch(/isn't a size/);
    expect(bucketsProblem(l("1"))).toMatch(/at least two/);
    expect(bucketsProblem(l(...Array.from({ length: 12 }, (_, i) => String(i + 1))))).toMatch(
      /11 buckets/
    );
    expect(bucketsProblem(l("1", "123456789"))).toMatch(/8 characters/);
  });
});

describe("moving cards", () => {
  it("counts a move each time a card leaves a bucket, not on its first placement", () => {
    let b = board();
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "3") }, NOW).board;
    expect(b.items[0]).toMatchObject({ bucketId: bucket(b, "3"), moves: 0 });
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "5") }, NOW).board;
    expect(b.items[0].moves).toBe(1);
    const same = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "5") }, NOW);
    expect(same.moved).toBe(false);
  });

  it("sends a card to Talk about it at the move limit, and settles it when placed from there", () => {
    let b = board(1, { moveLimit: 3 });
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "3") }, NOW).board;
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "5") }, NOW).board;
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "8") }, NOW).board;
    const r = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "3") }, NOW);
    expect(r.toTalk).toBe(true);
    expect(r.board.items[0]).toMatchObject({ moves: 3, contested: true, bucketId: bucket(b, "3") });
    const settled = moveItem(
      r.board,
      "c1",
      { kind: "bucket", bucketId: bucket(b, "5") },
      NOW
    ).board;
    expect(settled.items[0]).toMatchObject({ moves: 0, bucketId: bucket(b, "5") });
    expect(settled.items[0].contested).toBeUndefined();
  });

  it("takes a card off the board and puts it back at its place, the anchor again", () => {
    let b = board(3);
    b = withAnchor(b, "c2", middleBucket(b).id, NOW);
    const removed = { item: b.items[1], index: 1, anchor: true };
    const off = withoutItems(b, ["c2"], NOW);
    expect(off.items.map((i) => i.id)).toEqual(["c1", "c3"]);
    expect(off.anchorItemId).toBeUndefined();
    const back = withItemRestored(off, removed, NOW);
    expect(back.items.map((i) => i.id)).toEqual(["c1", "c2", "c3"]);
    expect(back.items[1]).toEqual(b.items[1]);
    expect(back.anchorItemId).toBe("c2");
    // Already back: nothing changes. Another anchor picked since: it stays.
    expect(withItemRestored(back, removed, NOW)).toBe(back);
    const other = withAnchor(off, "c1", middleBucket(off).id, NOW);
    expect(withItemRestored(other, removed, NOW).anchorItemId).toBe("c1");
    // A full board takes nothing back.
    const full = board(100);
    expect(withItemRestored(full, { ...removed, item: { ...removed.item, id: "x" } }, NOW)).toBe(
      full
    );
  });

  it("deals the same way from the same seed, round robin, the anchor left out", () => {
    let b = board(6);
    b = withAnchor(b, "c1", middleBucket(b).id, NOW);
    expect(b.items[0]).toMatchObject({ bucketId: bucket(b, "5"), moves: 0 });
    const one = dealItems(b, ["Ana", "Raj"], "seed-1", NOW);
    const two = dealItems(b, ["Ana", "Raj"], "seed-1", NOW);
    expect(one.items.map((i) => i.dealtTo)).toEqual(two.items.map((i) => i.dealtTo));
    expect(one.items[0].dealtTo).toBeUndefined();
    const counts = one.items.slice(1).reduce<Record<string, number>>((acc, i) => {
      acc[i.dealtTo!] = (acc[i.dealtTo!] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ Ana: 3, Raj: 2 });
  });
});

describe("the live round", () => {
  it("carries 32 stories on 11 buckets", () => {
    const b = board(40, {
      buckets: bucketsFor("linear").concat({ id: "b11", label: "11", points: 11 }),
    });
    const q = sizingQuestionnaire(
      b,
      b.items.map((i) => i.id)
    );
    expect(q.questions).toHaveLength(VOTE_LIMITS.maxQuestions);
    expect(q.scale.points).toHaveLength(11);
    expect(q.scale.points[0]).toEqual({ value: 1, label: "1" });
    expect(q.questions.every((x) => x.optional)).toBe(true);
    expect(questionnaireProblem(q)).toBeNull();
  });

  it("takes 20 unplaced or contested stories by default, the anchor left out", () => {
    let b = board(30);
    b = withAnchor(b, "c1", middleBucket(b).id, NOW);
    const batch = liveBatch(b);
    expect(batch).toHaveLength(LIVE_BATCH_DEFAULT);
    expect(batch).not.toContain("c1");
  });

  it("puts the anchor in the title within 120, cutting the anchor's title first", () => {
    let b = board(2);
    expect(sizingTitle(b)).toBe("Checkout");
    b = withAnchor(b, "c1", middleBucket(b).id, NOW);
    expect(sizingTitle(b)).toBe("Checkout · “Story 1” is a 5");
    const long = {
      ...b,
      title: "T".repeat(110),
      items: [{ ...b.items[0], title: "A".repeat(150) }, b.items[1]],
    };
    const t = sizingTitle(long);
    expect(t.length).toBeLessThanOrEqual(VOTE_LIMITS.maxTitleChars);
    expect(t).toContain("is a 5");
  });

  it("reads counts as the votes they stand for", () => {
    expect(votesFromCounts([0, 2, 1], ["3", "5", "8"])).toEqual(["5", "5", "8"]);
  });

  it("places agree and close stories, sends a spread one to talk, and leaves a withheld one", () => {
    const b = board(4);
    const labels = b.buckets.map((x) => x.label);
    const result: VoteRoundResult = {
      roundId: "round_1",
      tool: "relative-sizing",
      questionnaireId: "q",
      title: "Checkout",
      scale: { id: "buckets", points: labels.map((label, i) => ({ value: i + 1, label })) },
      closedAt: NOW,
      minN: 3,
      ballots: 5,
      source: "live",
      questions: [
        { id: "c1", text: "Story 1", responses: 3, distribution: [0, 0, 3, 0, 0, 0, 0] },
        { id: "c2", text: "Story 2", responses: 4, distribution: [0, 0, 2, 2, 0, 0, 0] },
        { id: "c3", text: "Story 3", responses: 6, distribution: [0, 0, 2, 0, 3, 1, 0] },
        { id: "c4", text: "Story 4", responses: 2, distribution: null },
      ],
    };
    const r = placementsFromRound(result, b, NOW);
    expect([r.placed, r.outliers, r.withheld]).toEqual([2, 1, 1]);
    expect(r.board.items[0]).toMatchObject({ bucketId: bucket(b, "3"), room: { level: "agree" } });
    expect(r.board.items[1]).toMatchObject({ bucketId: bucket(b, "5"), room: { level: "close" } });
    expect(r.board.items[2]).toMatchObject({
      contested: true,
      room: { counts: [0, 0, 2, 0, 3, 1, 0] },
    });
    expect(r.board.items[3]).toEqual(b.items[3]);
    // Totals only: nobody's id or name is kept.
    expect(r.saved.stories.map((s) => s.counts)).toEqual([
      [0, 0, 3, 0, 0, 0, 0],
      [0, 0, 2, 2, 0, 0, 0],
      [0, 0, 2, 0, 3, 1, 0],
      null,
    ]);
  });

  it("settles a card the room agrees on from Talk about it: its moves start again", () => {
    let b = board(1, { moveLimit: 3 });
    for (const label of ["3", "5", "8", "3"]) {
      b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, label) }, NOW).board;
    }
    expect(b.items[0]).toMatchObject({ moves: 3, contested: true });
    const labels = b.buckets.map((x) => x.label);
    const result: VoteRoundResult = {
      roundId: "round_2",
      tool: "relative-sizing",
      questionnaireId: "q",
      title: "Checkout",
      scale: { id: "buckets", points: labels.map((label, i) => ({ value: i + 1, label })) },
      closedAt: NOW,
      minN: 3,
      ballots: 3,
      source: "live",
      questions: [{ id: "c1", text: "Story 1", responses: 3, distribution: [0, 0, 0, 3, 0, 0, 0] }],
    };
    let settled = placementsFromRound(result, b, NOW).board;
    expect(settled.items[0]).toMatchObject({ bucketId: bucket(b, "5"), moves: 0 });
    expect(settled.items[0].contested).toBeUndefined();
    // It takes the board's move limit in new moves to go back to Talk about it.
    for (const label of ["8", "13"]) {
      const r = moveItem(settled, "c1", { kind: "bucket", bucketId: bucket(b, label) }, NOW);
      expect(r.toTalk).toBe(false);
      settled = r.board;
    }
    expect(moveItem(settled, "c1", { kind: "bucket", bucketId: bucket(b, "5") }, NOW).toTalk).toBe(
      true
    );
  });
});

describe("Save sizes", () => {
  it("writes numeric buckets on workspace stories and says why it skips the rest", () => {
    let b = board(5);
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "5") }, NOW).board;
    b = moveItem(b, "c2", { kind: "bucket", bucketId: bucket(b, "3") }, NOW).board;
    b = moveItem(b, "c3", { kind: "talk" }, NOW).board;
    b = {
      ...b,
      items: [...b.items, { id: "c9", title: "Typed", bucketId: bucket(b, "8"), moves: 0 }],
    };
    const stories = [
      story(),
      story({ id: "st2", title: "Story 2", points: 3 }),
      story({ id: "st3" }),
      story({ id: "st4" }),
    ];
    const plan = sizesToWrite(b, stories);
    expect(plan.writes).toEqual([
      { itemId: "c1", storyId: "st1", title: "Story 1", points: 5, before: undefined },
    ]);
    expect(plan.skipped.map((s) => [s.itemId, s.why])).toEqual([
      ["c2", "already"],
      ["c3", "to-talk-about"],
      ["c4", "not-placed"],
      ["c5", "story-gone"],
      ["c9", "not-in-backlog"],
    ]);
    expect(skippedLine(plan)).toMatch(/^5 skipped:/);
  });

  it("skips T-shirt buckets with no points, and example stories", () => {
    let b = board(1, { bucketSet: "tshirt", buckets: bucketsFor("tshirt") });
    b = moveItem(b, "c1", { kind: "bucket", bucketId: b.buckets[2].id }, NOW).board;
    expect(sizesToWrite(b, [story()]).skipped[0].why).toBe("no-points");
    const mapped = { ...b, buckets: b.buckets.map((x) => ({ ...x, points: 5 })) };
    expect(sizesToWrite(mapped, [story()]).writes).toHaveLength(1);
    const ex = { ...mapped, items: [{ ...mapped.items[0], storyId: "example-st" }] };
    expect(sizesToWrite(ex, [story({ id: "example-st" })]).skipped[0].why).toBe("example");
  });

  it("maps a T-shirt bucket to points, then writes it; clearing the points skips it again", () => {
    let b = board(1, { bucketSet: "tshirt", buckets: bucketsFor("tshirt") });
    b = moveItem(b, "c1", { kind: "bucket", bucketId: bucket(b, "M") }, NOW).board;
    const later = "2026-11-23T11:00:00.000Z";
    const mapped = withBucketPoints(b, bucket(b, "M"), 5, later)!;
    expect(mapped.buckets.find((x) => x.label === "M")).toEqual({
      id: "b3",
      label: "M",
      points: 5,
    });
    expect(mapped.updatedAt).toBe(later);
    expect(sizesToWrite(mapped, [story()]).writes).toEqual([
      { itemId: "c1", storyId: "st1", title: "Story 1", points: 5, before: undefined },
    ]);
    // The same points again: the board itself, unchanged.
    expect(withBucketPoints(mapped, bucket(b, "M"), 5, NOW)).toBe(mapped);
    const cleared = withBucketPoints(mapped, bucket(b, "M"), undefined, NOW)!;
    expect("points" in cleared.buckets[2]).toBe(false);
    expect(sizesToWrite(cleared, [story()]).skipped[0].why).toBe("no-points");
    // A bucket not on the board, or points past 0 to 1,000: refused.
    expect(withBucketPoints(b, "b99", 5, NOW)).toBeNull();
    expect(withBucketPoints(b, bucket(b, "M"), -1, NOW)).toBeNull();
    expect(withBucketPoints(b, bucket(b, "M"), 1001, NOW)).toBeNull();
    expect(withBucketPoints(b, bucket(b, "M"), Number.NaN, NOW)).toBeNull();
  });

  it("starts from the backlog's unsized stories only", () => {
    const items = unsizedItems([
      story(),
      story({ id: "st2", points: 3 }),
      story({ id: "st3", sprintId: "s1" }),
      story({ id: "example-1" }),
      story({ id: "st5", points: 0 }),
    ]);
    expect(items.map((i) => i.storyId)).toEqual(["st1", "st5"]);
  });
});

describe("the planners Amr and the page share", () => {
  it("creates a board, opens it, and refuses bad buckets or no stories", () => {
    const ok = planCreateBoard(
      RELATIVE_SIZING_INITIAL,
      {
        title: "Q1",
        bucketSet: "fibonacci",
        buckets: bucketsFor("fibonacci"),
        items: [{ title: "A" }],
      },
      { boardId: "sizing_1", itemId: (i) => `c${i}` },
      NOW
    );
    expect(ok.ok && ok.state.activeBoardId).toBe("sizing_1");
    const noStories = planCreateBoard(
      RELATIVE_SIZING_INITIAL,
      { title: "Q1", bucketSet: "fibonacci", buckets: bucketsFor("fibonacci"), items: [] },
      { boardId: "sizing_2", itemId: (i) => `c${i}` },
      NOW
    );
    expect(noStories).toMatchObject({ ok: false });
    const bad = planCreateBoard(
      RELATIVE_SIZING_INITIAL,
      {
        title: "Q1",
        bucketSet: "custom",
        buckets: bucketsFor("custom", ["S", "s"]),
        items: [{ title: "A" }],
      },
      { boardId: "sizing_3", itemId: (i) => `c${i}` },
      NOW
    );
    expect(bad).toMatchObject({ ok: false });
  });

  it("places by a bucket's label, any case, and names the labels when it's wrong", () => {
    const state = { ...RELATIVE_SIZING_INITIAL, boards: [board(1)] };
    const r = planPlace(state, { boardId: "sizing_a", itemId: "c1", bucket: "13" }, NOW);
    expect(r.ok && r.state.boards[0].items[0].bucketId).toBe("b6");
    const wrong = planPlace(state, { boardId: "sizing_a", itemId: "c1", bucket: "XL" }, NOW);
    expect(wrong.ok ? "" : wrong.reason).toMatch(/1, 2, 3, 5, 8, 13, 21/);
  });

  it("maps a size to points by its label, any case, and refuses a bad label or points", () => {
    const state = {
      ...RELATIVE_SIZING_INITIAL,
      boards: [board(1, { bucketSet: "tshirt", buckets: bucketsFor("tshirt") })],
    };
    const r = planBucketPoints(state, { boardId: "sizing_a", bucket: "xl", points: 13 }, NOW);
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.ok && r.state.boards[0].buckets.find((x) => x.label === "XL")?.points).toBe(13);
    const same = planBucketPoints(
      r.ok ? r.state : state,
      { boardId: "sizing_a", bucket: "XL", points: 13 },
      NOW
    );
    expect(same).toMatchObject({ ok: true, changed: false });
    const wrong = planBucketPoints(state, { boardId: "sizing_a", bucket: "5", points: 5 }, NOW);
    expect(wrong.ok ? "" : wrong.reason).toMatch(/XS, S, M, L, XL, XXL/);
    expect(planBucketPoints(state, { boardId: "nope", bucket: "M", points: 5 }, NOW)).toMatchObject(
      { ok: false }
    );
    expect(
      planBucketPoints(state, { boardId: "sizing_a", bucket: "M", points: 5000 }, NOW)
    ).toMatchObject({ ok: false });
  });
});

describe("the stored data", () => {
  it("reads junk back as the empty state with every key", () => {
    for (const junk of [null, 3, [], { boards: "x" }]) {
      expect(normalizeRelativeSizingState(junk)).toEqual(RELATIVE_SIZING_INITIAL);
    }
  });

  it("rebuilds a board field by field and caps it", () => {
    const raw = {
      boards: [
        {
          id: "sizing_a",
          title: "B".repeat(300),
          mode: "loud",
          bucketSet: "fibonacci",
          moveLimit: 50,
          buckets: [
            { id: "b1", label: "1", points: 1 },
            { id: "b2", label: "1" },
            { id: "b3", label: "TOOLONGLABEL", points: -3 },
            { id: "b4", label: "5", points: 99999 },
          ],
          items: [
            {
              id: "c1",
              title: "A",
              bucketId: "b9",
              moves: 500,
              room: { counts: [1], responses: 1 },
            },
            { id: "c1", title: "Repeat" },
            ...Array.from({ length: 150 }, (_, i) => ({
              id: `x${i}`,
              title: `X${i}`,
              bucketId: null,
            })),
          ],
          anchorItemId: "gone",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      activeBoardId: "nope",
      rounds: [
        {
          roundId: "r",
          boardId: "sizing_a",
          closedAt: NOW,
          stories: [{ itemId: "c1", counts: [1, "x"] }],
        },
      ],
    };
    const s = normalizeRelativeSizingState(raw);
    const b = s.boards[0];
    expect(b.title.length).toBeLessThanOrEqual(120);
    expect(b.mode).toBe("silent");
    expect(b.moveLimit).toBe(3);
    expect(b.buckets).toEqual([
      { id: "b1", label: "1", points: 1 },
      { id: "b3", label: "TOOLONG…" },
      { id: "b4", label: "5" },
    ]);
    expect(b.items[0]).toEqual({ id: "c1", title: "A", bucketId: null, moves: 0 });
    expect(b.items).toHaveLength(100);
    expect(b.anchorItemId).toBeUndefined();
    expect(s.activeBoardId).toBeNull();
    expect(s.rounds[0].stories[0].counts).toBeNull();
  });
});

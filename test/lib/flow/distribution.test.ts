/**
 * lib/flow/distribution: how a finished story or card is sorted (set, its
 * story kind, tags, where it came from; title words only in the keyword
 * fallback), what counts as repeat work, the mix per sprint and per week,
 * examples left out, the gaps to a target, and the trend gate at 10 over
 * every period.
 */

import { describe, expect, it } from "vitest";
import type { KanbanCard, Sprint, Story } from "@/lib/stores/workspace-types";
import { WORKFLOW_DEFINITION_ID } from "@/lib/stores/workspace-types";
import {
  FLOW_TREND_MIN,
  defaultBoard,
  failureTrend,
  flowInsights,
  gapLabel,
  guessWorkType,
  isFailureDemand,
  keywordWorkType,
  mixByPeriod,
  mixTotals,
  targetGaps,
  unsortedItems,
  windowOf,
} from "@/lib/flow/distribution";
import { withTargetSplit } from "@/lib/flow/work-types";
import { addDays } from "@/lib/flow";
import { card, local, sprint, story } from "./fixtures";

const done = (id: string, sprintId: string, day: string, patch: Partial<Story> = {}): Story =>
  story(id, {
    sprintId,
    status: "done",
    startedAt: local(addDays(day, -2) as string, 9),
    doneAt: local(day, 15),
    ...patch,
  });

const sprintN = (n: number, patch: Partial<Sprint> = {}): Sprint => {
  const start = addDays("2026-01-05", (n - 1) * 14) as string;
  return sprint({
    id: `s${n}`,
    name: `Sprint ${n}`,
    startDate: start,
    endDate: addDays(start, 11) as string,
    status: "completed",
    ...patch,
  });
};
const endOf = (n: number) => sprintN(n).endDate;

describe("guessing a work type", () => {
  it("lets a type set on the row win", () => {
    expect(guessWorkType(story("a", { title: "Fix login", workType: "feature" }))).toEqual({
      type: "feature",
      by: "set",
    });
  });

  it("reads a story's kind, then its tags, then where it came from", () => {
    expect(guessWorkType(story("a", { title: "Fix the login" }))).toEqual({
      type: "defect",
      by: "kind",
    });
    expect(guessWorkType(story("b", { tags: ["Bug"] }))?.type).toBe("defect");
    expect(guessWorkType(story("c", { tags: ["hotfix"] }))).toEqual({ type: "defect", by: "tag" });
    expect(guessWorkType(story("d", { tags: ["Tech-Debt"] }))).toEqual({ type: "debt", by: "tag" });
    expect(guessWorkType(story("e", { tags: ["spike"] }))).toEqual({ type: "risk", by: "tag" });
    expect(guessWorkType(story("f", { sourceRef: { tool: "tech-debt", id: "t1" } }))).toEqual({
      type: "debt",
      by: "source",
    });
    expect(guessWorkType(story("g", { sourceRef: { tool: "bug-triage", id: "b1" } }))?.type).toBe(
      "defect"
    );
    expect(guessWorkType(story("h", { title: "Checkout with Apple Pay" }))).toBeNull();
  });

  it("reads a card by where it came from only (cards have no tags)", () => {
    expect(guessWorkType(card("c1", { sourceRef: { tool: "risk-register", id: "r" } }))).toEqual({
      type: "risk",
      by: "source",
    });
    expect(guessWorkType(card("c2", { title: "Fix the crash" }))).toBeNull();
    expect(guessWorkType(card("c3", { workType: "debt" }))).toEqual({ type: "debt", by: "set" });
  });

  it("uses title words only in the keyword fallback", () => {
    expect(keywordWorkType("Login crashes on Safari")).toBe("defect");
    expect(keywordWorkType("Refactor the cart")).toBe("debt");
    expect(keywordWorkType("Migrate to Postgres 16")).toBe("debt");
    expect(keywordWorkType("Security audit of payments")).toBe("risk");
    expect(keywordWorkType("Pay with a saved card")).toBe("feature");
    expect(keywordWorkType("Card", "the cleanup of old rows")).toBe("debt");
  });
});

describe("failure demand", () => {
  const reopened = story("r", {
    status: "done",
    statusHistory: [
      { status: "in_progress", from: "todo", at: local("2026-01-06") },
      { status: "done", from: "in_progress", at: local("2026-01-07") },
      { status: "in_progress", from: "done", at: local("2026-01-08") },
      { status: "done", from: "in_progress", at: local("2026-01-09") },
    ],
  });

  it("is a marked demand first, then a defect, then a reopened item", () => {
    expect(isFailureDemand(story("a", { demand: "failure" }))).toEqual({
      failure: true,
      why: "marked",
    });
    expect(isFailureDemand(story("b", { title: "Fix x", demand: "value" }))).toEqual({
      failure: false,
      why: null,
    });
    expect(isFailureDemand(story("c", { title: "Bug: totals" }))).toEqual({
      failure: true,
      why: "defect",
    });
    expect(isFailureDemand(reopened, { moves: [{ to: "todo", from: "done", at: "x" }] })).toEqual({
      failure: true,
      why: "reopened",
    });
    expect(isFailureDemand(story("d"))).toEqual({ failure: false, why: null });
  });

  it("finds a reopened story in the sprint's mix", () => {
    const s1 = sprintN(1);
    const row = { ...reopened, sprintId: "s1", doneAt: local("2026-01-09", 15) };
    const [p] = mixByPeriod({ board: "sprint", stories: [row], sprints: [s1], cards: [] });
    expect(p.items[0]).toMatchObject({ reopened: true, failure: true, failureWhy: "reopened" });
  });
});

describe("the mix per period", () => {
  it("counts each finished sprint's stories done by its end", () => {
    const sprints = [sprintN(1), sprintN(2), sprintN(3, { status: "active" })];
    const stories = [
      done("a", "s1", endOf(1)),
      done("b", "s1", endOf(1), { title: "Fix totals" }),
      done("c", "s2", endOf(2), { tags: ["refactor"] }),
      done("d", "s2", endOf(2), { workType: "risk" }),
      done("e", "s2", endOf(2)),
      story("f", { sprintId: "s2", status: "in_progress" }),
      done("g", "s3", endOf(3)),
    ];
    const periods = mixByPeriod({ board: "sprint", stories, sprints, cards: [] });
    expect(periods.map((p) => p.id)).toEqual(["s1", "s2"]);
    expect(periods[0]).toMatchObject({
      finished: 2,
      counts: { feature: 0, defect: 1, debt: 0, risk: 0 },
      unsorted: 1,
      guessed: 1,
      failure: 1,
      failurePct: 50,
    });
    expect(periods[1]).toMatchObject({ finished: 3, unsorted: 1, guessed: 1, failure: 0 });
    expect(
      unsortedItems(periods)
        .map((i) => i.id)
        .sort()
    ).toEqual(["a", "b", "c", "e"]);
  });

  it("counts the Flow board per ISO week, quiet weeks as 0", () => {
    const cards: KanbanCard[] = [
      card("c1", {
        column: "done",
        startedAt: local("2026-01-05"),
        completedAt: local("2026-01-06"),
      }),
      card("c2", {
        column: "done",
        startedAt: local("2026-01-05"),
        completedAt: local("2026-01-21"),
      }),
      card("c3", { column: "review" }),
    ];
    const periods = mixByPeriod({ board: "flow", stories: [], sprints: [], cards });
    expect(periods.map((p) => [p.id, p.finished])).toEqual([
      ["2026-W02", 1],
      ["2026-W03", 0],
      ["2026-W04", 1],
    ]);
    expect(periods[1].failurePct).toBeNull();
    const toToday = mixByPeriod({
      board: "flow",
      stories: [],
      sprints: [],
      cards,
      today: "2026-02-02",
    });
    expect(toToday[toToday.length - 1].id).toBe("2026-W06");
  });

  it("leaves examples out unless asked for", () => {
    const sprints = [sprintN(1), sprintN(2, { id: "example-s2" })];
    const stories = [done("example-a", "s1", endOf(1)), done("b", "s1", endOf(1))];
    const real = mixByPeriod({ board: "sprint", stories, sprints, cards: [] });
    expect(real.map((p) => p.finished)).toEqual([1]);
    const all = mixByPeriod({
      board: "sprint",
      stories,
      sprints,
      cards: [],
      includeExamples: true,
    });
    expect(all.map((p) => p.finished)).toEqual([2, 0]);
  });
});

describe("against the target", () => {
  it("compares each type's share of the sorted work with its target", () => {
    const s1 = sprintN(1);
    const stories = [
      done("a", "s1", endOf(1), { workType: "feature" }),
      done("b", "s1", endOf(1), { workType: "feature" }),
      done("c", "s1", endOf(1), { workType: "feature" }),
      done("d", "s1", endOf(1), { workType: "defect" }),
      done("e", "s1", endOf(1)),
    ];
    const periods = mixByPeriod({ board: "sprint", stories, sprints: [s1], cards: [] });
    const gaps = targetGaps(periods, { feature: 60, defect: 15, debt: 15, risk: 10 });
    expect(gaps).toEqual([
      { type: "feature", target: 60, delivered: 75, gap: 15 },
      { type: "defect", target: 15, delivered: 25, gap: 10 },
      { type: "debt", target: 15, delivered: 0, gap: -15 },
      { type: "risk", target: 10, delivered: 0, gap: -10 },
    ]);
    expect(gapLabel(gaps[2])).toBe("Debt 0% vs 15% target");
    expect(targetGaps(periods, null)).toEqual([]);
    expect(mixTotals(periods)).toMatchObject({ finished: 5, unsorted: 1 });
  });
});

describe("the repeat-work trend", () => {
  const manySprints = (n: number, failing: (i: number) => boolean) => {
    const sprints = Array.from({ length: n }, (_, i) => sprintN(i + 1));
    const stories = sprints.flatMap((s, i) =>
      Array.from({ length: 4 }, (_, k) =>
        done(
          `${s.id}-${k}`,
          s.id,
          s.endDate,
          k < (failing(i) ? i % 4 : 0) ? { demand: "failure" } : {}
        )
      )
    );
    return { sprints, stories };
  };

  it("waits for 10 periods with finished work, across every period, not the window", () => {
    expect(FLOW_TREND_MIN).toBe(10);
    const nine = manySprints(9, () => true);
    expect(failureTrend(mixByPeriod({ board: "sprint", ...nine, cards: [] }), "sprint")).toBeNull();
    const twelve = manySprints(12, () => true);
    const all = mixByPeriod({ board: "sprint", ...twelve, cards: [] });
    const trend = failureTrend(all, "sprint");
    expect(trend?.n).toBe(12);
    expect(trend?.sentence).toMatch(/over the last 12 sprints \(Mann-Kendall p = /);
    expect(windowOf(all, 3)).toHaveLength(3);
  });
});

describe("the whole read", () => {
  it("picks the Sprint board when a sprint finished, else the Flow board", () => {
    expect(defaultBoard({ sprints: [sprintN(1)], cards: [] })).toBe("sprint");
    expect(defaultBoard({ sprints: [], cards: [card("c", { column: "done" })] })).toBe("flow");
    expect(defaultBoard({ sprints: [], cards: [] })).toBe("sprint");
  });

  it("reads the target from the workflow definition and says it in the verdict, with counts only", () => {
    const sprints = [sprintN(1), sprintN(2)];
    const stories = [
      done("a", "s1", endOf(1), { workType: "feature", owner: "Ana" }),
      done("b", "s2", endOf(2), { workType: "defect", owner: "Ben" }),
      done("c", "s2", endOf(2), { owner: "Ben" }),
    ];
    const workflow = withTargetSplit(
      { id: WORKFLOW_DEFINITION_ID },
      { feature: 60, defect: 15, debt: 15, risk: 10 },
      "2026-01-01T00:00:00.000Z"
    );
    const x = flowInsights({
      board: null,
      stories,
      sprints,
      cards: [],
      plans: [],
      workflow,
      periods: 3,
      today: "2026-02-10",
      now: Date.parse("2026-02-10T12:00:00Z"),
    });
    expect(x.board).toBe("sprint");
    expect(x.target).toEqual({ feature: 60, defect: 15, debt: 15, risk: 10 });
    expect(x.verdict).toContain("3 items finished over the last 2 sprints");
    expect(x.verdict).toContain("33% of it repeat work");
    expect(x.verdict).toContain("1 isn't sorted yet.");
    expect(x.verdict).toContain("The team changed in Sprint 2 (1 joined, 1 left).");
    expect(x.verdict).not.toMatch(/Ana|Ben/);
    expect(x.cycleP85).toBeNull();
    expect(x.blocked.pct).toBeNull();
  });

  it("says when nothing has finished", () => {
    const x = flowInsights({
      board: "flow",
      stories: [],
      sprints: [],
      cards: [],
      plans: undefined,
      workflow: undefined,
      periods: 4,
      today: "2026-02-10",
      now: 0,
    });
    expect(x.verdict).toMatch(/^Nothing finished yet on the Flow board/);
  });
});

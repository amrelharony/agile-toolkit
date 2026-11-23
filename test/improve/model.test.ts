// @vitest-environment node
/**
 * Improve's pure model (lib/improve/model and lib/improve/coaching): stored
 * rows read safely, the changers within the CRUD's caps, a Kata experiment
 * that can't run without what the team expects, when a step is done
 * (directly, through Retro Actions and its carried copies, or the backlog),
 * every A3 gap line shown and cleared, progress both ways, Reached it, the
 * verdicts, and a coaching talk saved as one change.
 */

import { describe, expect, it } from "vitest";
import {
  ENTITY_ROW_MAX_BYTES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type Improvement,
  type ImprovementStep,
  type RetroBoard,
  type RetroCard,
  type RootCauseAnalysis,
  type Story,
} from "@/lib/stores/workspace-types";
import {
  A3_GAP_TEXT,
  a3Gaps,
  blankImprovement,
  coachingDue,
  composeCondition,
  fitsRow,
  improveVerdict,
  itemVerdict,
  kataChecks,
  lastExperiment,
  latestReading,
  progressToTarget,
  readImprovement,
  readImprovements,
  sortedReadings,
  stepDoneIn,
  validateImprovementDraft,
  validateStep,
  withCondition,
  withObstacle,
  withObstaclePatch,
  withReading,
  withStatus,
  withStep,
  withStepPatch,
  withTargetReached,
  withoutStep,
  withStepAt,
  type A3GapId,
} from "@/lib/improve/model";
import { COACH_STEPS, coachStepsFor, withCoaching } from "@/lib/improve/coaching";
import { IMPROVEMENT } from "../stores/phase43-fixtures";

const NOW = "2026-11-20T10:00:00.000Z";
const TODAY = "2026-11-20";

function improvement(over: Partial<Improvement> = {}): Improvement {
  return {
    id: "improve_a",
    title: "Releases wait six days",
    method: "a3",
    status: "open",
    background: "",
    current: { text: "" },
    target: { text: "" },
    obstacles: [],
    steps: [],
    readings: [],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...over,
  };
}

const step = (over: Partial<ImprovementStep> & Pick<ImprovementStep, "id">): ImprovementStep => ({
  text: `Step ${over.id}`,
  status: "planned",
  ...over,
});

const card = (over: Partial<RetroCard> & Pick<RetroCard, "id">): RetroCard => ({
  columnKey: "actions",
  text: over.id,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...over,
});

const board = (id: string, cards: RetroCard[], archivedAt?: string): RetroBoard =>
  ({ id, cards, ...(archivedAt ? { archivedAt } : {}) }) as unknown as RetroBoard;

const story = (over: Partial<Story> & Pick<Story, "id">): Story =>
  ({ title: over.id, status: "todo", ...over }) as Story;

const gapIds = (item: Improvement, opts?: Parameters<typeof a3Gaps>[1]) =>
  a3Gaps(item, opts).map((g) => g.id);

describe("reading stored rows", () => {
  it("keeps every field of a good row", () => {
    expect(readImprovement(IMPROVEMENT)).toEqual(IMPROVEMENT);
  });

  it("caps text, drops bad rows and reads unknown values as the first", () => {
    const read = readImprovement({
      id: "improve_x",
      title: "x".repeat(400),
      method: "lean",
      status: "paused",
      background: 42,
      current: { text: "Now", value: "6", date: "2026-02-30", unit: "u".repeat(40) },
      target: null,
      obstacles: [
        { id: "o1", text: "One", status: "working" },
        { id: "o2", text: "Two", status: "working" },
        { id: "o3", text: "  ", status: "open" },
        { text: "No id", status: "open" },
        { id: "o4", text: "Odd", status: "stuck" },
      ],
      steps: [
        { id: "s1", text: "Try", status: "later", doneAt: NOW },
        { id: "s2", text: "", status: "done" },
        { id: "s3", text: "Due", due: "soon", status: "done", doneAt: NOW },
      ],
      readings: [
        { id: "r1", date: "2026-11-01", value: 3 },
        { id: "r2", date: "yesterday", value: 3 },
        { id: "r3", date: "2026-11-02", value: Number.NaN },
      ],
      sentTo: [{ route: "nowhere", targetId: "t", at: NOW }],
      closedAt: NOW,
      createdAt: "2026-11-01T09:00:00.000Z",
      updatedAt: "2026-11-02T09:00:00.000Z",
    })!;
    expect(read.title).toHaveLength(TOOL_TEXT_MAX.short);
    expect(read.title.endsWith("…")).toBe(true);
    expect(read.method).toBe("a3");
    expect(read.status).toBe("open");
    expect(read.background).toBe("");
    expect(read.current).toEqual({ text: "Now", unit: "u".repeat(20).slice(0, 19) + "…" });
    expect(read.target).toEqual({ text: "" });
    expect(read.obstacles.map((o) => [o.id, o.status])).toEqual([
      ["o1", "working"],
      ["o2", "open"],
      ["o4", "open"],
    ]);
    expect(read.steps.map((s) => [s.id, s.status, s.doneAt, s.due])).toEqual([
      ["s1", "planned", undefined, undefined],
      ["s3", "done", NOW, undefined],
    ]);
    expect(read.readings.map((r) => r.id)).toEqual(["r1"]);
    expect(read.sentTo).toBeUndefined();
    expect(read.closedAt).toBeUndefined();
  });

  it("cuts lists to their caps and refuses what isn't an improvement", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      id: `s${i}`,
      text: "Try",
      status: "planned",
    }));
    expect(readImprovement({ ...improvement(), steps: many })!.steps).toHaveLength(
      TOOL_LIST_MAX.improveSteps
    );
    expect(readImprovement(null)).toBeNull();
    expect(readImprovement([])).toBeNull();
    expect(readImprovement({ title: "No id" })).toBeNull();
    expect(readImprovements("nope")).toEqual([]);
    expect(readImprovements([improvement(), 7, { id: "" }]).map((i) => i.id)).toEqual([
      "improve_a",
    ]);
  });
});

describe("starting one", () => {
  it("validates the draft: a title within its cap and a method", () => {
    expect(validateImprovementDraft({ title: "  ", method: "" })).toEqual({
      ok: false,
      errors: {
        title: "Name what you'll improve in a few words.",
        method: "Pick an A3 or an Improvement Kata.",
      },
    });
    expect(validateImprovementDraft({ title: "x".repeat(201), method: "a3" }).ok).toBe(false);
    expect(validateImprovementDraft({ title: " Reviews   wait ", method: "kata" })).toEqual({
      ok: true,
      values: { title: "Reviews wait", method: "kata" },
    });
  });

  it("makes an open, empty improvement stamped now", () => {
    const item = blankImprovement({ title: "Faster reviews", method: "kata" }, "improve_n", NOW);
    expect(item).toEqual({
      id: "improve_n",
      title: "Faster reviews",
      method: "kata",
      status: "open",
      background: "",
      current: { text: "" },
      target: { text: "" },
      obstacles: [],
      steps: [],
      readings: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
});

describe("changes", () => {
  it("adds steps up to the cap and refuses one more", () => {
    const full = improvement({
      steps: Array.from({ length: TOOL_LIST_MAX.improveSteps }, (_, i) => step({ id: `s${i}` })),
    });
    expect(withStep(full, { text: "One more" }, "x", NOW)).toEqual({
      ok: false,
      reason: "list_full",
    });
    const added = withStep(
      improvement(),
      { text: " Automate the checks ", owner: "Sam" },
      "s1",
      NOW
    );
    expect(added.ok && added.item.steps).toEqual([
      { id: "s1", text: "Automate the checks", owner: "Sam", status: "planned" },
    ]);
    expect(added.ok && added.item.updatedAt).toBe(NOW);
    expect(withStep(improvement(), { text: "  " }, "s1", NOW)).toEqual({
      ok: false,
      reason: "blank",
    });
    expect(withStep(improvement(), { text: "T", due: "2026-02-30" }, "s1", NOW)).toEqual({
      ok: false,
      reason: "bad_due",
    });
    expect(withStep(improvement(), { text: "T", obstacleId: "o9" }, "s1", NOW)).toEqual({
      ok: false,
      reason: "unknown_obstacle",
    });
  });

  it("a Kata experiment can't run or be done without what the team expects; an A3 step can", () => {
    expect(validateStep("kata", { status: "running" })).toBe("needs_expect");
    expect(validateStep("kata", { status: "done", expect: "  " })).toBe("needs_expect");
    expect(validateStep("kata", { status: "planned" })).toBeNull();
    expect(validateStep("kata", { status: "running", expect: "Wait drops" })).toBeNull();
    expect(validateStep("a3", { status: "done" })).toBeNull();
    const kata = improvement({ method: "kata", steps: [step({ id: "s1" })] });
    expect(withStepPatch(kata, "s1", { status: "running" }, NOW)).toEqual({
      ok: false,
      reason: "needs_expect",
    });
    expect(withStep(kata, { text: "Try", status: "running" }, "s2", NOW)).toEqual({
      ok: false,
      reason: "needs_expect",
    });
  });

  it("stamps doneAt when a step is done and drops it when it isn't", () => {
    const item = improvement({ steps: [step({ id: "s1" })] });
    const done = withStepPatch(item, "s1", { status: "done" }, NOW);
    expect(done.ok && done.item.steps[0]).toEqual({
      ...step({ id: "s1" }),
      status: "done",
      doneAt: NOW,
    });
    const undone = done.ok ? withStepPatch(done.item, "s1", { status: "running" }, NOW) : done;
    expect(undone.ok && undone.item.steps[0].doneAt).toBeUndefined();
    expect(withStepPatch(item, "nope", { text: "x" }, NOW)).toEqual({
      ok: false,
      reason: "unknown_step",
    });
  });

  it("removes a step and puts it back where it was", () => {
    const item = improvement({
      steps: [step({ id: "s1" }), step({ id: "s2" }), step({ id: "s3" })],
    });
    const gone = withoutStep(item, "s2", NOW)!;
    expect(gone.steps.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(withStepAt(gone, item.steps[1], 1, NOW).steps.map((s) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(withoutStep(item, "nope", NOW)).toBeNull();
  });

  it("keeps one obstacle worked on at a time, only on a Kata, within the cap", () => {
    const kata = improvement({
      method: "kata",
      obstacles: [
        { id: "o1", text: "One", status: "working" },
        { id: "o2", text: "Two", status: "open" },
      ],
    });
    const picked = withObstaclePatch(kata, "o2", { status: "working" }, NOW)!;
    expect(picked.obstacles.map((o) => o.status)).toEqual(["open", "working"]);
    expect(withObstacle(improvement(), "In the way", "o9", NOW)).toEqual({
      ok: false,
      reason: "not_kata",
    });
    const full = improvement({
      method: "kata",
      obstacles: Array.from({ length: TOOL_LIST_MAX.kataObstacles }, (_, i) => ({
        id: `o${i}`,
        text: "x",
        status: "open" as const,
      })),
    });
    expect(withObstacle(full, "One more", "o99", NOW)).toEqual({ ok: false, reason: "list_full" });
  });

  it("logs readings up to the cap, never for a later day", () => {
    const item = improvement();
    expect(withReading(item, { date: "2026-11-21", value: 3 }, "r1", NOW, TODAY)).toEqual({
      ok: false,
      reason: "future_date",
    });
    expect(withReading(item, { date: "2026-13-01", value: 3 }, "r1", NOW, TODAY)).toEqual({
      ok: false,
      reason: "bad_date",
    });
    const full = improvement({
      readings: Array.from({ length: TOOL_LIST_MAX.improveReadings }, (_, i) => ({
        id: `r${i}`,
        date: "2026-11-01",
        value: i,
      })),
    });
    expect(withReading(full, { date: TODAY, value: 1 }, "rx", NOW, TODAY)).toEqual({
      ok: false,
      reason: "list_full",
    });
    const ok = withReading(
      item,
      { date: TODAY, value: 3, note: " After pairing " },
      "r1",
      NOW,
      TODAY
    );
    expect(ok.ok && ok.item.readings).toEqual([
      { id: "r1", date: TODAY, value: 3, note: "After pairing" },
    ]);
  });

  it("stamps closedAt when closed or dropped, and clears it when open again", () => {
    const closed = withStatus(improvement(), "closed", NOW);
    expect(closed.closedAt).toBe(NOW);
    expect(withStatus(closed, "dropped", "2026-11-21T00:00:00.000Z").closedAt).toBe(NOW);
    expect(withStatus(closed, "checking", NOW).closedAt).toBeUndefined();
  });

  it("changes a condition field by field and clears a number", () => {
    const item = withCondition(
      improvement(),
      "target",
      { text: "One day", value: 1, unit: "days" },
      NOW
    );
    expect(item.target).toEqual({ text: "One day", value: 1, unit: "days" });
    expect(
      withCondition(item, "target", { value: undefined, date: "2026-12-01" }, NOW).target
    ).toEqual({
      text: "One day",
      unit: "days",
      date: "2026-12-01",
    });
  });
});

describe("when a step is done", () => {
  const sent = (route: "retro-action" | "backlog-story", targetId: string) => ({
    route,
    targetId,
    at: NOW,
  });

  it("is done by its own status, its day the doneAt", () => {
    const done = stepDoneIn({ boards: [], stories: [] });
    expect(done(step({ id: "s1", status: "done", doneAt: NOW }))).toEqual({
      done: true,
      day: TODAY,
    });
    expect(done(step({ id: "s1" }))).toEqual({ done: false });
  });

  it("is done through its retro action, or a carried copy of it that was done", () => {
    const s = step({ id: "s1", sentTo: [sent("retro-action", "c1")] });
    const open = stepDoneIn({
      boards: [board("retro:current", [card({ id: "c1" })])],
      stories: [],
    });
    expect(open(s)).toEqual({ done: false });
    const ticked = stepDoneIn({
      boards: [
        board("retro:current", [
          card({ id: "c1", done: true, doneAt: "2026-11-18T12:00:00.000Z" }),
        ]),
      ],
      stories: [],
    });
    expect(ticked(s)).toEqual({ done: true, day: "2026-11-18" });
    const carried = stepDoneIn({
      boards: [
        board("retro:old", [card({ id: "c1" })], "2026-11-10T00:00:00.000Z"),
        board("retro:current", [
          card({ id: "c2", carriedFrom: "c1", done: true, doneAt: "2026-11-19T12:00:00.000Z" }),
        ]),
      ],
      stories: [],
    });
    expect(carried(s)).toEqual({ done: true, day: "2026-11-19" });
    // The action was deleted there: the step reads as open again.
    expect(stepDoneIn({ boards: [], stories: [] })(s)).toEqual({ done: false });
  });

  it("is done when its backlog story is, or its action's own target is", () => {
    const toStory = step({ id: "s1", sentTo: [sent("backlog-story", "st1")] });
    const stories = [story({ id: "st1", status: "done", doneAt: "2026-11-17T08:00:00.000Z" })];
    expect(stepDoneIn({ boards: [], stories })(toStory)).toEqual({ done: true, day: "2026-11-17" });
    expect(stepDoneIn({ boards: [], stories: [story({ id: "st1" })] })(toStory)).toEqual({
      done: false,
    });
    const viaCard = step({ id: "s2", sentTo: [sent("retro-action", "c1")] });
    const boards = [
      board("retro:current", [card({ id: "c1", sentTo: [sent("backlog-story", "st1")] })]),
    ];
    expect(stepDoneIn({ boards, stories })(viaCard).done).toBe(true);
  });
});

describe("the A3 gap checks", () => {
  const full = improvement({
    background: "Customers wait a week for fixes.",
    current: { text: "Six days", value: 6, unit: "days", date: "2026-10-01" },
    target: { text: "One day", value: 1, unit: "days", date: "2026-12-31" },
    analysis: "The regression pass takes a day.",
    steps: [step({ id: "s1", owner: "Sam", due: "2026-11-30" })],
  });

  it("shows nothing for a complete A3 still being worked, and nothing for a Kata", () => {
    expect(gapIds(full)).toEqual([]);
    expect(gapIds({ ...full, method: "kata", background: "" })).toEqual([]);
  });

  it.each<[A3GapId, Partial<Improvement>]>([
    ["why", { background: "  " }],
    ["current-number", { current: { text: "Slow" } }],
    ["target-number", { target: { text: "Fast", value: 1 } }],
    ["target-is-current", { target: { text: "Same", value: 6, date: "2026-12-31" } }],
    ["cause", { analysis: undefined }],
    ["change", { steps: [step({ id: "s1", status: "dropped" })] }],
    ["owners", { steps: [step({ id: "s1", due: "2026-11-30" })] }],
  ])("shows %s while its field is missing, and clears once it is filled", (id, gap) => {
    expect(gapIds({ ...full, ...gap })).toEqual([id]);
    expect(a3Gaps({ ...full, ...gap })[0].text).toBe(A3_GAP_TEXT[id]);
    expect(gapIds(full)).not.toContain(id);
  });

  it("a linked analysis with a root cause stands in for the cause", () => {
    const linked = { id: "rca_1", rootCause: "Manual regression" } as RootCauseAnalysis;
    expect(gapIds({ ...full, analysis: undefined }, { analysis: linked })).toEqual([]);
    expect(
      gapIds({ ...full, analysis: undefined }, { analysis: { ...linked, rootCause: "" } })
    ).toEqual(["cause"]);
  });

  it("asks to measure again once every countermeasure is done, then what the check showed", () => {
    const done = {
      ...full,
      steps: [
        step({ id: "s1", status: "done", doneAt: "2026-11-15T09:00:00.000Z" }),
        step({ id: "s2", status: "dropped" }),
      ],
      readings: [{ id: "r1", date: "2026-11-10", value: 4 }],
    };
    expect(gapIds(done)).toEqual(["measure-again"]);
    const measured = {
      ...done,
      readings: [...done.readings, { id: "r2", date: "2026-11-15", value: 2 }],
    };
    expect(gapIds(measured)).toEqual(["check"]);
    expect(gapIds({ ...measured, check: "It halved." })).toEqual([]);
    // A done step with no known day holds back no reading.
    const undated = { ...done, steps: [step({ id: "s1", status: "done" })] };
    expect(gapIds(undated)).toEqual(["check"]);
    expect(gapIds({ ...undated, readings: [] })).toEqual(["measure-again"]);
  });

  it("never shows 6 with 7, or 8 with 9", () => {
    const bare = improvement();
    const ids = gapIds(bare);
    expect(ids).toEqual(["why", "current-number", "target-number", "cause", "change"]);
    expect(ids.length).toBeLessThanOrEqual(7);
  });

  it("reads a countermeasure done in Retro Actions as done", () => {
    const sentStep = step({
      id: "s1",
      sentTo: [{ route: "retro-action", targetId: "c1", at: NOW }],
    });
    const item = { ...full, steps: [sentStep] };
    const done = stepDoneIn({
      boards: [
        board("retro:current", [
          card({ id: "c1", done: true, doneAt: "2026-11-18T09:00:00.000Z" }),
        ]),
      ],
      stories: [],
    });
    expect(gapIds(item, { done })).toEqual(["measure-again"]);
  });
});

describe("progress towards the target", () => {
  it("runs from where things stood to the target at the latest reading, lower is better too", () => {
    const kata = improvement({
      current: { text: "", value: 19 },
      target: { text: "", value: 8 },
      readings: [
        { id: "r1", date: "2026-11-01", value: 19 },
        { id: "r3", date: "2026-11-15", value: 13 },
        { id: "r2", date: "2026-11-08", value: 15 },
      ],
    });
    expect(progressToTarget(kata)).toBe(55);
    expect(latestReading(kata)?.id).toBe("r3");
    expect(sortedReadings(kata).map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    const up = improvement({ current: { text: "", value: 2 }, target: { text: "", value: 10 } });
    expect(progressToTarget(up)).toBe(0);
    expect(progressToTarget({ ...up, readings: [{ id: "r", date: TODAY, value: 6 }] })).toBe(50);
    expect(progressToTarget({ ...up, readings: [{ id: "r", date: TODAY, value: 12 }] })).toBe(100);
  });

  it("holds a number when the start equals the target, and is null without both numbers", () => {
    const hold = improvement({ current: { text: "", value: 5 }, target: { text: "", value: 5 } });
    expect(progressToTarget(hold)).toBe(100);
    expect(progressToTarget({ ...hold, readings: [{ id: "r", date: TODAY, value: 4 }] })).toBe(0);
    expect(progressToTarget(improvement({ target: { text: "", value: 5 } }))).toBeNull();
    expect(progressToTarget(improvement({ current: { text: "", value: 5 } }))).toBeNull();
  });
});

describe("Reached it", () => {
  const kata = improvement({
    method: "kata",
    current: { text: "Most of a day", metric: "Wait", value: 19, unit: "h", date: "2026-11-01" },
    target: { text: "Under 8 h", metric: "Wait", value: 8, unit: "h", date: "2026-12-01" },
    readings: [
      { id: "r1", date: "2026-11-01", value: 19 },
      { id: "r2", date: "2026-11-19", value: 7 },
    ],
  });

  it("moves the target to the past ones and starts the next from the latest reading", () => {
    const next = withTargetReached(kata, NOW)!;
    expect(next.pastTargets).toEqual([{ ...kata.target, reachedAt: NOW }]);
    expect(next.current).toEqual({
      text: "Under 8 h",
      metric: "Wait",
      value: 7,
      unit: "h",
      date: "2026-11-19",
    });
    expect(next.target).toEqual({ text: "", metric: "Wait", unit: "h" });
    expect(progressToTarget(next)).toBeNull();
  });

  it("uses the target's value with no reading, keeps the newest past targets, and needs a target", () => {
    const next = withTargetReached({ ...kata, readings: [] }, NOW)!;
    expect(next.current.value).toBe(8);
    expect(next.current.date).toBe(TODAY);
    const crowded = {
      ...kata,
      pastTargets: Array.from({ length: TOOL_LIST_MAX.improvePastTargets }, (_, i) => ({
        text: `T${i}`,
        reachedAt: NOW,
      })),
    };
    const kept = withTargetReached(crowded, NOW)!.pastTargets!;
    expect(kept).toHaveLength(TOOL_LIST_MAX.improvePastTargets);
    expect(kept[0].text).toBe("T1");
    expect(kept[kept.length - 1].text).toBe("Under 8 h");
    expect(withTargetReached({ ...kata, target: { text: " " } }, NOW)).toBeNull();
  });
});

describe("conditions, checks and coaching days", () => {
  it("writes a condition in one line", () => {
    expect(
      composeCondition({
        text: "Under 8 h",
        metric: "Wait",
        value: 8,
        unit: "h",
        date: "2026-12-01",
      })
    ).toBe("Under 8 h: Wait 8 h by 2026-12-01");
    expect(composeCondition({ text: "", value: 6, date: "2026-11-01" }, "on")).toBe(
      "6 on 2026-11-01"
    );
    expect(composeCondition({ text: "" })).toBe("");
  });

  it("flags a Kata's passed target date and a planned try with no expectation", () => {
    const kata = improvement({
      method: "kata",
      target: { text: "Under 8 h", date: "2026-11-01" },
      steps: [step({ id: "s1" })],
    });
    expect(kataChecks(kata, TODAY).map((c) => c.id)).toEqual(["target-date", "expect"]);
    expect(kataChecks({ ...kata, status: "closed" }, TODAY)).toEqual([]);
    expect(kataChecks({ ...kata, method: "a3" }, TODAY)).toEqual([]);
  });

  it("says a coaching talk is due on its day or after, for an active Kata only", () => {
    const kata = improvement({ method: "kata", nextCoachingAt: TODAY });
    expect(coachingDue(kata, TODAY)).toBe(true);
    expect(coachingDue(kata, "2026-11-19")).toBe(false);
    expect(coachingDue({ ...kata, status: "dropped" }, TODAY)).toBe(false);
    expect(coachingDue({ ...kata, method: "a3" }, TODAY)).toBe(false);
    expect(coachingDue(improvement({ method: "kata" }), TODAY)).toBe(false);
  });
});

describe("verdicts", () => {
  const ctx = { today: TODAY };

  it("says one line per improvement", () => {
    const kata = improvement({ method: "kata" });
    expect(itemVerdict(kata, ctx)).toBe("Set the next target.");
    const targeted = { ...kata, target: { text: "Under 8 h" } };
    expect(itemVerdict(targeted, ctx)).toBe("Pick the obstacle you're on.");
    const obstacle = {
      ...targeted,
      obstacles: [{ id: "o1", text: "One reviewer", status: "working" as const }],
    };
    expect(itemVerdict(obstacle, ctx)).toBe("Plan the next experiment.");
    expect(itemVerdict({ ...obstacle, nextCoachingAt: TODAY }, ctx)).toBe(
      "The coaching talk is due."
    );
    expect(itemVerdict({ ...kata, status: "dropped" }, ctx)).toBe("Dropped.");
    expect(itemVerdict(improvement(), ctx)).toBe(A3_GAP_TEXT.why);
    expect(
      itemVerdict(
        improvement({
          status: "closed",
          current: { text: "", value: 6 },
          target: { text: "", value: 1 },
        }),
        ctx
      )
    ).toBe("Closed, 0% of the way to the target.");
  });

  it("says one sentence across them", () => {
    expect(improveVerdict([], ctx)).toBe("No improvement yet.");
    expect(improveVerdict([improvement({ status: "closed" })], ctx)).toMatch(/closed or dropped/);
    expect(improveVerdict([improvement({ method: "kata", nextCoachingAt: TODAY })], ctx)).toBe(
      "1 coaching talk is due: walk it with Coach me."
    );
    expect(
      improveVerdict(
        [
          improvement({
            steps: [step({ id: "s1", status: "done", doneAt: NOW })],
          }),
        ],
        ctx
      )
    ).toBe("1 A3 has every countermeasure done: measure again to see whether it worked.");
    expect(
      improveVerdict(
        [
          improvement({ current: { text: "", value: 6 }, target: { text: "", value: 1 } }),
          improvement({
            id: "improve_b",
            current: { text: "", value: 0 },
            target: { text: "", value: 10 },
            readings: [{ id: "r", date: TODAY, value: 5 }],
          }),
        ],
        ctx
      )
    ).toBe("2 improvements under way, 25% of the way to target on average.");
    expect(improveVerdict([improvement()], ctx)).toMatch(/give each a number/);
  });
});

describe("row size", () => {
  it("fits one synced row at the CRUD's caps for typical text, and refuses a giant one", () => {
    expect(fitsRow(IMPROVEMENT)).toBe(true);
    const giant = improvement({
      steps: Array.from({ length: TOOL_LIST_MAX.improveSteps }, (_, i) =>
        step({
          id: `s${i}`,
          text: "界".repeat(TOOL_TEXT_MAX.text),
          expect: "界".repeat(TOOL_TEXT_MAX.text),
          result: "界".repeat(TOOL_TEXT_MAX.text),
          learned: "界".repeat(TOOL_TEXT_MAX.text),
        })
      ),
    });
    expect(new TextEncoder().encode(JSON.stringify(giant)).length).toBeGreaterThan(
      ENTITY_ROW_MAX_BYTES
    );
    expect(fitsRow(giant)).toBe(false);
  });
});

describe("the coaching talk", () => {
  const kata = improvement({
    method: "kata",
    current: { text: "Most of a day", value: 19, unit: "h" },
    target: { text: "Under 8 h", value: 8, unit: "h", date: "2026-12-01" },
    obstacles: [
      { id: "o1", text: "One reviewer", status: "working" },
      { id: "o2", text: "Big pull requests", status: "open" },
    ],
    steps: [step({ id: "s1", text: "Review slot", expect: "Wait drops", status: "running" })],
  });
  const ids = { reading: "r9", obstacle: "o9", step: "s9" };
  const days = { today: TODAY, latestDay: TODAY };

  it("asks six things in our order, skipping Since last time with no try yet", () => {
    expect(COACH_STEPS.map((s) => s.id)).toEqual([
      "since",
      "number",
      "aim",
      "obstacle",
      "next-try",
      "next-look",
    ]);
    expect(coachStepsFor(kata)).toHaveLength(6);
    expect(coachStepsFor({ ...kata, steps: [] }).map((s) => s.id)[0]).toBe("number");
    expect(COACH_STEPS[0].question(kata)).toBe(
      "Last time you tried “Review slot”. What did you see, and what do you know now?"
    );
    expect(COACH_STEPS[2].question(kata)).toBe(
      "Is “Under 8 h” by 2026-12-01 still what you're aiming for?"
    );
    expect(lastExperiment(kata)?.id).toBe("s1");
  });

  it("saves every answer in one change", () => {
    const r = withCoaching(
      kata,
      {
        result: "It fell to 15 h",
        learned: "Who reviews matters more",
        reading: { date: TODAY, value: 15 },
        aim: "keep",
        obstacleId: "o2",
        nextTry: { text: "Cap PRs at 300 lines", expect: "Reviews start sooner" },
        nextLook: "2026-11-22",
      },
      ids,
      NOW,
      days
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { item, reading, experiment, reached } = r.outcome;
    expect({ reading, experiment, reached }).toEqual({
      reading: true,
      experiment: true,
      reached: false,
    });
    expect(item.steps[0]).toMatchObject({
      result: "It fell to 15 h",
      learned: "Who reviews matters more",
      status: "done",
      doneAt: NOW,
    });
    expect(item.steps[1]).toEqual({
      id: "s9",
      text: "Cap PRs at 300 lines",
      expect: "Reviews start sooner",
      obstacleId: "o2",
      status: "planned",
    });
    expect(item.readings).toEqual([{ id: "r9", date: TODAY, value: 15 }]);
    expect(item.obstacles.map((o) => o.status)).toEqual(["open", "working"]);
    expect(item.nextCoachingAt).toBe("2026-11-22");
    expect(item.updatedAt).toBe(NOW);
  });

  it("reaches the target, or adds a new obstacle to work on", () => {
    const r = withCoaching(
      kata,
      { aim: "reached", newObstacle: "Nobody owns the queue" },
      ids,
      NOW,
      days
    );
    expect(r.ok && r.outcome.reached).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.item.pastTargets).toHaveLength(1);
    expect(r.outcome.item.obstacles.find((o) => o.id === "o9")).toEqual({
      id: "o9",
      text: "Nobody owns the queue",
      status: "working",
    });
    expect(r.outcome.item.obstacles.find((o) => o.id === "o1")?.status).toBe("open");
  });

  it("refuses, saving nothing, a reading for a later day, a try with no expectation or a past next look", () => {
    expect(
      withCoaching(kata, { reading: { date: "2026-11-21", value: 3 } }, ids, NOW, days)
    ).toEqual({
      ok: false,
      refusal: { step: "number", reason: "future_date" },
    });
    expect(withCoaching(kata, { nextTry: { text: "Try", expect: " " } }, ids, NOW, days)).toEqual({
      ok: false,
      refusal: { step: "next-try", reason: "needs_expect" },
    });
    expect(withCoaching(kata, { nextLook: "2026-11-19" }, ids, NOW, days)).toEqual({
      ok: false,
      refusal: { step: "next-look", reason: "past_date" },
    });
  });

  it("keeps a try running when it never said what it expected", () => {
    const vague = { ...kata, steps: [step({ id: "s1", text: "Look", status: "planned" })] };
    const r = withCoaching(vague, { result: "Nothing changed" }, ids, NOW, days);
    expect(r.ok && r.outcome.item.steps[0]).toEqual({
      id: "s1",
      text: "Look",
      result: "Nothing changed",
      status: "planned",
    });
  });
});

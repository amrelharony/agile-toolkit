/**
 * Kanban's Definition of Workflow model (lib/kanban/workflow) and the
 * STATIK steps (lib/kanban/statik): a stored or agent-written definition is
 * read defensively at the CRUD's caps, a change merges with null clearing,
 * versions snapshot the WIP limits and keep the latest 12, the compare
 * reads the described board's items either side of a save behind the
 * minimum sample, and the SLE percentiles are Cycle Time's.
 */

import { describe, expect, it } from "vitest";
import {
  KANBAN_BOARD_ID,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_SLE_PERCENTILES,
  type KanbanCard,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { SLE_PERCENTILES } from "@/app/(tools)/cycle-time/types";
import {
  STAGE_POLICIES_MAX,
  WORKFLOW_TEXT_MAX,
  WORKFLOW_VERSIONS_MAX,
  blockNotedPayload,
  compareVersion,
  deliveryToday,
  describedBoard,
  mergeWorkflow,
  normalizeWorkflowDefinition,
  policyStages,
  sleFromHistory,
  sleText,
  stagePolicy,
  versionChanges,
  withSavedVersion,
  workflowItems,
  workflowSnapshot,
} from "@/lib/kanban/workflow";
import {
  BLOCKER_TEMPLATE,
  FINISH_TEMPLATE,
  POLICY_TEMPLATES,
  START_TEMPLATE,
  STATIK_CREDIT,
  STATIK_QUESTIONS,
  STATIK_STEPS,
  statikProgress,
} from "@/lib/kanban/statik";
import { DEFAULT_BLOCKER_CLUSTERS } from "@/lib/impediments/clusters";

const LIMITS = { backlog: 0, ready: 5, in_progress: 3, review: 3, done: 0 };
const AT = "2026-11-20T10:00:00.000Z";

const done = (id: string, start: string, end: string): KanbanCard => ({
  id,
  title: id,
  column: "done",
  class: "standard",
  createdAt: start,
  startedAt: `${start}T09:00:00.000Z`,
  completedAt: `${end}T15:00:00.000Z`,
});

const items = (cards: KanbanCard[]) =>
  workflowItems("flow", { boards: [{ id: KANBAN_BOARD_ID, cards, wipLimits: LIMITS }] });

describe("normalizeWorkflowDefinition", () => {
  it("reads garbage as an empty definition with the singleton id", () => {
    expect(normalizeWorkflowDefinition(null)).toEqual({ id: WORKFLOW_DEFINITION_ID });
    expect(normalizeWorkflowDefinition("x")).toEqual({ id: WORKFLOW_DEFINITION_ID });
    expect(normalizeWorkflowDefinition({ id: "other", board: "gantt", junk: 1 })).toEqual({
      id: WORKFLOW_DEFINITION_ID,
    });
  });

  it("cuts every short text to the cap and drops blank ones", () => {
    const def = normalizeWorkflowDefinition({
      board: "flow",
      workItem: "x".repeat(400),
      startPoint: "   ",
      pullPolicy: "  Oldest first  ",
    });
    expect(def.workItem).toHaveLength(WORKFLOW_TEXT_MAX);
    expect(def.startPoint).toBeUndefined();
    expect(def.pullPolicy).toBe("Oldest first");
  });

  it("keeps one policy per stage, never Done, at most six", () => {
    const def = normalizeWorkflowDefinition({
      policies: [
        { stage: "review", exit: "Checked" },
        { stage: "review", exit: "Twice" },
        { stage: "done", enter: "Shipped" },
        { stage: "ready" },
        ...Array.from({ length: 8 }, (_, i) => ({ stage: `s${i}`, enter: "In" })),
      ],
    });
    expect(def.policies?.[0]).toEqual({ stage: "review", exit: "Checked" });
    expect(def.policies?.some((p) => p.stage === "done")).toBe(false);
    expect(def.policies?.some((p) => p.stage === "ready")).toBe(false);
    expect(def.policies).toHaveLength(STAGE_POLICIES_MAX);
  });

  it("checks work types, classes, the SLE, STATIK notes and cadences", () => {
    const def = normalizeWorkflowDefinition({
      workTypes: [
        { type: "debt", targetPct: 15, meaning: "Clean-up" },
        { type: "debt", targetPct: 20 },
        { type: "magic", targetPct: 5 },
        { type: "risk", targetPct: 140 },
        { type: "feature", targetPct: 60 },
      ],
      classPolicies: [
        { class: "expedite", policy: "One at a time" },
        { class: "vip", policy: "No" },
        { class: "standard", policy: "" },
      ],
      sle: { days: 8, pct: 80 },
      statik: { inside: "y".repeat(1500), mood: "bad", demand: "Twelve a week" },
      cadences: [
        { id: "c1", name: "Replenishment", cadence: "weekly", minutes: 300 },
        { name: "No id", cadence: "weekly" },
        { id: "c2", name: "Stand-up", cadence: "hourly" },
        ...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `M${i}`, cadence: "daily" })),
      ],
    });
    // In WORK_TYPES order, the first of a repeat, a bad share dropped.
    expect(def.workTypes).toEqual([
      { type: "feature", targetPct: 60 },
      { type: "debt", targetPct: 15, meaning: "Clean-up" },
    ]);
    expect(def.classPolicies).toEqual([{ class: "expedite", policy: "One at a time" }]);
    expect(def.sle).toBeUndefined();
    expect(def.statik?.inside).toHaveLength(1000);
    expect(def.statik).not.toHaveProperty("mood");
    expect(def.cadences?.[0]).toEqual({ id: "c1", name: "Replenishment", cadence: "weekly" });
    expect(def.cadences).toHaveLength(10);
    expect(normalizeWorkflowDefinition({ sle: { days: 8, pct: 85 } }).sle).toEqual({
      days: 8,
      pct: 85,
    });
  });

  it("keeps the latest twelve versions, each snapshot with every column's limit", () => {
    const versions = Array.from({ length: 15 }, (_, i) => ({
      version: i + 1,
      savedAt: AT,
      snapshot: { board: "flow", wipLimits: { review: 2, junk: 9 }, statik: { inside: "no" } },
    }));
    const def = normalizeWorkflowDefinition({
      versions: [...versions, { version: 0, savedAt: AT }],
    });
    expect(def.versions).toHaveLength(WORKFLOW_VERSIONS_MAX);
    expect(def.versions?.[0].version).toBe(4);
    expect(def.versions?.[0].snapshot).toEqual({
      board: "flow",
      wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 2, done: 0 },
    });
  });
});

describe("mergeWorkflow", () => {
  it("starts a definition, stamping both times", () => {
    const def = mergeWorkflow(null, { board: "flow", workItem: "A request" }, AT);
    expect(def).toEqual({
      id: WORKFLOW_DEFINITION_ID,
      board: "flow",
      workItem: "A request",
      createdAt: AT,
      updatedAt: AT,
    });
  });

  it("clears a field set to null, keeps one left out, and keeps createdAt", () => {
    const before: WorkflowDefinition = {
      id: WORKFLOW_DEFINITION_ID,
      board: "flow",
      workItem: "A request",
      pullPolicy: "Oldest first",
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    const next = mergeWorkflow(before, { pullPolicy: null, blockerPolicy: "Say why" }, AT);
    expect(next).toEqual({
      id: WORKFLOW_DEFINITION_ID,
      board: "flow",
      workItem: "A request",
      blockerPolicy: "Say why",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: AT,
    });
  });

  it("returns the same definition when nothing changes", () => {
    const before = mergeWorkflow(null, { board: "sprint" }, AT);
    expect(mergeWorkflow(before, { board: "sprint" }, "2026-12-01T00:00:00.000Z")).toBe(before);
  });
});

describe("versions", () => {
  const def = mergeWorkflow(null, { board: "flow", sle: { days: 8, pct: 85 } }, AT);

  it("snapshots the workflow and the board's limits, numbering from 1", () => {
    const { def: saved, version } = withSavedVersion(
      { ...def, statik: { inside: "Too much" } },
      { note: "First", expect: " " },
      LIMITS,
      AT
    );
    expect(version).toEqual({
      version: 1,
      savedAt: AT,
      note: "First",
      snapshot: { board: "flow", sle: { days: 8, pct: 85 }, wipLimits: LIMITS },
    });
    expect(saved.versions).toEqual([version]);
    const again = withSavedVersion(saved, {}, LIMITS, AT);
    expect(again.version.version).toBe(2);
  });

  it("keeps the latest twelve", () => {
    let cur = def;
    for (let i = 0; i < 14; i++) cur = withSavedVersion(cur, {}, LIMITS, AT).def;
    expect(cur.versions).toHaveLength(12);
    expect(cur.versions?.[11].version).toBe(14);
  });

  it("says what a version changed from the one before", () => {
    const a = workflowSnapshot(def, LIMITS);
    const b = workflowSnapshot(
      { ...def, policies: [{ stage: "review", exit: "Checked" }] },
      { ...LIMITS, review: 2 }
    );
    expect(versionChanges(a, b)).toEqual(["Review WIP 2 (was 3)", "Review policy"]);
    expect(versionChanges(null, b)).toEqual([]);
    const c = workflowSnapshot({ ...def, sle: { days: 6, pct: 85 } }, LIMITS);
    expect(versionChanges(a, c)).toEqual(["SLE 85% within 6 days (was 85% within 8 days)"]);
  });
});

describe("the SLE", () => {
  it("uses Cycle Time's percentiles", () => {
    expect([...WORKFLOW_SLE_PERCENTILES]).toEqual([...SLE_PERCENTILES]);
  });

  it("suggests the percentile of finished items' days from five items", () => {
    const four = [1, 2, 3, 4].map((n) => done(`c${n}`, "2026-10-01", `2026-10-0${n}`));
    expect(sleFromHistory(items(four))).toBeNull();
    const five = [...four, done("c5", "2026-10-01", "2026-10-09")];
    // Days 1, 2, 3, 4 and 9: the 85th percentile by nearest rank is 9.
    expect(sleFromHistory(items(five), 85)).toEqual({ days: 9, pct: 85, sample: 5 });
    expect(sleFromHistory(items(five), 50)).toEqual({ days: 3, pct: 50, sample: 5 });
  });

  it("reads as a line", () => {
    expect(sleText({ days: 8, pct: 85 })).toBe("SLE: 85% within 8 days");
    expect(sleText({ days: 1, pct: 50 })).toBe("SLE: 50% within 1 day");
    expect(sleText(undefined)).toBeNull();
  });
});

describe("compareVersion", () => {
  // Saved on 15 Oct; two weeks either side: 1–14 Oct and 15–28 Oct.
  const saved = withSavedVersion(
    mergeWorkflow(null, { board: "flow" }, AT),
    {},
    LIMITS,
    "2026-10-15T12:00:00.000Z"
  ).def;
  const before = [3, 5, 7, 9, 11].map((d, i) =>
    done(`b${i}`, "2026-10-02", `2026-10-${String(2 + d - 1).padStart(2, "0")}`)
  );
  const after = [2, 2, 3, 3, 4].map((d, i) =>
    done(`a${i}`, "2026-10-16", `2026-10-${String(16 + d - 1).padStart(2, "0")}`)
  );

  it("reads median, P85, throughput and WIP either side of the save", () => {
    const out = compareVersion(saved, items([...before, ...after]), {
      weeks: 2,
      today: "2026-11-20",
    })!;
    expect(out.version).toBe(1);
    expect(out.before).toMatchObject({ from: "2026-10-01", to: "2026-10-14", days: 14 });
    expect(out.after).toMatchObject({ from: "2026-10-15", to: "2026-10-28", days: 14 });
    expect(out.before).toMatchObject({ finished: 5, enough: true, median: 7, p85: 11 });
    expect(out.after).toMatchObject({ finished: 5, enough: true, median: 3, p85: 4 });
    expect(out.before.throughputPerWeek).toBe(2.5);
    expect(out.after.avgWip).toBeGreaterThan(0);
    expect(out.cutShort).toBe(false);
  });

  it("holds back cycle time below five finished items, and cuts the after window at today", () => {
    const out = compareVersion(saved, items([...before, ...after.slice(0, 3)]), {
      weeks: 4,
      today: "2026-10-20",
    })!;
    expect(out.cutShort).toBe(true);
    expect(out.after.to).toBe("2026-10-20");
    expect(out.after.days).toBe(6);
    expect(out.after).toMatchObject({ enough: false, median: null, p85: null });
  });

  it("is null for a version the definition doesn't have", () => {
    expect(compareVersion(saved, [], { version: 7 })).toBeNull();
    expect(compareVersion(null, [])).toBeNull();
  });
});

describe("boards, stages and policies", () => {
  it("lists every stage but Done for each board", () => {
    expect(policyStages("flow").map((s) => s.id)).toEqual([
      "backlog",
      "ready",
      "in_progress",
      "review",
    ]);
    expect(policyStages("sprint").map((s) => s.id)).toEqual(["todo", "in_progress", "review"]);
  });

  it("knows the board a definition describes and a stage's policy", () => {
    const def = normalizeWorkflowDefinition({
      board: "sprint",
      policies: [{ stage: "review", exit: "Checked" }],
    });
    expect(describedBoard(def)).toBe("sprint");
    expect(describedBoard({ id: WORKFLOW_DEFINITION_ID })).toBeNull();
    expect(stagePolicy(def, "review")).toEqual({ stage: "review", exit: "Checked" });
    expect(stagePolicy(def, "todo")).toBeUndefined();
  });

  it("reads what the board delivers today", () => {
    const cards = [1, 2, 3, 4, 5].map((n) => done(`c${n}`, "2026-10-01", `2026-10-0${n + 1}`));
    const d = deliveryToday(items(cards));
    expect(d.finished).toBe(5);
    expect(d.timed).toBe(5);
    expect(d.p85).toBe(6);
    expect(deliveryToday([])).toEqual({
      finished: 0,
      perWeek: null,
      weeks: 0,
      p85: null,
      timed: 0,
    });
  });
});

describe("the block note's history payload", () => {
  it("names a default cluster by its index and never carries text", () => {
    expect(
      blockNotedPayload("cardId", "c1", "another team", "external", DEFAULT_BLOCKER_CLUSTERS)
    ).toEqual({ cardId: "c1", cluster: "default", clusterIndex: 6, side: "external" });
    const custom = blockNotedPayload(
      "storyId",
      "s1",
      "Waiting on Legal's Dana",
      "external",
      DEFAULT_BLOCKER_CLUSTERS
    );
    expect(custom).toEqual({ storyId: "s1", cluster: "custom", side: "external" });
    expect(JSON.stringify(custom)).not.toContain("Dana");
    expect(blockNotedPayload("cardId", "c1", undefined, undefined, [])).toEqual({
      cardId: "c1",
      cluster: "none",
    });
  });
});

describe("STATIK", () => {
  it("has seven steps, each writing a note the definition keeps", () => {
    expect(STATIK_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STATIK_STEPS.flatMap((s) => s.fields.map((f) => f.key))).toEqual([
      "inside",
      "outside",
      "demand",
      "capability",
      "workflow",
      "classes",
      "design",
      "rollout",
    ]);
    expect(STATIK_CREDIT).toBe(
      "STATIK comes from Kanban University; the steps here are in our words"
    );
  });

  it("counts a step written when any of its notes is, and step 7 by its cadences too", () => {
    expect(statikProgress(undefined).done).toBe(0);
    expect(statikProgress({ outside: "Long waits", design: " " }).steps).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    const withCadence = statikProgress({}, [{ id: "c", name: "Replenish", cadence: "weekly" }]);
    expect(withCadence).toMatchObject({ done: 1, total: 7 });
    expect(withCadence.steps[6]).toBe(true);
  });

  it("keeps every template and question within the policy cap", () => {
    const texts = [
      ...Object.values(POLICY_TEMPLATES).flatMap((p) => [p.enter, p.exit]),
      START_TEMPLATE,
      FINISH_TEMPLATE,
      BLOCKER_TEMPLATE,
      ...STATIK_QUESTIONS,
    ];
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(WORKFLOW_TEXT_MAX);
    expect(STATIK_QUESTIONS).toHaveLength(3);
    for (const stage of [...policyStages("flow"), ...policyStages("sprint")]) {
      expect(POLICY_TEMPLATES[stage.id], stage.id).toBeDefined();
    }
  });
});

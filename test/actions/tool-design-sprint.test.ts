/**
 * tool.design_sprint.* coverage (singleton doc, S11), on the rebuilt page's
 * document:
 *
 *   1. registration — list_state read; the rest write, with MCP handlers.
 *   2. start_sprint — the page's checklist, a derived day, won't replace.
 *   3. tasks — add, toggle, ids from list_state.
 *   4. outputs — each kind on its day, one goal/decision/prototype, the
 *      page's link and finding rules, old artifacts edited as notes, answers.
 *   5. the team's working days place the five days; the MCP path agrees.
 *   6. the page's slots follow the shared kind rules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type DesignSprint,
  type DesignSprintPlan,
} from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import { DEFAULT_DESIGN_SPRINT_TASKS } from "@/lib/design-sprint/plan";
import { DESIGN_SPRINT_ID, OUTPUT_KINDS, legacyNoteId } from "@/lib/design-sprint/doc";
import { DAY_SLOTS } from "@/app/(tools)/design-sprint/outputs";

import "@/lib/actions/tools/design-sprint";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
// As the MCP and agent runtimes do: the params go through the schema first.
const run = <T>(path: "handler" | "mcpHandler", verb: string, params: Record<string, unknown>) => {
  const action = registry.get(`tool.design_sprint.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", verb, params);

const stored = () =>
  (useWorkspaceStore.getState().designSprints ?? []).find((d) => d.id === DESIGN_SPRINT_ID)
    ?.sprint ?? null;

interface Output {
  id: string;
  kind: string;
  text: string;
  url: string | null;
  signal?: string | null;
  seenIn?: number | null;
  answer?: string | null;
}
interface State {
  exists: boolean;
  sprint: {
    id: string;
    status: string;
    day: number | null;
    startsIn?: number;
    currentDay: number;
    dates: string[];
    totalTasks: number;
    doneTasks: number;
    days: {
      day: number;
      dayName: string;
      date: string | null;
      taskCount: number;
      doneCount: number;
      tasks: { id: string; text: string; done: boolean; owner: string | null }[];
      outputs: Output[];
    }[];
    questions: { id: string; text: string; answer: string | null }[];
    findings: { total: number; sent: number };
  } | null;
}

const VERBS = [
  "start_sprint",
  "add_task",
  "toggle_task",
  "add_output",
  "update_output",
  "remove_output",
  "set_answer",
  "complete_sprint",
];

beforeEach(() => {
  vi.useFakeTimers();
  // Saturday 24 October 2026.
  vi.setSystemTime(new Date("2026-10-24T10:00:00"));
  rows.clear();
  useWorkspaceStore.setState({ designSprints: [], ceremonyCadences: [] });
});
afterEach(() => vi.useRealTimers());

describe("tool.design_sprint — registration", () => {
  it("list_state reads; the rest write, without confirmation, on both paths", () => {
    expect(registry.get("tool.design_sprint.list_state")?.category).toBe("read");
    for (const verb of VERBS) {
      const action = registry.get(`tool.design_sprint.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe("tool.design_sprint.start_sprint", () => {
  it("starts with the page's checklist and the day derived from the start date", async () => {
    expect(await call("start_sprint", { name: "Onboarding", startDate: "2026-10-26" })).toEqual({
      started: true,
      id: expect.any(String),
    });
    const r = await call<State>("list_state");
    expect(r.sprint).toMatchObject({
      status: "upcoming",
      day: null,
      startsIn: 1,
      currentDay: 1,
      dates: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"],
    });
    expect(r.sprint!.days.map((d) => d.dayName)).toEqual([
      "Map",
      "Sketch",
      "Decide",
      "Prototype",
      "Test",
    ]);
    expect(r.sprint!.days[0].tasks.map((t) => t.text)).toEqual([...DEFAULT_DESIGN_SPRINT_TASKS[1]]);
    expect(r.sprint!.days[0].date).toBe("2026-10-26");
  });

  it("defaults to today, in local time, and keeps currentDay at the shown day", async () => {
    await call("start_sprint", { name: "Now" });
    expect(stored()?.startDate).toBe("2026-10-24");
    // Starting on a Saturday begins on Monday.
    expect((await call<State>("list_state")).sprint?.dates[0]).toBe("2026-10-26");

    await call("start_sprint", { name: "Midweek", startDate: "2026-10-21", replace: true });
    // Wed, Thu, Fri, Mon, Tue: on the Saturday, day 3 was the last day worked.
    expect((await call<State>("list_state")).sprint).toMatchObject({
      status: "running",
      day: 3,
      currentDay: 3,
    });
    expect(stored()?.currentDay).toBe(3);
  });

  it("won't replace a sprint unless asked", async () => {
    const first = await call<{ id: string }>("start_sprint", { name: "First" });
    expect(await call("start_sprint", { name: "Second" })).toEqual({
      started: false,
      reason: "sprint_exists",
      id: first.id,
    });
    expect(stored()?.name).toBe("First");
    await call("start_sprint", { name: "Second", replace: true, decider: "Ana" });
    expect(stored()).toMatchObject({ name: "Second", decider: "Ana" });
  });
});

describe("tool.design_sprint tasks", () => {
  it("refuses before a sprint exists", async () => {
    expect(await call("add_task", { day: 1, text: "x" })).toEqual({
      added: false,
      reason: "no_sprint",
    });
    expect(await call("toggle_task", { taskId: "t" })).toEqual({ updated: false });
  });

  it("adds a task and toggles one by an id from list_state", async () => {
    await call("start_sprint", { name: "Onboarding", startDate: "2026-10-26" });
    const added = await call<{ added: boolean; id: string }>("add_task", {
      day: 2,
      text: "  Book the room ",
      owner: "Ana",
    });
    expect(added.added).toBe(true);
    let r = await call<State>("list_state");
    expect(r.sprint!.days[1].tasks.at(-1)).toEqual({
      id: added.id,
      text: "Book the room",
      done: false,
      owner: "Ana",
    });

    const first = r.sprint!.days[0].tasks[0].id;
    expect(await call("toggle_task", { taskId: first })).toEqual({ updated: true, done: true });
    expect(await call("toggle_task", { taskId: first, done: true })).toEqual({
      updated: true,
      done: true,
    });
    r = await call<State>("list_state");
    expect(r.sprint!.days[0].doneCount).toBe(1);
    expect(r.sprint!.doneTasks).toBe(1);
    expect(await call("toggle_task", { taskId: "nope" })).toEqual({ updated: false });
  });
});

describe("tool.design_sprint outputs", () => {
  beforeEach(async () => {
    await call("start_sprint", { name: "Onboarding", startDate: "2026-10-26" });
  });

  it("puts each kind on its day; a note on the day shown today", async () => {
    expect(await call("add_output", { kind: "long-term-goal", text: "Half the drop-off" })).toEqual(
      { added: true, id: expect.any(String), day: 1 }
    );
    expect(
      await call("add_output", {
        kind: "finding",
        text: "Nobody found the skip link",
        signal: "negative",
        seenIn: 4,
      })
    ).toMatchObject({ added: true, day: 5 });
    expect(await call("add_output", { kind: "note", text: "Room 3" })).toMatchObject({ day: 1 });
    expect(await call("add_output", { kind: "note", text: "Lunch", day: 4 })).toMatchObject({
      day: 4,
    });
    expect(await call("add_output", { kind: "decision", text: "x", day: 2 })).toEqual({
      added: false,
      reason: "wrong_day",
      day: 3,
    });

    const r = await call<State>("list_state");
    expect(r.sprint!.days[4].outputs[0]).toMatchObject({
      kind: "finding",
      signal: "negative",
      seenIn: 4,
      url: null,
    });
    expect(r.sprint!.findings).toEqual({ total: 1, sent: 0 });
  });

  it("keeps one goal, target, decision, storyboard and prototype", async () => {
    const goal = await call<{ id: string }>("add_output", { kind: "long-term-goal", text: "A" });
    expect(await call("add_output", { kind: "long-term-goal", text: "B" })).toEqual({
      added: false,
      reason: "already_set",
      id: goal.id,
    });
    expect(await call("update_output", { outputId: goal.id, text: "B" })).toEqual({
      updated: true,
      day: 1,
    });
    // Lists take many.
    await call("add_output", { kind: "sketch", text: "One" });
    expect(await call("add_output", { kind: "sketch", text: "Two" })).toMatchObject({
      added: true,
    });
  });

  it("follows the page's rules for links and the finding fields", async () => {
    expect(
      await call("add_output", { kind: "prototype", text: "Figma", url: "javascript:alert(1)" })
    ).toEqual({ added: false, reason: "invalid_url" });
    expect(
      await call("add_output", { kind: "decision", text: "Sketch 2", url: "https://x.test" })
    ).toEqual({ added: false, reason: "url_not_taken" });
    expect(await call("add_output", { kind: "sketch", text: "One", signal: "positive" })).toEqual({
      added: false,
      reason: "findings_only",
    });

    const proto = await call<{ id: string }>("add_output", {
      kind: "prototype",
      text: "Figma",
      url: "https://figma.test/p",
    });
    expect(await call("update_output", { outputId: proto.id, url: null })).toMatchObject({
      updated: true,
    });
    expect(stored()?.days[3].outputs?.[0]).not.toHaveProperty("url");
    expect(await call("update_output", { outputId: proto.id, seenIn: 3 })).toEqual({
      updated: false,
      reason: "findings_only",
    });
    expect(await call("update_output", { outputId: "nope", text: "x" })).toEqual({
      updated: false,
      reason: "unknown_output",
    });
  });

  it("removes an output, saying what it was", async () => {
    const sketch = await call<{ id: string }>("add_output", { kind: "sketch", text: "One" });
    expect(await call("remove_output", { outputId: sketch.id })).toEqual({
      removed: true,
      kind: "sketch",
      text: "One",
    });
    expect(await call("remove_output", { outputId: sketch.id })).toEqual({ removed: false });
  });

  it("answers the Map day's sprint questions", async () => {
    const q = await call<{ id: string }>("add_output", {
      kind: "sprint-question",
      text: "Will they trust it?",
    });
    expect(await call("set_answer", { questionId: q.id, answer: "yes" })).toEqual({
      updated: true,
    });
    expect((await call<State>("list_state")).sprint!.questions).toEqual([
      { id: q.id, text: "Will they trust it?", answer: "yes" },
    ]);
    await call("set_answer", { questionId: q.id, answer: null });
    expect(stored()?.days[0].outputs?.[0]).not.toHaveProperty("answer");

    const goal = await call<{ id: string }>("add_output", { kind: "long-term-goal", text: "G" });
    expect(await call("set_answer", { questionId: goal.id, answer: "no" })).toEqual({
      updated: false,
      reason: "unknown_question",
    });
  });

  it("completes and reopens the sprint", async () => {
    expect(await call("complete_sprint")).toEqual({
      updated: true,
      completedAt: expect.any(String),
    });
    expect((await call<State>("list_state")).sprint?.status).toBe("completed");
    expect(await call("complete_sprint")).toEqual({ updated: true, unchanged: true });
    await call("complete_sprint", { completed: false });
    expect(stored()).not.toHaveProperty("completedAt");
  });
});

describe("tool.design_sprint on an older document", () => {
  it("reads old artifacts as notes, and edits them in place by their stable id", async () => {
    const plan: DesignSprintPlan = {
      id: "p",
      name: "Old",
      startDate: "2026-10-26",
      currentDay: 2,
      days: [1, 2, 3, 4, 5].map((day) => ({
        day: day as 1 | 2 | 3 | 4 | 5,
        dayName: (["Map", "Sketch", "Decide", "Prototype", "Test"] as const)[day - 1],
        tasks: [],
        artifacts: day === 2 ? ["Crazy 8s", "https://photos.test/wall"] : [],
      })),
    };
    useWorkspaceStore.setState({
      designSprints: [{ id: DESIGN_SPRINT_ID, sprint: plan } satisfies DesignSprint],
    });

    const day2 = (await call<State>("list_state")).sprint!.days[1].outputs;
    expect(day2).toEqual([
      expect.objectContaining({ id: legacyNoteId(2, 0, "Crazy 8s"), kind: "note", url: null }),
      expect.objectContaining({ kind: "note", url: "https://photos.test/wall" }),
    ]);

    expect(
      await call("update_output", { outputId: legacyNoteId(2, 0, "Crazy 8s"), text: "Crazy 8s x6" })
    ).toEqual({ updated: true, day: 2 });
    const saved = stored()!.days[1];
    expect(saved.artifacts).toEqual([]);
    expect(saved.outputs?.map((o) => o.text)).toEqual(["Crazy 8s x6", "https://photos.test/wall"]);
    // Written today (a Saturday, before day 1): the shown day is 1.
    expect(stored()?.currentDay).toBe(1);
  });
});

describe("tool.design_sprint and the team's working days", () => {
  const cadence = { id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE, holidays: ["2026-10-27"] };

  it("places the five days around a team holiday", async () => {
    useWorkspaceStore.setState({ ceremonyCadences: [cadence] });
    await call("start_sprint", { name: "Holiday week", startDate: "2026-10-26" });
    expect((await call<State>("list_state")).sprint?.dates).toEqual([
      "2026-10-26",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-11-02",
    ]);
  });

  it("reads the same on the MCP path, from the server's rows", async () => {
    rows.set(`workspace:ceremonyCadence/${CEREMONY_CADENCE_ID}`, cadence);
    expect(await callMcp("start_sprint", { name: "Remote", startDate: "2026-10-26" })).toEqual({
      started: true,
      id: expect.any(String),
    });
    expect(await callMcp("add_output", { kind: "finding", text: "Liked it" })).toMatchObject({
      added: true,
      day: 5,
    });
    const r = await callMcp<State>("list_state");
    expect(r.sprint?.dates[1]).toBe("2026-10-28");
    expect(r.sprint?.days[4].outputs.map((o) => o.text)).toEqual(["Liked it"]);
    // Nothing reached the browser's workspace.
    expect(stored()).toBeNull();
    expect(await callMcp("start_sprint", { name: "Again" })).toMatchObject({
      started: false,
      reason: "sprint_exists",
    });
  });
});

describe("the page's slots follow the shared kind rules", () => {
  it("puts each kind on the day, singleness and link the agent actions use", () => {
    for (const [day, slots] of Object.entries(DAY_SLOTS)) {
      for (const slot of slots) {
        const rule = OUTPUT_KINDS[slot.kind];
        expect(rule.day ?? Number(day), slot.kind).toBe(Number(day));
        expect(rule.single, slot.kind).toBe(slot.single);
        expect(rule.link, slot.kind).toBe(slot.link);
      }
    }
    const placed = new Set(Object.values(DAY_SLOTS).flatMap((s) => s.map((x) => x.kind)));
    expect(Array.from(placed).sort()).toEqual(Object.keys(OUTPUT_KINDS).sort());
  });
});

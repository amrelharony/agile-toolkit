/**
 * tool.design_sprint.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; start_sprint/add_task/toggle_task write.
 *   2. start_sprint — builds the 5-day skeleton.
 *   3. add_task (refuses when no sprint / out of range) + toggle_task.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/design-sprint";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.design_sprint — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.design_sprint.list_state")?.category).toBe("read");
    for (const verb of ["start_sprint", "add_task", "toggle_task"]) {
      expect(registry.get(`tool.design_sprint.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.design_sprint.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.design_sprint.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.design_sprint lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ designSprints: [] }));

  it("refuses add_task before a sprint exists", async () => {
    const r = (await registry
      .get("tool.design_sprint.add_task")!
      .handler({ day: 1, text: "x" }, ctx())) as { added: boolean };
    expect(r.added).toBe(false);
  });

  it("starts a 5-day sprint, adds + toggles a task", async () => {
    const started = (await registry
      .get("tool.design_sprint.start_sprint")!
      .handler({ name: "Onboarding redesign" }, ctx())) as { started: boolean };
    expect(started.started).toBe(true);

    let r = (await registry.get("tool.design_sprint.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      sprint: { currentDay: number; days: { day: number; dayName: string; taskCount: number }[] };
    };
    expect(r.sprint.days).toHaveLength(5);
    expect(r.sprint.currentDay).toBe(1);
    expect(r.sprint.days[0].dayName).toBe("Map");

    const added = (await registry
      .get("tool.design_sprint.add_task")!
      .handler({ day: 1, text: "Interview users" }, ctx())) as { added: boolean; id: string };
    expect(added.added).toBe(true);

    const toggled = (await registry
      .get("tool.design_sprint.toggle_task")!
      .handler({ taskId: added.id }, ctx())) as { updated: boolean };
    expect(toggled.updated).toBe(true);

    r = (await registry.get("tool.design_sprint.list_state")!.handler({}, ctx())) as typeof r;
    const day1 = r.sprint.days.find((d) => d.day === 1)!;
    expect(day1.taskCount).toBe(1);
  });
});

type ListState = {
  exists: boolean;
  sprint: {
    name: string;
    startDate: string;
    totalTasks: number;
    doneTasks: number;
    days: { day: number; taskCount: number; doneCount: number }[];
  } | null;
};
const listState = async () =>
  (await registry.get("tool.design_sprint.list_state")!.handler({}, ctx())) as ListState;

describe("tool.design_sprint edge cases", () => {
  beforeEach(() => useWorkspaceStore.setState({ designSprints: [] }));

  it("list_state distinguishes no document from a reset (null) sprint", async () => {
    expect(await listState()).toEqual({ exists: false, sprint: null });
    useWorkspaceStore.getState().upsertDesignSprint({ id: "designSprint:current", sprint: null });
    expect(await listState()).toEqual({ exists: true, sprint: null });
  });

  it("start_sprint keeps an explicit date and replaces a previous sprint", async () => {
    const start = registry.get("tool.design_sprint.start_sprint")!;
    const first = (await start.handler({ name: "First", startDate: "2026-11-02" }, ctx())) as {
      id: string;
    };
    await registry.get("tool.design_sprint.add_task")!.handler({ day: 2, text: "Sketch" }, ctx());
    const second = (await start.handler({ name: "Second", startDate: "2026-12-07" }, ctx())) as {
      id: string;
    };
    expect(second.id).not.toBe(first.id);
    const r = await listState();
    expect(r.sprint).toMatchObject({ name: "Second", startDate: "2026-12-07", totalTasks: 0 });
    expect(useWorkspaceStore.getState().designSprints).toHaveLength(1);
  });

  it("add_task stores the owner and refuses a day that doesn't exist", async () => {
    await registry.get("tool.design_sprint.start_sprint")!.handler({ name: "S" }, ctx());
    const addTask = registry.get("tool.design_sprint.add_task")!;
    const ok = (await addTask.handler({ day: 5, text: "Interviews", owner: "Dana" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(ok.added).toBe(true);
    const stored = useWorkspaceStore.getState().designSprints![0].sprint!.days[4].tasks[0];
    expect(stored).toEqual({ id: ok.id, text: "Interviews", done: false, owner: "Dana" });

    // The schema bounds day to 1..5; the handler must still refuse a stray day.
    const bad = (await addTask.handler({ day: 9, text: "Nope" }, ctx())) as { added: boolean };
    expect(bad.added).toBe(false);
  });

  it("toggle_task honours an explicit done, flips otherwise, and rejects unknown ids", async () => {
    const toggle = registry.get("tool.design_sprint.toggle_task")!;
    expect(((await toggle.handler({ taskId: "x" }, ctx())) as { updated: boolean }).updated).toBe(
      false
    );

    await registry.get("tool.design_sprint.start_sprint")!.handler({ name: "S" }, ctx());
    const { id } = (await registry
      .get("tool.design_sprint.add_task")!
      .handler({ day: 1, text: "Goal" }, ctx())) as { id: string };
    await registry.get("tool.design_sprint.add_task")!.handler({ day: 1, text: "Map" }, ctx());

    await toggle.handler({ taskId: id, done: true }, ctx());
    await toggle.handler({ taskId: id, done: true }, ctx());
    let r = await listState();
    expect(r.sprint).toMatchObject({ totalTasks: 2, doneTasks: 1 });
    expect(r.sprint!.days[0]).toMatchObject({ taskCount: 2, doneCount: 1 });

    await toggle.handler({ taskId: id }, ctx());
    r = await listState();
    expect(r.sprint!.doneTasks).toBe(0);

    expect(
      ((await toggle.handler({ taskId: "missing" }, ctx())) as { updated: boolean }).updated
    ).toBe(false);
  });
});

// Bug: start_sprint defaulted startDate with `toISOString().slice(0, 10)` (a
// UTC day) — the very pattern the board replaced with todayLocalISO because
// it rolled to tomorrow in the evening west of UTC.
describe("tool.design_sprint.start_sprint — local default date", () => {
  const prevTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });
  beforeEach(() => {
    useWorkspaceStore.setState({ designSprints: [] });
    vi.useFakeTimers({ toFake: ["Date"] });
    // 22:30 on 17 Oct in Los Angeles is already 18 Oct in UTC.
    vi.setSystemTime(new Date("2026-10-18T05:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults startDate to today's local date", async () => {
    expect(new Date().getDate()).toBe(17);
    await registry.get("tool.design_sprint.start_sprint")!.handler({ name: "Late start" }, ctx());
    expect((await listState()).sprint?.startDate).toBe("2026-10-17");
  });
});

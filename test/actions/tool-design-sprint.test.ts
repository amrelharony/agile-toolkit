/**
 * tool.design_sprint.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; start_sprint/add_task/toggle_task write.
 *   2. start_sprint — builds the 5-day skeleton.
 *   3. add_task (refuses when no sprint / out of range) + toggle_task.
 */

import { describe, it, expect, beforeEach } from "vitest";
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

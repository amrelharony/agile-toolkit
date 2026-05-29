/**
 * tool.health_check.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; set_sprint_name/set_dimension/save_check/reset write.
 *   2. set_dimension + set_sprint_name + list_state — current health %.
 *   3. set_dimension refuses an unknown dimension.
 *   4. save_check snapshots current into history and resets current.
 *   5. reset clears current + history.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/health-check";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.health_check — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.health_check.list_state")?.category).toBe("read");
    for (const verb of ["set_sprint_name", "set_dimension", "save_check", "reset"]) {
      expect(registry.get(`tool.health_check.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.health_check.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.health_check.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.health_check lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ healthChecks: [] }));

  it("sets a dimension light + sprint name and computes current health", async () => {
    await registry
      .get("tool.health_check.set_sprint_name")!
      .handler({ sprintName: "Sprint 1" }, ctx());
    const r0 = (await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Fun", light: "red" }, ctx())) as { set: boolean };
    expect(r0.set).toBe(true);

    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      current: { sprintName: string; scores: Record<string, { light: string }> };
      currentHealth: number;
      checkCount: number;
    };
    expect(r.exists).toBe(true);
    expect(r.current.sprintName).toBe("Sprint 1");
    expect(r.current.scores["Fun"].light).toBe("red");
    // 7 of 8 dimensions still green => round(7/8*100) = 88.
    expect(r.currentHealth).toBe(88);
    expect(r.checkCount).toBe(0);
  });

  it("set_dimension refuses an unknown dimension", async () => {
    const r = (await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Ping Pong", light: "green" }, ctx())) as { set: boolean };
    expect(r.set).toBe(false);
  });

  it("save_check snapshots current into history and resets current", async () => {
    await registry
      .get("tool.health_check.set_sprint_name")!
      .handler({ sprintName: "Sprint 7" }, ctx());
    await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Speed", light: "red" }, ctx());

    const saved = (await registry.get("tool.health_check.save_check")!.handler({}, ctx())) as {
      saved: boolean;
      checkCount: number;
    };
    expect(saved.saved).toBe(true);
    expect(saved.checkCount).toBe(1);

    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      current: { sprintName: string };
      currentHealth: number;
      checkCount: number;
      history: { sprintName: string; health: number }[];
    };
    // history snapshot keeps the Speed=red check (88%).
    expect(r.history).toHaveLength(1);
    expect(r.history[0].sprintName).toBe("Sprint 7");
    expect(r.history[0].health).toBe(88);
    // current is reset: blank name, all green => 100%.
    expect(r.current.sprintName).toBe("");
    expect(r.currentHealth).toBe(100);
    expect(r.checkCount).toBe(1);
  });

  it("reset clears current and history", async () => {
    await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Mission", light: "yellow" }, ctx());
    await registry.get("tool.health_check.save_check")!.handler({}, ctx());

    const rr = (await registry.get("tool.health_check.reset")!.handler({}, ctx())) as {
      reset: boolean;
    };
    expect(rr.reset).toBe(true);

    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      checkCount: number;
      currentHealth: number;
    };
    expect(r.checkCount).toBe(0);
    expect(r.currentHealth).toBe(100);
  });
});

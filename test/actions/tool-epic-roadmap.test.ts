/**
 * tool.epic_roadmap.* coverage (singleton doc, S5).
 *
 *   1. registration — list_state read; add_epic/set_progress write.
 *   2. add_epic + list_state — total + avgProgress.
 *   3. set_progress — updates; unknown id → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/epic-roadmap";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.epic_roadmap — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.epic_roadmap.list_state")?.category).toBe("read");
    for (const verb of ["add_epic", "set_progress"]) {
      expect(registry.get(`tool.epic_roadmap.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.epic_roadmap.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.epic_roadmap.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.epic_roadmap.add_epic + set_progress + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ epicRoadmaps: [] }));

  it("adds epics, averages progress, and updates by id", async () => {
    const a = (await registry
      .get("tool.epic_roadmap.add_epic")!
      .handler(
        { title: "Onboarding", startQuarter: "2026 Q1", endQuarter: "2026 Q2", progress: 40 },
        ctx()
      )) as {
      added: boolean;
      id: string;
    };
    await registry
      .get("tool.epic_roadmap.add_epic")!
      .handler(
        { title: "Billing", startQuarter: "2026 Q2", endQuarter: "2026 Q3", progress: 100 },
        ctx()
      );

    let r = (await registry.get("tool.epic_roadmap.list_state")!.handler({}, ctx())) as {
      total: number;
      avgProgress: number;
    };
    expect(r.total).toBe(2);
    expect(r.avgProgress).toBe(70); // (40+100)/2

    const ok = (await registry
      .get("tool.epic_roadmap.set_progress")!
      .handler({ epicId: a.id, progress: 80 }, ctx())) as { updated: boolean };
    expect(ok.updated).toBe(true);
    r = (await registry.get("tool.epic_roadmap.list_state")!.handler({}, ctx())) as typeof r;
    expect(r.avgProgress).toBe(90); // (80+100)/2

    const bad = (await registry
      .get("tool.epic_roadmap.set_progress")!
      .handler({ epicId: "nope", progress: 10 }, ctx())) as { updated: boolean };
    expect(bad.updated).toBe(false);
  });
});

describe("tool.epic_roadmap edge cases", () => {
  beforeEach(() => useWorkspaceStore.setState({ epicRoadmaps: [] }));

  it("list_state reports an absent roadmap with a zero average (no NaN)", async () => {
    const r = await registry.get("tool.epic_roadmap.list_state")!.handler({}, ctx());
    expect(r).toEqual({ exists: false, total: 0, avgProgress: 0, epics: [] });
  });

  it("add_epic defaults progress to 0, keeps owner / description, and rounds the average", async () => {
    const add = registry.get("tool.epic_roadmap.add_epic")!;
    const a = (await add.handler(
      {
        title: "Search",
        startQuarter: "2026 Q1",
        endQuarter: "2026 Q2",
        owner: "Ana",
        description: "Facets",
      },
      ctx()
    )) as { id: string };
    await add.handler(
      { title: "B", startQuarter: "2026 Q1", endQuarter: "2026 Q1", progress: 10 },
      ctx()
    );
    await add.handler(
      { title: "C", startQuarter: "2026 Q1", endQuarter: "2026 Q1", progress: 45 },
      ctx()
    );

    const r = (await registry.get("tool.epic_roadmap.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      avgProgress: number;
      epics: { id: string; progress: number; owner?: string; description?: string }[];
    };
    expect(r.exists).toBe(true);
    expect(r.total).toBe(3);
    expect(r.epics[0]).toMatchObject({
      id: a.id,
      progress: 0,
      owner: "Ana",
      description: "Facets",
    });
    expect(r.avgProgress).toBe(18.33); // 55 / 3
  });

  it("set_progress refuses when no roadmap exists yet", async () => {
    const r = (await registry
      .get("tool.epic_roadmap.set_progress")!
      .handler({ epicId: "any", progress: 50 }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
    expect(useWorkspaceStore.getState().epicRoadmaps).toEqual([]);
  });
});

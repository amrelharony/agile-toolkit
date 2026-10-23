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

describe("tool.epic_roadmap rolls progress up from stories", () => {
  const story = (id: string, points: number, status: "done" | "todo", epicId?: string) => ({
    id,
    title: id,
    points,
    status,
    ...(epicId ? { epicId } : {}),
  });

  beforeEach(() =>
    useWorkspaceStore.setState({
      epicRoadmaps: [
        {
          id: "epicRoadmap:current",
          epics: [
            {
              id: "e1",
              title: "Checkout",
              startQuarter: "2026 Q4",
              endQuarter: "2026 Q4",
              progress: 90,
            },
          ],
        },
      ],
      stories: [story("a", 3, "done", "e1"), story("b", 5, "todo", "e1"), story("c", 8, "todo")],
    })
  );

  it("reports the page's rolled-up progress, not the typed figure", async () => {
    const r = (await registry.get("tool.epic_roadmap.list_state")!.handler({}, ctx())) as {
      avgProgress: number;
      epics: { progress: number; rollup: { pct: number; source: string; basis: string } }[];
    };
    expect(r.epics[0].progress).toBe(90);
    expect(r.epics[0].rollup).toMatchObject({ pct: 38, source: "stories", basis: "points" });
    expect(r.avgProgress).toBe(38);
  });

  it("links and unlinks stories, refusing unknown epics and repeats", async () => {
    const link = registry.get("tool.epic_roadmap.link_story")!;
    const unlink = registry.get("tool.epic_roadmap.unlink_story")!;
    expect(await link.handler({ storyId: "c", epicId: "nope" }, ctx())).toEqual({ changed: false });
    expect(await link.handler({ storyId: "c", epicId: "e1" }, ctx())).toEqual({ changed: true });
    expect(await link.handler({ storyId: "c", epicId: "e1" }, ctx())).toEqual({ changed: false });
    const c = () => useWorkspaceStore.getState().stories.find((s) => s.id === "c");
    expect(c()?.epicId).toBe("e1");
    expect(await unlink.handler({ storyId: "c", epicId: "e1" }, ctx())).toEqual({ changed: true });
    expect(c() && "epicId" in c()!).toBe(false);
  });

  it("normalises quarters and rejects a reversed range or an unknown colour", async () => {
    const schema = registry.get("tool.epic_roadmap.add_epic")!.paramsSchema;
    expect(
      schema.safeParse({ title: "x", startQuarter: "2027 Q2", endQuarter: "2027 Q1" }).success
    ).toBe(false);
    expect(
      schema.safeParse({ title: "x", startQuarter: "Spring", endQuarter: "2027 Q1" }).success
    ).toBe(false);
    const r = (await registry
      .get("tool.epic_roadmap.add_epic")!
      .handler(
        { title: "Search", startQuarter: "2027q1", endQuarter: "2027 q2", color: "#ff0000" },
        ctx()
      )) as { id: string };
    const epic = useWorkspaceStore.getState().epicRoadmaps?.[0].epics.find((e) => e.id === r.id);
    expect(epic).toMatchObject({ startQuarter: "2027 Q1", endQuarter: "2027 Q2" });
    expect(epic && "color" in epic).toBe(false);
  });
});

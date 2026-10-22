/**
 * tool.space_pulse.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state read; add_score write + mcpHandler.
 *   2. add_score + list_state — per-dimension averages + overall.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/space-pulse";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.space_pulse — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.space_pulse.list_state")?.category).toBe("read");
    expect(registry.get("tool.space_pulse.add_score")?.category).toBe("write");
    expect(registry.get("tool.space_pulse.add_score")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.space_pulse.add_score")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.space_pulse.add_score + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ spacePulses: [] }));

  it("averages each dimension and overall", async () => {
    await registry.get("tool.space_pulse.add_score")!.handler(
      {
        quarter: "2026-Q1",
        satisfaction: 5,
        performance: 3,
        activity: 4,
        communication: 4,
        efficiency: 4,
      },
      ctx()
    );
    const r = (await registry.get("tool.space_pulse.list_state")!.handler({}, ctx())) as {
      total: number;
      averages: { satisfaction: number; overall: number };
    };
    expect(r.total).toBe(1);
    expect(r.averages.satisfaction).toBe(5);
    expect(r.averages.overall).toBe(4); // (5+3+4+4+4)/5
  });

  const add = (quarter: string, v: number) =>
    registry.get("tool.space_pulse.add_score")!.handler(
      {
        quarter,
        satisfaction: v,
        performance: v,
        activity: v,
        communication: v,
        efficiency: v,
      },
      ctx()
    ) as Promise<{ added: boolean; id: string; replaced: boolean }>;
  const list = async () =>
    (await registry.get("tool.space_pulse.list_state")!.handler({}, ctx())) as {
      total: number;
      latest: { quarter: string; satisfaction: number } | null;
      scores: { id: string; quarter: string; satisfaction: number }[];
    };

  it("returns latest = null and zero averages when empty", async () => {
    const r = await list();
    expect(r.total).toBe(0);
    expect(r.latest).toBeNull();
  });

  // Bug: add_score appended a second entry for a quarter that already had one
  // (and kept "2026-q1" apart from "2026-Q1"), which the UI explicitly prevents.
  it("canonicalises the quarter and replaces an existing entry for it", async () => {
    const first = await add(" 2026-q1 ", 2);
    expect(first).toMatchObject({ added: true, replaced: false });
    const second = await add("2026-Q1", 5);
    expect(second).toMatchObject({ added: true, replaced: true });

    const r = await list();
    expect(r.total).toBe(1);
    expect(r.scores[0]).toMatchObject({ id: second.id, quarter: "2026-Q1", satisfaction: 5 });
  });

  // Bug: latest was the last-inserted score, not the newest quarter the UI shows.
  it("reports the chronologically latest quarter as latest", async () => {
    await add("2026-Q2", 4);
    await add("2026-Q1", 2); // back-filled after Q2
    const r = await list();
    expect(r.latest).toMatchObject({ quarter: "2026-Q2", satisfaction: 4 });
  });
});

/**
 * tool.runbook_scorer.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; add/score/remove write + hardening.
 *   2. add_runbook + list_state — total + avgHygiene (mean of raw hygiene).
 *   3. score_runbook — partial update; unknown id → {updated:false}.
 *   4. remove_runbook — removes; unknown id → {removed:false}.
 *
 * Hygiene = (freshness + completeness + (testedRecently ? 5 : 1)) / 3, matching
 * runbook-scorer-client.tsx so the agent's read mirrors the UI.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/runbook-scorer";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.runbook_scorer — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.runbook_scorer.list_state")?.category).toBe("read");
    for (const verb of ["add_runbook", "score_runbook", "remove_runbook"]) {
      expect(registry.get(`tool.runbook_scorer.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.runbook_scorer.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.runbook_scorer.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.runbook_scorer — add/score/remove/list", () => {
  beforeEach(() => useWorkspaceStore.setState({ runbookScorers: [] }));

  it("adds runbooks, averages hygiene, scores by id, and removes", async () => {
    const a = (await registry
      .get("tool.runbook_scorer.add_runbook")!
      .handler(
        { name: "Deploy rollback", freshness: 4, completeness: 4, testedRecently: true },
        ctx()
      )) as { added: boolean; id: string };
    await registry
      .get("tool.runbook_scorer.add_runbook")!
      .handler(
        { name: "DB failover", freshness: 2, completeness: 2, testedRecently: false },
        ctx()
      );

    let r = (await registry.get("tool.runbook_scorer.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      avgHygiene: number;
    };
    expect(r.exists).toBe(true);
    expect(r.total).toBe(2);
    // A=(4+4+5)/3=4.333…, B=(2+2+1)/3=1.666…, mean=3.0
    expect(r.avgHygiene).toBe(3);

    // defaults: freshness/completeness=3, testedRecently=false → (3+3+1)/3=2.33
    const d = (await registry
      .get("tool.runbook_scorer.add_runbook")!
      .handler({ name: "Cache purge" }, ctx())) as { id: string };
    r = (await registry.get("tool.runbook_scorer.list_state")!.handler({}, ctx())) as typeof r;
    expect(r.total).toBe(3);

    // score A to a perfect runbook → hygiene 5
    const ok = (await registry
      .get("tool.runbook_scorer.score_runbook")!
      .handler(
        { runbookId: a.id, freshness: 5, completeness: 5, testedRecently: true },
        ctx()
      )) as { updated: boolean };
    expect(ok.updated).toBe(true);

    const bad = (await registry
      .get("tool.runbook_scorer.score_runbook")!
      .handler({ runbookId: "nope", freshness: 5 }, ctx())) as { updated: boolean };
    expect(bad.updated).toBe(false);

    // remove the default runbook
    const rm = (await registry
      .get("tool.runbook_scorer.remove_runbook")!
      .handler({ runbookId: d.id }, ctx())) as { removed: boolean };
    expect(rm.removed).toBe(true);
    const rmBad = (await registry
      .get("tool.runbook_scorer.remove_runbook")!
      .handler({ runbookId: d.id }, ctx())) as { removed: boolean };
    expect(rmBad.removed).toBe(false);

    r = (await registry.get("tool.runbook_scorer.list_state")!.handler({}, ctx())) as typeof r;
    expect(r.total).toBe(2);
  });
});

describe("tool.runbook_scorer — edges", () => {
  beforeEach(() => useWorkspaceStore.setState({ runbookScorers: [] }));

  it("reports no scorecard and a 0 average before anything is added", async () => {
    const r = (await registry.get("tool.runbook_scorer.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      avgHygiene: number;
    };
    expect(r).toMatchObject({ exists: false, total: 0, avgHygiene: 0 });
  });

  it("patches only the fields given and puts new runbooks first", async () => {
    const add = (params: Record<string, unknown>) =>
      registry.get("tool.runbook_scorer.add_runbook")!.handler(params, ctx()) as Promise<{
        id: string;
      }>;
    const a = await add({ name: "A", freshness: 2, completeness: 4, testedRecently: true });
    await add({ name: "B" });
    await registry
      .get("tool.runbook_scorer.score_runbook")!
      .handler({ runbookId: a.id, completeness: 5 }, ctx());
    const runbooks = useWorkspaceStore.getState().runbookScorers![0].runbooks;
    expect(runbooks.map((r) => r.name)).toEqual(["B", "A"]);
    expect(runbooks[1]).toMatchObject({ freshness: 2, completeness: 5, testedRecently: true });
    expect(runbooks[0]).toMatchObject({ freshness: 3, completeness: 3, testedRecently: false });
  });

  // Bug: a whitespace-only name passed `min(1)` and was stored blank; the
  // UI trims and refuses a blank name.
  it("refuses a whitespace-only name and trims a real one", async () => {
    const add = (name: string) =>
      registry.get("tool.runbook_scorer.add_runbook")!.handler({ name }, ctx()) as Promise<{
        added: boolean;
      }>;
    expect((await add("   ")).added).toBe(false);
    expect((await add("  DB failover  ")).added).toBe(true);
    expect(useWorkspaceStore.getState().runbookScorers![0].runbooks.map((r) => r.name)).toEqual([
      "DB failover",
    ]);
  });
});

/**
 * tool.dora_scorecard.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state read; add_sample write + mcpHandler.
 *   2. add_sample + list_state — averages, latest, total.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/dora-scorecard";

const DS_ID = "doraScorecard:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.dora_scorecard — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.dora_scorecard.list_state")?.category).toBe("read");
    expect(registry.get("tool.dora_scorecard.add_sample")?.category).toBe("write");
    expect(registry.get("tool.dora_scorecard.add_sample")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.dora_scorecard.add_sample")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.dora_scorecard.add_sample + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ doraScorecards: [] }));

  it("is empty before any write", async () => {
    const r = (await registry.get("tool.dora_scorecard.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      latest: unknown;
    };
    expect(r.exists).toBe(false);
    expect(r.total).toBe(0);
    expect(r.latest).toBeNull();
  });

  it("appends samples and averages the 4 keys", async () => {
    await registry
      .get("tool.dora_scorecard.add_sample")!
      .handler(
        {
          quarter: "2026-Q1",
          deployFreqPerWeek: 10,
          leadTimeHours: 4,
          changeFailRate: 0.1,
          mttrHours: 2,
        },
        ctx()
      );
    await registry
      .get("tool.dora_scorecard.add_sample")!
      .handler(
        {
          quarter: "2026-Q2",
          deployFreqPerWeek: 20,
          leadTimeHours: 6,
          changeFailRate: 0.2,
          mttrHours: 4,
        },
        ctx()
      );

    const docs = useWorkspaceStore.getState().doraScorecards ?? [];
    expect(docs[0].id).toBe(DS_ID);

    const r = (await registry.get("tool.dora_scorecard.list_state")!.handler({}, ctx())) as {
      total: number;
      latest: { quarter: string };
      averages: { deployFreqPerWeek: number; leadTimeHours: number };
    };
    expect(r.total).toBe(2);
    expect(r.latest.quarter).toBe("2026-Q2"); // most recently added
    expect(r.averages.deployFreqPerWeek).toBe(15); // (10+20)/2
    expect(r.averages.leadTimeHours).toBe(5); // (4+6)/2
  });
});

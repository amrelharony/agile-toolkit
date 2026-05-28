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
    await registry
      .get("tool.space_pulse.add_score")!
      .handler(
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
});

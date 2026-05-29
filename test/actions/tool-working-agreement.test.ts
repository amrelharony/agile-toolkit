/**
 * tool.working_agreement.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; add_rule write + mcpHandler.
 *   2. add_rule + list_state — byCategory tally + adoption counts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/working-agreement";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.working_agreement — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.working_agreement.list_state")?.category).toBe("read");
    expect(registry.get("tool.working_agreement.add_rule")?.category).toBe("write");
    expect(registry.get("tool.working_agreement.add_rule")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.working_agreement.add_rule")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.working_agreement.add_rule + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ workingAgreements: [] }));

  it("appends rules and tallies by category", async () => {
    await registry
      .get("tool.working_agreement.add_rule")!
      .handler(
        { category: "communication", text: "Reply within a day", agreedBy: ["alice"] },
        ctx()
      );
    await registry
      .get("tool.working_agreement.add_rule")!
      .handler({ category: "meetings", text: "No-meeting Wednesdays" }, ctx());

    const r = (await registry.get("tool.working_agreement.list_state")!.handler({}, ctx())) as {
      total: number;
      byCategory: Record<string, number>;
    };
    expect(r.total).toBe(2);
    expect(r.byCategory.communication).toBe(1);
    expect(r.byCategory.meetings).toBe(1);
  });
});

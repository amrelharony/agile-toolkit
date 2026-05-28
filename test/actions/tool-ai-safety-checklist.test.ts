/**
 * tool.ai_safety_checklist.* coverage (singleton doc).
 *
 *   1. registration — list_state read; set_item write + mcpHandler + no
 *      confirm.
 *   2. list_state — fixed 20-item catalog, all unchecked, completeness 0.
 *   3. set_item — valid id toggles + bumps completeness; unknown id →
 *      {updated:false} and no write.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/ai-safety-checklist";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.ai_safety_checklist — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.ai_safety_checklist.list_state")?.category).toBe("read");
    expect(registry.get("tool.ai_safety_checklist.set_item")?.category).toBe("write");
    expect(registry.get("tool.ai_safety_checklist.set_item")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ai_safety_checklist.set_item")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.ai_safety_checklist.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ aiSafetyChecklists: [] }));

  it("returns the full catalog unchecked when nothing saved", async () => {
    const r = (await registry.get("tool.ai_safety_checklist.list_state")!.handler({}, ctx())) as {
      checkedCount: number;
      totalItems: number;
      completeness: number;
      sections: { title: string; items: { id: string; checked: boolean }[] }[];
    };
    expect(r.checkedCount).toBe(0);
    expect(r.totalItems).toBe(20);
    expect(r.completeness).toBe(0);
    expect(r.sections).toHaveLength(5);
    expect(r.sections.every((s) => s.items.every((i) => i.checked === false))).toBe(true);
  });
});

describe("tool.ai_safety_checklist.set_item", () => {
  beforeEach(() => useWorkspaceStore.setState({ aiSafetyChecklists: [] }));

  it("checks a valid item and bumps completeness", async () => {
    const r = (await registry
      .get("tool.ai_safety_checklist.set_item")!
      .handler({ itemId: "pii-scrub", checked: true }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);

    const state = (await registry
      .get("tool.ai_safety_checklist.list_state")!
      .handler({}, ctx())) as { checkedCount: number; completeness: number };
    expect(state.checkedCount).toBe(1);
    expect(state.completeness).toBe(0.05); // 1/20
  });

  it("rejects an unknown item id without writing", async () => {
    const r = (await registry
      .get("tool.ai_safety_checklist.set_item")!
      .handler({ itemId: "not-a-real-item", checked: true }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
    expect(useWorkspaceStore.getState().aiSafetyChecklists ?? []).toHaveLength(0);
  });
});

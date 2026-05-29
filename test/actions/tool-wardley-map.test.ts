/**
 * tool.wardley_map.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; add_component/add_link write.
 *   2. add_component + add_link (refuses a dangling endpoint) + list_state.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/wardley-map";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.wardley_map — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.wardley_map.list_state")?.category).toBe("read");
    for (const verb of ["add_component", "add_link"]) {
      expect(registry.get(`tool.wardley_map.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.wardley_map.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.wardley_map.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.wardley_map.add_component + add_link", () => {
  beforeEach(() => useWorkspaceStore.setState({ wardleyMaps: [] }));

  it("links two existing components and refuses a dangling endpoint", async () => {
    const a = (await registry
      .get("tool.wardley_map.add_component")!
      .handler({ name: "User", evolution: 0.2, visibility: 0.9 }, ctx())) as { id: string };
    const b = (await registry
      .get("tool.wardley_map.add_component")!
      .handler({ name: "Database", evolution: 0.8, visibility: 0.2 }, ctx())) as { id: string };

    const ok = (await registry
      .get("tool.wardley_map.add_link")!
      .handler({ fromId: a.id, toId: b.id }, ctx())) as { added: boolean };
    expect(ok.added).toBe(true);

    const dangling = (await registry
      .get("tool.wardley_map.add_link")!
      .handler({ fromId: a.id, toId: "ghost" }, ctx())) as { added: boolean };
    expect(dangling.added).toBe(false);

    const r = (await registry.get("tool.wardley_map.list_state")!.handler({}, ctx())) as {
      componentCount: number;
      linkCount: number;
    };
    expect(r.componentCount).toBe(2);
    expect(r.linkCount).toBe(1); // only the valid link
  });
});

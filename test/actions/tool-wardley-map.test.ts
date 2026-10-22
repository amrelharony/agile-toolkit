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

  it("list_state reports exists:false before any write", async () => {
    const r = (await registry.get("tool.wardley_map.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      componentCount: number;
      linkCount: number;
    };
    expect(r).toMatchObject({ exists: false, componentCount: 0, linkCount: 0 });
  });

  it("add_component creates the map and appends in order", async () => {
    const add = registry.get("tool.wardley_map.add_component")!;
    await add.handler({ name: "A", evolution: 0, visibility: 1 }, ctx());
    await add.handler({ name: "B", evolution: 1, visibility: 0, description: "infra" }, ctx());
    const m = useWorkspaceStore.getState().wardleyMaps?.[0];
    expect(m?.id).toBe("wardleyMap:current");
    expect(m?.components.map((c) => [c.name, c.evolution, c.visibility, c.description])).toEqual([
      ["A", 0, 1, undefined],
      ["B", 1, 0, "infra"],
    ]);
  });

  it("add_link returns added:false when there is no map", async () => {
    const r = (await registry
      .get("tool.wardley_map.add_link")!
      .handler({ fromId: "a", toId: "b" }, ctx())) as { added: boolean };
    expect(r.added).toBe(false);
    expect(useWorkspaceStore.getState().wardleyMaps).toEqual([]);
  });

  // Bug: the agent could store a self-link and exact duplicates, which the UI
  // refuses (its Link button is disabled for from === to and dedupes).
  it("add_link refuses a self-link and an exact duplicate", async () => {
    const add = registry.get("tool.wardley_map.add_component")!;
    const a = (await add.handler({ name: "A", evolution: 0.2, visibility: 0.9 }, ctx())) as {
      id: string;
    };
    const b = (await add.handler({ name: "B", evolution: 0.8, visibility: 0.2 }, ctx())) as {
      id: string;
    };
    const link = registry.get("tool.wardley_map.add_link")!;
    const self = (await link.handler({ fromId: a.id, toId: a.id }, ctx())) as { added: boolean };
    expect(self.added).toBe(false);
    expect(
      ((await link.handler({ fromId: a.id, toId: b.id }, ctx())) as { added: boolean }).added
    ).toBe(true);
    const dup = (await link.handler({ fromId: a.id, toId: b.id }, ctx())) as { added: boolean };
    expect(dup.added).toBe(false);
    // The reverse direction is a different dependency and is allowed.
    const rev = (await link.handler({ fromId: b.id, toId: a.id }, ctx())) as { added: boolean };
    expect(rev.added).toBe(true);
    expect(useWorkspaceStore.getState().wardleyMaps?.[0].links).toHaveLength(2);
  });
});

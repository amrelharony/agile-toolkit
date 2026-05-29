/**
 * tool.liberating_structures.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; toggle_favorite write + mcpHandler.
 *   2. toggle_favorite — adds then removes; list_state reflects favorites.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/liberating-structures";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.liberating_structures — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.liberating_structures.list_state")?.category).toBe("read");
    expect(registry.get("tool.liberating_structures.toggle_favorite")?.category).toBe("write");
    expect(registry.get("tool.liberating_structures.toggle_favorite")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.liberating_structures.toggle_favorite")?.requiresConfirmation).toBe(
      false
    );
  });
});

describe("tool.liberating_structures.toggle_favorite", () => {
  beforeEach(() => useWorkspaceStore.setState({ liberatingStructures: [] }));

  it("adds a favorite then removes it on second toggle", async () => {
    const a = (await registry
      .get("tool.liberating_structures.toggle_favorite")!
      .handler({ structureId: "1-2-4" }, ctx())) as { favorited: boolean };
    expect(a.favorited).toBe(true);

    let state = (await registry
      .get("tool.liberating_structures.list_state")!
      .handler({}, ctx())) as { favoriteCount: number; favoriteStructureIds: string[] };
    expect(state.favoriteCount).toBe(1);
    expect(state.favoriteStructureIds).toContain("1-2-4");

    const b = (await registry
      .get("tool.liberating_structures.toggle_favorite")!
      .handler({ structureId: "1-2-4" }, ctx())) as { favorited: boolean };
    expect(b.favorited).toBe(false);

    state = (await registry.get("tool.liberating_structures.list_state")!.handler({}, ctx())) as {
      favoriteCount: number;
      favoriteStructureIds: string[];
    };
    expect(state.favoriteCount).toBe(0);
  });
});

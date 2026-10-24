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
      .handler({ structureId: "ls-1-2-4-all" }, ctx())) as { favorited: boolean };
    expect(a.favorited).toBe(true);

    let state = (await registry
      .get("tool.liberating_structures.list_state")!
      .handler({}, ctx())) as { favoriteCount: number; favoriteStructureIds: string[] };
    expect(state.favoriteCount).toBe(1);
    expect(state.favoriteStructureIds).toContain("ls-1-2-4-all");

    const b = (await registry
      .get("tool.liberating_structures.toggle_favorite")!
      .handler({ structureId: "ls-1-2-4-all" }, ctx())) as { favorited: boolean };
    expect(b.favorited).toBe(false);

    state = (await registry.get("tool.liberating_structures.list_state")!.handler({}, ctx())) as {
      favoriteCount: number;
      favoriteStructureIds: string[];
    };
    expect(state.favoriteCount).toBe(0);
  });
});

describe("tool.liberating_structures.find", () => {
  it("filters the shared catalog like the page", async () => {
    const find = registry.get("tool.liberating_structures.find")!;
    const all = (await find.handler({}, ctx())) as { structures: { id: string }[] };
    expect(all.structures.map((s) => s.id)).toContain("ls-1-2-4-all");
    const retro = (await find.handler({ ceremony: "retro", people: 8 }, ctx())) as {
      structures: { ceremonies: string[]; minPeople: number; maxPeople: number | null }[];
    };
    expect(retro.structures.length).toBeGreaterThan(0);
    for (const s of retro.structures) {
      expect(s.ceremonies).toContain("retro");
      expect(s.minPeople).toBeLessThanOrEqual(8);
      expect(s.maxPeople === null || s.maxPeople >= 8).toBe(true);
    }
    const quick = (await find.handler({ maxMinutes: 15 }, ctx())) as {
      structures: { timingMinutes: number }[];
    };
    expect(quick.structures.every((s) => s.timingMinutes <= 15)).toBe(true);
  });

  it("toggle_favorite refuses ids that aren't in the catalog", () => {
    const schema = registry.get("tool.liberating_structures.toggle_favorite")!.paramsSchema;
    expect(schema.safeParse({ structureId: "1-2-4" }).success).toBe(false);
    expect(schema.safeParse({ structureId: "ls-1-2-4-all" }).success).toBe(true);
  });
});

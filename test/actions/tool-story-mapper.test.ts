/**
 * tool.story_mapper.* action coverage.
 *
 *   1. list_state (read) + add_card (write, mcpHandler, no confirm)
 *   2. list_state reports step/slice/card counts (exists:false when empty)
 *   3. add_card appends to a valid cell, and no-ops {added:false} for an
 *      unknown slice/step or when no map exists
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StoryMap } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/story-mapper";

const SM_ID = "story-mapper:current";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function map(): StoryMap {
  return {
    id: SM_ID,
    steps: [
      { id: "step-1", name: "Discover" },
      { id: "step-2", name: "Use" },
    ],
    slices: [
      {
        id: "slice-1",
        name: "MVP",
        cards: {
          "step-1": [{ id: "c1", title: "Browse", description: "", color: "#00f0ff" }],
          "step-2": [],
        },
      },
    ],
  };
}

describe("tool.story_mapper — registration", () => {
  it("registers list_state (read) and add_card (write, mcpHandler, no confirm)", () => {
    expect(registry.get("tool.story_mapper.list_state")?.category).toBe("read");
    expect(registry.get("tool.story_mapper.add_card")?.category).toBe("write");
    expect(registry.get("tool.story_mapper.add_card")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.story_mapper.add_card")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.story_mapper.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ storyMaps: [] });
  });

  it("reports exists:false when no map exists", async () => {
    const action = registry.get("tool.story_mapper.list_state");
    const r = (await action!.handler({}, ctx())) as { exists: boolean; totalCards: number };
    expect(r.exists).toBe(false);
    expect(r.totalCards).toBe(0);
  });

  it("counts steps, slices, and cards", async () => {
    useWorkspaceStore.getState().upsertStoryMap(map());
    const action = registry.get("tool.story_mapper.list_state");
    const r = (await action!.handler({}, ctx())) as {
      stepCount: number;
      sliceCount: number;
      totalCards: number;
      slices: { id: string; cardCount: number }[];
    };
    expect(r.stepCount).toBe(2);
    expect(r.sliceCount).toBe(1);
    expect(r.totalCards).toBe(1);
    expect(r.slices[0].cardCount).toBe(1);
  });
});

describe("tool.story_mapper.add_card", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ storyMaps: [] });
  });

  it("no-ops {added:false} when no map exists", async () => {
    const action = registry.get("tool.story_mapper.add_card");
    const r = (await action!.handler(
      { sliceId: "slice-1", stepId: "step-1", title: "x" },
      ctx()
    )) as { added: boolean };
    expect(r.added).toBe(false);
  });

  it("appends a card to a valid cell", async () => {
    useWorkspaceStore.getState().upsertStoryMap(map());
    const action = registry.get("tool.story_mapper.add_card");
    const r = (await action!.handler(
      { sliceId: "slice-1", stepId: "step-2", title: "Checkout", description: "pay" },
      ctx()
    )) as { added: boolean };
    expect(r.added).toBe(true);

    const stored = (useWorkspaceStore.getState().storyMaps ?? []).find((m) => m.id === SM_ID);
    expect(stored?.slices[0].cards["step-2"]).toHaveLength(1);
    expect(stored?.slices[0].cards["step-2"][0].title).toBe("Checkout");
  });

  it("no-ops {added:false} for an unknown slice or step id", async () => {
    useWorkspaceStore.getState().upsertStoryMap(map());
    const action = registry.get("tool.story_mapper.add_card");
    const badSlice = (await action!.handler(
      { sliceId: "nope", stepId: "step-1", title: "x" },
      ctx()
    )) as { added: boolean };
    const badStep = (await action!.handler(
      { sliceId: "slice-1", stepId: "nope", title: "x" },
      ctx()
    )) as { added: boolean };
    expect(badSlice.added).toBe(false);
    expect(badStep.added).toBe(false);
  });
});

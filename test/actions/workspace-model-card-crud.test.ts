/**
 * workspace.model_card.* CRUD coverage — the Model Card *documentation*
 * collection (intended use / training data / limitations), as opposed to
 * the model *registry* (cost / latency / status) served by
 * tool.model_registry.*.
 *
 * Regression guard for the "Collection/Identity Disconnect" audit finding:
 * the `modelCards` store collection (written by /model-card via
 * upsertModelCard) had ZERO agent surface — no defineCrudActions and no
 * domain tool ever read or wrote it. An agent asked to edit a model card
 * had nothing to call; the only "model_card"-named tool actually mutated
 * the unrelated `models` registry.
 *
 * This suite asserts:
 *   1. the four CRUD actions exist under workspace.model_card.*
 *   2. their server-side kind is "workspace:modelCard", byte-for-byte the
 *      kind the browser sync engine registers via
 *      registerCollection("modelCard", "modelCards") — so MCP writes
 *      round-trip into the live /model-card UI
 *   3. create / list / update / delete actually move the `modelCards`
 *      collection (NOT `models`)
 *   4. the name collision is gone: the registry verbs live under
 *      tool.model_registry.*, and the old tool.model_card.* ids no longer
 *      resolve.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { kindFromToolId } from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelCard } from "@/lib/stores/workspace-types";

// Side-effect imports — register the actions on the singleton.
import "@/lib/actions/workspace/index";
import "@/lib/actions/tools/model-registry";

function ctx() {
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

const CRUD_IDS = [
  "workspace.model_card.create",
  "workspace.model_card.list",
  "workspace.model_card.update",
  "workspace.model_card.delete",
] as const;

describe("workspace.model_card — registration & kind mapping", () => {
  it("registers all four CRUD actions", () => {
    for (const id of CRUD_IDS) {
      expect(registry.get(id), `missing action: ${id}`).toBeDefined();
    }
  });

  it("maps to server kind 'workspace:modelCard' (matches registerCollection → modelCards)", () => {
    // This is the load-bearing assertion: kindFromToolId of the CRUD toolId
    // must equal the camelCase kind the browser sync engine hydrates, or
    // MCP-side writes would land on a kind nothing reads.
    expect(kindFromToolId("workspace.model_card")).toBe("workspace:modelCard");
  });
});

describe("workspace.model_card — CRUD moves the modelCards collection", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ modelCards: [], models: [] });
  });

  it("create writes a card into modelCards (not models) and returns its id", async () => {
    const create = registry.get("workspace.model_card.create");
    const card: ModelCard = {
      id: "mc1",
      modelName: "claude-sonnet-4-6",
      intendedUse: "Customer support drafting",
      limitations: "Not for medical advice",
      updatedAt: "2026-05-29T00:00:00.000Z",
    };
    const result = (await create!.handler({ entity: card }, ctx())) as { id: string };
    expect(result.id).toBe("mc1");

    const cards = useWorkspaceStore.getState().modelCards ?? [];
    expect(cards.map((c) => c.id)).toEqual(["mc1"]);
    expect(cards[0].modelName).toBe("claude-sonnet-4-6");
    // The registry collection must be untouched — this is the whole point.
    expect(useWorkspaceStore.getState().models ?? []).toEqual([]);
  });

  it("list returns the cards held in modelCards", async () => {
    useWorkspaceStore.getState().upsertModelCard({
      id: "mc1",
      modelName: "gpt-4o",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });

    const list = registry.get("workspace.model_card.list");
    const result = (await list!.handler({}, ctx())) as { items: ModelCard[] };
    expect(result.items.map((c) => c.id)).toEqual(["mc1"]);
  });

  it("update patches a card by id", async () => {
    useWorkspaceStore.getState().upsertModelCard({
      id: "mc1",
      modelName: "gpt-4o",
      intendedUse: "old",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });

    const update = registry.get("workspace.model_card.update");
    const result = (await update!.handler({ id: "mc1", patch: { intendedUse: "new" } }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().modelCards ?? []).find((c) => c.id === "mc1");
    expect(stored?.intendedUse).toBe("new");
    expect(stored?.modelName).toBe("gpt-4o"); // untouched fields preserved
  });

  it("delete removes a card by id", async () => {
    useWorkspaceStore.getState().upsertModelCard({
      id: "mc1",
      modelName: "gpt-4o",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });

    const del = registry.get("workspace.model_card.delete");
    const result = (await del!.handler({ id: "mc1" }, ctx())) as { deleted: boolean };
    expect(result.deleted).toBe(true);
    expect(useWorkspaceStore.getState().modelCards ?? []).toEqual([]);
  });
});

describe("name collision removed: registry verbs are tool.model_registry.*", () => {
  it("registers the registry verbs under tool.model_registry.*", () => {
    expect(registry.get("tool.model_registry.list_state")).toBeDefined();
    expect(registry.get("tool.model_registry.promote_to_production")).toBeDefined();
  });

  it("no longer registers the misfiled tool.model_card.* registry surface", () => {
    // The old ids collided in name with the /model-card route while
    // actually mutating the `models` registry. They must be gone.
    expect(registry.get("tool.model_card.list_state")).toBeUndefined();
    expect(registry.get("tool.model_card.promote_to_production")).toBeUndefined();
  });
});

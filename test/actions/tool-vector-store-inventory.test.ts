/**
 * tool.vector_store_inventory.* coverage.
 *
 *   1. registration — list_state read; add_collection/update_doc_count write
 *      + mcpHandler + no confirm.
 *   2. list_state — totalDocs + byEmbeddingModel rollup.
 *   3. add_collection — appends with auto id.
 *   4. update_doc_count — updates; {updated:false} on unknown id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { VectorCollection } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/vector-store-inventory";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function coll(
  p: Partial<VectorCollection> &
    Pick<VectorCollection, "id" | "name" | "embeddingModel" | "docCount">
): VectorCollection {
  return { dim: 1536, ...p };
}

describe("tool.vector_store_inventory — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.vector_store_inventory.list_state")?.category).toBe("read");
    expect(registry.get("tool.vector_store_inventory.add_collection")?.category).toBe("write");
    expect(registry.get("tool.vector_store_inventory.add_collection")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.vector_store_inventory.add_collection")?.requiresConfirmation).toBe(
      false
    );
    expect(registry.get("tool.vector_store_inventory.update_doc_count")?.requiresConfirmation).toBe(
      false
    );
  });
});

describe("tool.vector_store_inventory.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ vectorCollections: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry
      .get("tool.vector_store_inventory.list_state")!
      .handler({}, ctx())) as {
      total: number;
      totalDocs: number;
    };
    expect(r.total).toBe(0);
    expect(r.totalDocs).toBe(0);
  });

  it("sums docs and rolls up by embedding model", async () => {
    const u = useWorkspaceStore.getState().upsertVectorCollection;
    u(coll({ id: "c1", name: "docs", embeddingModel: "text-embed-3", docCount: 1000 }));
    u(coll({ id: "c2", name: "faqs", embeddingModel: "text-embed-3", docCount: 500 }));
    u(coll({ id: "c3", name: "code", embeddingModel: "voyage-2", docCount: 200 }));

    const r = (await registry
      .get("tool.vector_store_inventory.list_state")!
      .handler({}, ctx())) as {
      total: number;
      totalDocs: number;
      byEmbeddingModel: Record<string, { collections: number; docs: number }>;
    };
    expect(r.total).toBe(3);
    expect(r.totalDocs).toBe(1700);
    expect(r.byEmbeddingModel["text-embed-3"]).toEqual({ collections: 2, docs: 1500 });
    expect(r.byEmbeddingModel["voyage-2"]).toEqual({ collections: 1, docs: 200 });
  });
});

describe("tool.vector_store_inventory.add_collection", () => {
  beforeEach(() => useWorkspaceStore.setState({ vectorCollections: [] }));

  it("appends a collection with auto id", async () => {
    const r = (await registry
      .get("tool.vector_store_inventory.add_collection")!
      .handler(
        { name: "docs", embeddingModel: "text-embed-3", dim: 1536, docCount: 42 },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().vectorCollections ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("docs");
    expect(stored[0].docCount).toBe(42);
  });
});

describe("tool.vector_store_inventory.update_doc_count", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      vectorCollections: [
        coll({ id: "c1", name: "docs", embeddingModel: "text-embed-3", docCount: 100 }),
      ],
    })
  );

  it("updates the doc count", async () => {
    const r = (await registry
      .get("tool.vector_store_inventory.update_doc_count")!
      .handler({ id: "c1", docCount: 250 }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    expect((useWorkspaceStore.getState().vectorCollections ?? [])[0].docCount).toBe(250);
  });

  it("returns updated:false for an unknown id", async () => {
    const r = (await registry
      .get("tool.vector_store_inventory.update_doc_count")!
      .handler({ id: "nope", docCount: 5 }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});

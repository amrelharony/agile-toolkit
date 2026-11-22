/**
 * The Phase 43 workspace collections (the tools plan's phase 2). Each
 * upserts by id and removes, rides export and import, is cleared by reset,
 * is in the workspace snapshot, and cloud-syncs under the kind its
 * workspace.* CRUD derives (or, with no CRUD, the kind its constant names).
 * Also: the fields Phase 43 adds to existing records ride the same paths.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const registered = vi.hoisted(() => ({
  entities: [] as {
    kind: string;
    getEntities: () => ReadonlyArray<{ id: string }>;
    setEntities: (next: ReadonlyArray<{ id: string }>) => void;
  }[],
  blobs: [] as { storeKey: string }[],
}));

// Capture what the store registers with the sync engine, instead of
// starting a real one.
vi.mock("@/lib/sync/register", () => ({
  registerEntityCollection: (opts: (typeof registered.entities)[number]) => {
    registered.entities.push(opts);
  },
  registerBlobStore: (opts: (typeof registered.blobs)[number]) => {
    registered.blobs.push(opts);
  },
}));

import { getWorkspaceSnapshot, useWorkspaceStore } from "@/lib/stores/workspace-store";
import { kindFromToolId } from "@/lib/actions/server-store";
import {
  EXAMPLE_MAP_KIND,
  POKER_ASYNC_ROUND_KIND,
  emptyWorkspace,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { EXAMPLE_MAP, POKER_ASYNC_ROUND } from "./phase43-fixtures";

type Doc = { id: string };

const ws = () => useWorkspaceStore.getState();

/**
 * Each new collection: its slice, store actions, a full record, its CRUD
 * toolId (none for a store-only collection) and exported kind.
 */
const COLLECTIONS: {
  slice: keyof Workspace;
  doc: Doc;
  upsert: (x: never) => void;
  remove: (id: string) => void;
  toolId?: string;
  kind: string;
}[] = [
  {
    slice: "exampleMaps",
    doc: EXAMPLE_MAP,
    upsert: (x) => ws().upsertExampleMap(x),
    remove: (id) => ws().removeExampleMap(id),
    toolId: "workspace.example_map",
    kind: EXAMPLE_MAP_KIND,
  },
  {
    slice: "pokerAsyncRounds",
    doc: POKER_ASYNC_ROUND,
    upsert: (x) => ws().upsertPokerAsyncRound(x),
    remove: (id) => ws().removePokerAsyncRound(id),
    kind: POKER_ASYNC_ROUND_KIND,
  },
];

const slice = (k: keyof Workspace) => ws()[k] as Doc[] | undefined;

beforeAll(async () => {
  // The store registers its sync targets from a dynamic import.
  await vi.waitFor(() => {
    expect(registered.blobs.length).toBeGreaterThan(0);
  });
  await Promise.resolve(useWorkspaceStore.persist.rehydrate());
});

beforeEach(() => {
  ws().resetWorkspace();
});

describe("the Phase 43 collections", () => {
  it("start empty, and an empty workspace has each one", () => {
    for (const c of COLLECTIONS) {
      expect(slice(c.slice), c.slice).toEqual([]);
      expect(emptyWorkspace[c.slice as keyof typeof emptyWorkspace], c.slice).toEqual([]);
    }
  });

  it.each(COLLECTIONS.map((c) => [c.slice, c] as const))("%s upserts by id and removes", (_, c) => {
    c.upsert(c.doc as never);
    expect(slice(c.slice)).toEqual([c.doc]);
    const changed = { ...c.doc, marker: 1 };
    c.upsert(changed as never);
    expect(slice(c.slice)).toEqual([changed]);
    c.upsert({ ...c.doc, id: "other" } as never);
    expect(slice(c.slice)?.map((d) => d.id)).toEqual([c.doc.id, "other"]);
    c.remove(c.doc.id);
    expect(slice(c.slice)?.map((d) => d.id)).toEqual(["other"]);
  });

  it("stamp nothing on a store write: the page stamps its own times", () => {
    for (const c of COLLECTIONS) {
      c.upsert(c.doc as never);
      expect(slice(c.slice), c.slice).toEqual([c.doc]);
    }
  });

  it("ride export and import, are in the snapshot, and reset clears them", () => {
    for (const c of COLLECTIONS) c.upsert(c.doc as never);
    const snapshot = getWorkspaceSnapshot();
    for (const c of COLLECTIONS) expect(snapshot[c.slice], c.slice).toEqual([c.doc]);

    const json = ws().exportJSON();
    ws().resetWorkspace();
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([]);

    ws().importJSON(json);
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([c.doc]);
  });

  it("import leaves a collection empty when the file has none", () => {
    for (const c of COLLECTIONS) c.upsert(c.doc as never);
    ws().importJSON(JSON.stringify({ teamMembers: [] }));
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([]);
  });

  it.each(COLLECTIONS.map((c) => [c.slice, c] as const))(
    "%s syncs under the kind its CRUD derives and the exported constant names",
    (_, c) => {
      if (c.toolId) expect(c.kind, "exported kind").toBe(kindFromToolId(c.toolId));
      const target = registered.entities.filter((e) => e.kind === c.kind);
      expect(target, c.kind).toHaveLength(1);
      // The sync target reads and writes this collection.
      c.upsert(c.doc as never);
      expect(target[0].getEntities()).toEqual([c.doc]);
      target[0].setEntities([]);
      expect(slice(c.slice)).toEqual([]);
    }
  );
});

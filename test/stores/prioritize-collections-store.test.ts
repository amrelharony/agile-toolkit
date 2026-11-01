/**
 * The Phase 7 (Prioritize & decide) workspace collections: allocationRounds,
 * buyAFeatureGames and weightedMatrices. Each upserts by id and removes,
 * rides export and import, is cleared by reset, is in the workspace
 * snapshot, and cloud-syncs under the kind its workspace.* CRUD derives.
 * Also: removing a weighted matrix takes its options and criteria with it,
 * and the widened records (backlog items, stories, decisions, rows, Cynefin
 * items, weighted rows) keep every new field through the store.
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
  ALLOCATION_ROUND_KIND,
  BUY_A_FEATURE_KIND,
  DEFAULT_WEIGHTED_MATRIX_ID,
  WEIGHTED_MATRIX_KIND,
  weightedMatrixIdOf,
  type WhiteboardObject,
  type Workspace,
} from "@/lib/stores/workspace-types";
import {
  ALLOCATION_ROUND,
  BACKLOG_BARE,
  BACKLOG_FULL,
  BUY_A_FEATURE_GAME,
  CRITERION,
  CYNEFIN,
  DECISION,
  DEFAULT_OPTION,
  FUNDED_FEATURE,
  LEGACY_CRITERION,
  LEGACY_OPTION,
  MATRIX,
  OPTION,
  STORY_RANKED,
} from "./phase7-fixtures";

type Doc = { id: string };

/**
 * Each new collection: its slice, store actions, a full document, its CRUD
 * toolId and the exported kind server-side code names it by.
 */
const COLLECTIONS: {
  slice: keyof Workspace;
  doc: Doc;
  upsert: (x: never) => void;
  remove: (id: string) => void;
  toolId: string;
  kind: string;
}[] = [
  {
    slice: "allocationRounds",
    doc: ALLOCATION_ROUND,
    upsert: (x) => useWorkspaceStore.getState().upsertAllocationRound(x),
    remove: (id) => useWorkspaceStore.getState().removeAllocationRound(id),
    toolId: "workspace.allocation_round",
    kind: ALLOCATION_ROUND_KIND,
  },
  {
    slice: "buyAFeatureGames",
    doc: BUY_A_FEATURE_GAME,
    upsert: (x) => useWorkspaceStore.getState().upsertBuyAFeatureGame(x),
    remove: (id) => useWorkspaceStore.getState().removeBuyAFeatureGame(id),
    toolId: "workspace.buy_a_feature_game",
    kind: BUY_A_FEATURE_KIND,
  },
  {
    slice: "weightedMatrices",
    doc: MATRIX,
    upsert: (x) => useWorkspaceStore.getState().upsertWeightedMatrix(x),
    remove: (id) => useWorkspaceStore.getState().removeWeightedMatrix(id),
    toolId: "workspace.weighted_matrix",
    kind: WEIGHTED_MATRIX_KIND,
  },
];

const slice = (k: keyof Workspace) => useWorkspaceStore.getState()[k] as Doc[] | undefined;

beforeAll(async () => {
  // The store registers its sync targets from a dynamic import.
  await vi.waitFor(() => {
    expect(registered.blobs.length).toBeGreaterThan(0);
  });
  await Promise.resolve(useWorkspaceStore.persist.rehydrate());
});

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
});

describe("the Prioritize & decide collections", () => {
  it("start empty", () => {
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([]);
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

  it("ride export and import, are in the snapshot, and reset clears them", () => {
    for (const c of COLLECTIONS) c.upsert(c.doc as never);
    const snapshot = getWorkspaceSnapshot();
    for (const c of COLLECTIONS) expect(snapshot[c.slice], c.slice).toEqual([c.doc]);

    const json = useWorkspaceStore.getState().exportJSON();
    useWorkspaceStore.getState().resetWorkspace();
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([]);

    useWorkspaceStore.getState().importJSON(json);
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([c.doc]);
  });

  it("import leaves a collection empty when the file has none", () => {
    for (const c of COLLECTIONS) c.upsert(c.doc as never);
    useWorkspaceStore.getState().importJSON(JSON.stringify({ teamMembers: [] }));
    for (const c of COLLECTIONS) expect(slice(c.slice), c.slice).toEqual([]);
  });

  it("a persisted workspace from before Phase 7 loads them as empty", async () => {
    // Written after the last store change: every change persists the state.
    localStorage.setItem(
      "agile-toolkit:workspace",
      JSON.stringify({ state: { teamMembers: [], backlogItems: [BACKLOG_FULL] }, version: 1 })
    );
    await Promise.resolve(useWorkspaceStore.persist.rehydrate());
    for (const c of COLLECTIONS) expect(slice(c.slice) ?? [], c.slice).toEqual([]);
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_FULL]);
    localStorage.removeItem("agile-toolkit:workspace");
  });

  it.each(COLLECTIONS.map((c) => [c.toolId, c] as const))(
    "%s syncs under the kind its CRUD derives and the exported constant names",
    (_, c) => {
      const kind = kindFromToolId(c.toolId);
      expect(c.kind, "exported kind").toBe(kind);
      const target = registered.entities.filter((e) => e.kind === kind);
      expect(target, kind).toHaveLength(1);
      // The sync target reads and writes this collection.
      c.upsert(c.doc as never);
      expect(target[0].getEntities()).toEqual([c.doc]);
      target[0].setEntities([]);
      expect(slice(c.slice)).toEqual([]);
    }
  );

  it("the weighted criteria still sync under the kind the new workspace.weighted_criterion derives", () => {
    const kind = kindFromToolId("workspace.weighted_criterion");
    expect(registered.entities.filter((e) => e.kind === kind)).toHaveLength(1);
  });
});

describe("removing a weighted matrix", () => {
  const canvasCard = (entityId: string): WhiteboardObject =>
    ({
      id: `wo-${entityId}`,
      boardId: "wb1",
      kind: "sticky",
      x: 0,
      y: 0,
      version: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
      sourceRef: { tool: "weightedOption", entityId },
    }) as unknown as WhiteboardObject;

  beforeEach(() => {
    useWorkspaceStore.setState({
      weightedMatrices: [MATRIX],
      weightedOptions: [OPTION, LEGACY_OPTION, DEFAULT_OPTION],
      weightedCriteria: [CRITERION, LEGACY_CRITERION],
      whiteboardObjects: [canvasCard(OPTION.id), canvasCard(LEGACY_OPTION.id)],
    });
  });

  it("removes its options and criteria, and no other option keeps a score for them", () => {
    useWorkspaceStore.getState().removeWeightedMatrix(MATRIX.id);
    const s = useWorkspaceStore.getState();
    expect(s.weightedMatrices).toEqual([]);
    expect(s.weightedOptions?.map((o) => o.id)).toEqual([LEGACY_OPTION.id, DEFAULT_OPTION.id]);
    expect(s.weightedCriteria).toEqual([LEGACY_CRITERION]);
    // The legacy option had a stray score for the removed criterion.
    expect(s.weightedOptions?.[0].scores).toEqual({ "crit-legacy": 4 });
    // Only the removed option's canvas card loses its link.
    const refs = s.whiteboardObjects?.map((o) => o.sourceRef?.entityId);
    expect(refs).toEqual([undefined, LEGACY_OPTION.id]);
  });

  it("the default matrix holds the rows without a matrixId", () => {
    useWorkspaceStore.getState().removeWeightedMatrix(DEFAULT_WEIGHTED_MATRIX_ID);
    const s = useWorkspaceStore.getState();
    expect(s.weightedMatrices).toEqual([MATRIX]);
    expect(s.weightedOptions?.map((o) => o.id)).toEqual([OPTION.id]);
    expect(s.weightedCriteria).toEqual([CRITERION]);
    expect(s.weightedOptions?.[0].scores).toEqual(OPTION.scores);
  });

  it("a row with an empty matrixId is read as in the default matrix, not in none", () => {
    expect(weightedMatrixIdOf({ matrixId: "" })).toBe(DEFAULT_WEIGHTED_MATRIX_ID);
    expect(weightedMatrixIdOf({})).toBe(DEFAULT_WEIGHTED_MATRIX_ID);
    expect(weightedMatrixIdOf(OPTION)).toBe(MATRIX.id);
    const stray = { ...LEGACY_OPTION, id: "opt-stray", matrixId: "" };
    useWorkspaceStore.setState({ weightedOptions: [OPTION, stray] });
    useWorkspaceStore.getState().removeWeightedMatrix(DEFAULT_WEIGHTED_MATRIX_ID);
    expect(useWorkspaceStore.getState().weightedOptions?.map((o) => o.id)).toEqual([OPTION.id]);
  });

  it("an empty matrix removes only its row", () => {
    const before = useWorkspaceStore.getState();
    useWorkspaceStore.getState().upsertWeightedMatrix({ ...MATRIX, id: "weightedMatrix_empty" });
    useWorkspaceStore.getState().removeWeightedMatrix("weightedMatrix_empty");
    const s = useWorkspaceStore.getState();
    expect(s.weightedMatrices).toEqual([MATRIX]);
    expect(s.weightedOptions).toBe(before.weightedOptions);
    expect(s.weightedCriteria).toBe(before.weightedCriteria);
    expect(s.whiteboardObjects).toBe(before.whiteboardObjects);
  });
});

describe("the widened records keep every new field through the store", () => {
  it("a backlog item with no method inputs arrives through sync untouched", () => {
    const kind = kindFromToolId("workspace.backlog_item");
    const target = registered.entities.find((e) => e.kind === kind);
    target!.setEntities([BACKLOG_BARE]);
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_BARE]);
    expect(target!.getEntities()).toEqual([BACKLOG_BARE]);
  });

  it("upserts, exports and imports them unchanged", () => {
    const st = useWorkspaceStore.getState();
    st.upsertBacklogItem(BACKLOG_FULL);
    st.upsertStory(STORY_RANKED);
    st.upsertDecision(DECISION);
    st.upsertPrioritization(FUNDED_FEATURE);
    st.upsertCynefinItem(CYNEFIN);
    st.upsertWeightedOption(OPTION);
    st.upsertWeightedCriterion(CRITERION);

    const json = useWorkspaceStore.getState().exportJSON();
    useWorkspaceStore.getState().resetWorkspace();
    useWorkspaceStore.getState().importJSON(json);

    const s = useWorkspaceStore.getState();
    expect(s.backlogItems).toEqual([BACKLOG_FULL]);
    expect(s.stories.find((x) => x.id === STORY_RANKED.id)).toMatchObject(STORY_RANKED);
    expect(s.decisions).toEqual([DECISION]);
    expect(s.prioritizations).toEqual([FUNDED_FEATURE]);
    expect(s.cynefinItems).toEqual([CYNEFIN]);
    expect(s.weightedOptions).toEqual([OPTION]);
    expect(s.weightedCriteria).toEqual([CRITERION]);
  });
});

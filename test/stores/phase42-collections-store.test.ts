/**
 * The Phase 42 workspace collections (the tools plan's phase 1):
 * parkingLotItems, rootCauseAnalyses, productGoals, interruptItems,
 * notebookEntries and meetingAudits. Each upserts by id and removes, rides
 * export and import, is cleared by reset, is in the workspace snapshot, and
 * cloud-syncs under the kind its workspace.* CRUD derives. Also: a sprint's
 * interrupt buffer and a story's Given/When/Then criteria ride the same paths.
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
  INTERRUPT_ITEM_KIND,
  MEETING_AUDIT_KIND,
  NOTEBOOK_ENTRY_KIND,
  PARKING_LOT_ITEM_KIND,
  PRODUCT_GOAL_KIND,
  ROOT_CAUSE_ANALYSIS_KIND,
  emptyWorkspace,
  type Workspace,
} from "@/lib/stores/workspace-types";
import {
  ANALYSIS,
  GOAL,
  INTERRUPT,
  MEETING,
  NOTE,
  PARKED,
  SPRINT_WITH_BUFFER,
  STORY_WITH_GWT,
} from "./phase42-fixtures";

type Doc = { id: string };

const ws = () => useWorkspaceStore.getState();

/** Each new collection: its slice, store actions, a full record, its CRUD toolId and exported kind. */
const COLLECTIONS: {
  slice: keyof Workspace;
  doc: Doc;
  upsert: (x: never) => void;
  remove: (id: string) => void;
  toolId: string;
  kind: string;
}[] = [
  {
    slice: "parkingLotItems",
    doc: PARKED,
    upsert: (x) => ws().upsertParkingLotItem(x),
    remove: (id) => ws().removeParkingLotItem(id),
    toolId: "workspace.parking_lot_item",
    kind: PARKING_LOT_ITEM_KIND,
  },
  {
    slice: "rootCauseAnalyses",
    doc: ANALYSIS,
    upsert: (x) => ws().upsertRootCauseAnalysis(x),
    remove: (id) => ws().removeRootCauseAnalysis(id),
    toolId: "workspace.root_cause_analysis",
    kind: ROOT_CAUSE_ANALYSIS_KIND,
  },
  {
    slice: "productGoals",
    doc: GOAL,
    upsert: (x) => ws().upsertProductGoal(x),
    remove: (id) => ws().removeProductGoal(id),
    toolId: "workspace.product_goal",
    kind: PRODUCT_GOAL_KIND,
  },
  {
    slice: "interruptItems",
    doc: INTERRUPT,
    upsert: (x) => ws().upsertInterruptItem(x),
    remove: (id) => ws().removeInterruptItem(id),
    toolId: "workspace.interrupt_item",
    kind: INTERRUPT_ITEM_KIND,
  },
  {
    slice: "notebookEntries",
    doc: NOTE,
    upsert: (x) => ws().upsertNotebookEntry(x),
    remove: (id) => ws().removeNotebookEntry(id),
    toolId: "workspace.notebook_entry",
    kind: NOTEBOOK_ENTRY_KIND,
  },
  {
    slice: "meetingAudits",
    doc: MEETING,
    upsert: (x) => ws().upsertMeetingAudit(x),
    remove: (id) => ws().removeMeetingAudit(id),
    toolId: "workspace.meeting_audit",
    kind: MEETING_AUDIT_KIND,
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

describe("the Phase 42 collections", () => {
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
});

describe("the fields Phase 42 adds to sprints and stories", () => {
  it("a sprint keeps its interrupt buffer through upsert, export and import", () => {
    ws().upsertSprint(SPRINT_WITH_BUFFER);
    expect(ws().sprints).toEqual([SPRINT_WITH_BUFFER]);
    const json = ws().exportJSON();
    ws().resetWorkspace();
    ws().importJSON(json);
    expect(ws().sprints[0].interruptBuffer).toEqual({ pct: 20, points: 6 });
  });

  it("a story keeps its Given/When/Then criteria beside the free-text ones", () => {
    ws().upsertStory(STORY_WITH_GWT);
    const stored = ws().stories.find((s) => s.id === STORY_WITH_GWT.id)!;
    expect(stored.gwt).toEqual(STORY_WITH_GWT.gwt);
    expect(stored.acceptanceCriteria).toBe("Works on Android and iOS.");
    const json = ws().exportJSON();
    ws().resetWorkspace();
    ws().importJSON(json);
    expect(ws().stories.find((s) => s.id === STORY_WITH_GWT.id)?.gwt).toEqual(STORY_WITH_GWT.gwt);
  });
});

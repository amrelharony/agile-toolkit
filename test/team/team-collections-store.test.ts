/**
 * The Phase 6 (Team & people) workspace collections: definitionsOfDone,
 * raciMatrices, adkarDocs, moodTrackerDocs and moodPulses. Each upserts by
 * id and removes, rides export and import, is cleared by reset, is in the
 * workspace snapshot, and cloud-syncs under the kind its workspace.* CRUD
 * derives. Also: an unassessed maturity level syncs as null.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const registered = vi.hoisted(() => ({
  entities: [] as {
    kind: string;
    getEntities: () => ReadonlyArray<{ id: string }>;
    setEntities: (next: ReadonlyArray<{ id: string }>) => void;
  }[],
  blobs: [] as {
    storeKey: string;
    getSnapshot: () => unknown;
    setSnapshot: (next: unknown) => void;
  }[],
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
  ADKAR_KIND,
  DOD_KIND,
  MOOD_PULSE_KIND,
  MOOD_TRACKER_KIND,
  RACI_KIND,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { ADKAR, DOD, MOOD_DOC, PULSE, RACI } from "./phase6-fixtures";

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
    slice: "definitionsOfDone",
    doc: DOD,
    upsert: (x) => useWorkspaceStore.getState().upsertDefinitionOfDone(x),
    remove: (id) => useWorkspaceStore.getState().removeDefinitionOfDone(id),
    toolId: "workspace.definition_of_done",
    kind: DOD_KIND,
  },
  {
    slice: "raciMatrices",
    doc: RACI,
    upsert: (x) => useWorkspaceStore.getState().upsertRaciMatrix(x),
    remove: (id) => useWorkspaceStore.getState().removeRaciMatrix(id),
    toolId: "workspace.raci_matrix",
    kind: RACI_KIND,
  },
  {
    slice: "adkarDocs",
    doc: ADKAR,
    upsert: (x) => useWorkspaceStore.getState().upsertAdkarDoc(x),
    remove: (id) => useWorkspaceStore.getState().removeAdkarDoc(id),
    toolId: "workspace.adkar_doc",
    kind: ADKAR_KIND,
  },
  {
    slice: "moodTrackerDocs",
    doc: MOOD_DOC,
    upsert: (x) => useWorkspaceStore.getState().upsertMoodTrackerDoc(x),
    remove: (id) => useWorkspaceStore.getState().removeMoodTrackerDoc(id),
    toolId: "workspace.mood_tracker_doc",
    kind: MOOD_TRACKER_KIND,
  },
  {
    slice: "moodPulses",
    doc: PULSE,
    upsert: (x) => useWorkspaceStore.getState().upsertMoodPulse(x),
    remove: (id) => useWorkspaceStore.getState().removeMoodPulse(id),
    toolId: "workspace.mood_pulse",
    kind: MOOD_PULSE_KIND,
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

describe("the Team & people collections", () => {
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

describe("the maturity level in the scalars blob", () => {
  const scalars = () => {
    const blob = registered.blobs.find((b) => b.storeKey === "agile-toolkit:workspace:scalars");
    if (!blob) throw new Error("scalars blob not registered");
    return blob;
  };

  it("sends an unassessed team as null, so clearing the level reaches other devices", () => {
    useWorkspaceStore.getState().setMaturityLevel(3);
    expect(scalars().getSnapshot()).toMatchObject({ maturityLevel: 3 });
    useWorkspaceStore.getState().setMaturityLevel(undefined);
    const sent = JSON.parse(JSON.stringify(scalars().getSnapshot())) as Record<string, unknown>;
    expect(sent).toHaveProperty("maturityLevel", null);
  });

  it("reads null as unassessed, and an out-of-range level too", () => {
    for (const bad of [null, 0, 6, 2.5, "3", Number.NaN]) {
      useWorkspaceStore.getState().setMaturityLevel(4);
      scalars().setSnapshot({ maturityLevel: bad });
      expect(useWorkspaceStore.getState().maturityLevel, String(bad)).toBeUndefined();
    }
    scalars().setSnapshot({ maturityLevel: 2 });
    expect(useWorkspaceStore.getState().maturityLevel).toBe(2);
  });

  it("leaves the level alone when the blob has no maturity key", () => {
    useWorkspaceStore.getState().setMaturityLevel(4);
    scalars().setSnapshot({ teamName: "Falcons" });
    expect(useWorkspaceStore.getState().maturityLevel).toBe(4);
    expect(useWorkspaceStore.getState().teamName).toBe("Falcons");
  });
});

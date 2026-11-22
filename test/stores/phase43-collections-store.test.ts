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
  AB_TEST_KIND,
  BUG_REPORT_KIND,
  EBM_BOARD_KIND,
  EXAMPLE_MAP_KIND,
  HILL_CHART_KIND,
  IMPROVEMENT_KIND,
  KICKOFF_KIND,
  MEETING_NOTE_KIND,
  POKER_ASYNC_ROUND_KIND,
  PERSONA_KIND,
  PRODUCT_CANVAS_KIND,
  PRODUCT_METRIC_KIND,
  STRATEGY_MAP_KIND,
  TEST_SESSION_KIND,
  WORKFLOW_DEFINITION_KIND,
  emptyWorkspace,
  type Workspace,
} from "@/lib/stores/workspace-types";
import {
  AB_TEST,
  ANALYSIS_WITH_LOOP,
  BUG_REPORT,
  EBM_BOARD,
  EXAMPLE_MAP,
  HILL_CHART,
  IMPACT_MAP,
  IMPEDIMENT_IN_CLUSTER,
  IMPROVEMENT,
  INTERRUPT_FROM_BUG,
  KICKOFF,
  MEETING_NOTE,
  PERSONA,
  POKER_ASYNC_ROUND,
  PRODUCT_CANVAS,
  PRODUCT_METRIC,
  RELEASES_WITH_NOTES,
  RETRO_WITH_DAYS,
  ROADMAP_WITH_HORIZON,
  STORY_WITH_FLOW,
  TEST_SESSION,
  TRACKER_WITH_VALUE_CHECK,
  WORKFLOW_DEFINITION,
} from "./phase43-fixtures";

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
  {
    slice: "bugReports",
    doc: BUG_REPORT,
    upsert: (x) => ws().upsertBugReport(x),
    remove: (id) => ws().removeBugReport(id),
    toolId: "workspace.bug_report",
    kind: BUG_REPORT_KIND,
  },
  {
    slice: "hillCharts",
    doc: HILL_CHART,
    upsert: (x) => ws().upsertHillChart(x),
    remove: (id) => ws().removeHillChart(id),
    toolId: "workspace.hill_chart",
    kind: HILL_CHART_KIND,
  },
  {
    slice: "testSessions",
    doc: TEST_SESSION,
    upsert: (x) => ws().upsertTestSession(x),
    remove: (id) => ws().removeTestSession(id),
    toolId: "workspace.test_session",
    kind: TEST_SESSION_KIND,
  },
  {
    slice: "meetingNotes",
    doc: MEETING_NOTE,
    upsert: (x) => ws().upsertMeetingNote(x),
    remove: (id) => ws().removeMeetingNote(id),
    toolId: "workspace.meeting_note",
    kind: MEETING_NOTE_KIND,
  },
  {
    slice: "productCanvases",
    doc: PRODUCT_CANVAS,
    upsert: (x) => ws().upsertProductCanvas(x),
    remove: (id) => ws().removeProductCanvas(id),
    toolId: "workspace.product_canvas",
    kind: PRODUCT_CANVAS_KIND,
  },
  {
    slice: "strategyMaps",
    doc: IMPACT_MAP,
    upsert: (x) => ws().upsertStrategyMap(x),
    remove: (id) => ws().removeStrategyMap(id),
    toolId: "workspace.strategy_map",
    kind: STRATEGY_MAP_KIND,
  },
  {
    slice: "personas",
    doc: PERSONA,
    upsert: (x) => ws().upsertPersona(x),
    remove: (id) => ws().removePersona(id),
    toolId: "workspace.persona",
    kind: PERSONA_KIND,
  },
  {
    slice: "productMetrics",
    doc: PRODUCT_METRIC,
    upsert: (x) => ws().upsertProductMetric(x),
    remove: (id) => ws().removeProductMetric(id),
    toolId: "workspace.product_metric",
    kind: PRODUCT_METRIC_KIND,
  },
  {
    slice: "abTests",
    doc: AB_TEST,
    upsert: (x) => ws().upsertAbTest(x),
    remove: (id) => ws().removeAbTest(id),
    toolId: "workspace.ab_test",
    kind: AB_TEST_KIND,
  },
  {
    slice: "ebmBoards",
    doc: EBM_BOARD,
    upsert: (x) => ws().upsertEbmBoard(x),
    remove: (id) => ws().removeEbmBoard(id),
    toolId: "workspace.ebm_board",
    kind: EBM_BOARD_KIND,
  },
  {
    slice: "workflowDefinitions",
    doc: WORKFLOW_DEFINITION,
    upsert: (x) => ws().upsertWorkflowDefinition(x),
    remove: (id) => ws().removeWorkflowDefinition(id),
    toolId: "workspace.workflow_definition",
    kind: WORKFLOW_DEFINITION_KIND,
  },
  {
    slice: "improvements",
    doc: IMPROVEMENT,
    upsert: (x) => ws().upsertImprovement(x),
    remove: (id) => ws().removeImprovement(id),
    toolId: "workspace.improvement",
    kind: IMPROVEMENT_KIND,
  },
  {
    slice: "kickoffs",
    doc: KICKOFF,
    upsert: (x) => ws().upsertKickoff(x),
    remove: (id) => ws().removeKickoff(id),
    toolId: "workspace.kickoff",
    kind: KICKOFF_KIND,
  },
];

/**
 * The fields Phase 43 adds to existing records: each record with them set,
 * how the store writes it and the slice it lands in.
 */
const EXTENDED: {
  name: string;
  slice: keyof Workspace;
  doc: Doc;
  upsert: (x: never) => void;
}[] = [
  {
    name: "a release's notes (P2.2)",
    slice: "releaseReadinesses",
    doc: RELEASES_WITH_NOTES,
    upsert: (x) => ws().upsertReleaseReadiness(x),
  },
  {
    name: "an interrupt's sourceRef (P2.2)",
    slice: "interruptItems",
    doc: INTERRUPT_FROM_BUG,
    upsert: (x) => ws().upsertInterruptItem(x),
  },
  {
    name: "an epic's horizon and sourceRef (P2.4)",
    slice: "epicRoadmaps",
    doc: ROADMAP_WITH_HORIZON,
    upsert: (x) => ws().upsertEpicRoadmap(x),
  },
  {
    name: "a hypothesis's value check (P2.5)",
    slice: "hypothesisTrackers",
    doc: TRACKER_WITH_VALUE_CHECK,
    upsert: (x) => ws().upsertHypothesisTracker(x),
  },
  {
    name: "an impediment's cluster and side (P2.6)",
    slice: "impediments",
    doc: IMPEDIMENT_IN_CLUSTER,
    upsert: (x) => ws().upsertImpediment(x),
  },
  {
    name: "a root-cause analysis's causal loop (P2.7)",
    slice: "rootCauseAnalyses",
    doc: ANALYSIS_WITH_LOOP,
    upsert: (x) => ws().upsertRootCauseAnalysis(x),
  },
  {
    name: "a retro card's day (P2.7)",
    slice: "retroBoards",
    doc: RETRO_WITH_DAYS,
    upsert: (x) => ws().upsertRetroBoard(x),
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

describe("the fields Phase 43 adds to existing records", () => {
  it.each(EXTENDED.map((e) => [e.name, e] as const))(
    "%s survives upsert, export and import",
    (_, e) => {
      e.upsert(e.doc as never);
      const stored = () => slice(e.slice)?.find((d) => d.id === e.doc.id);
      expect(stored()).toEqual(e.doc);
      const json = ws().exportJSON();
      ws().resetWorkspace();
      expect(stored()).toBeUndefined();
      ws().importJSON(json);
      expect(stored()).toEqual(e.doc);
    }
  );
});

describe("the story fields Phase 43 adds", () => {
  it("a story keeps its work type, demand and blocked spells through upsert, export and import", () => {
    ws().upsertStory(STORY_WITH_FLOW);
    const stored = () => ws().stories.find((s) => s.id === STORY_WITH_FLOW.id);
    const flow = (s: typeof STORY_WITH_FLOW | undefined) => ({
      workType: s?.workType,
      demand: s?.demand,
      blockLog: s?.blockLog,
    });
    expect(flow(stored())).toEqual(flow(STORY_WITH_FLOW));
    const json = ws().exportJSON();
    ws().resetWorkspace();
    ws().importJSON(json);
    expect(flow(stored())).toEqual(flow(STORY_WITH_FLOW));
  });
});

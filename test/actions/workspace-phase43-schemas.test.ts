/**
 * The workspace.* CRUD for the Phase 43 collections (the tools plan's phase
 * 2). `update` validates the merged record and writes what the schema
 * parsed, and z.object drops keys it doesn't know, so every field must be in
 * the schema or an agent's update would erase it. Also: times stamped on
 * create and update, the caps the pages share, each refine and refusal on
 * both transports, the kind each syncs under, the fields Phase 43 adds to
 * existing records, and that each create schema converts to JSON Schema.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverGetEntity: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => {}),
    serverBulkUpsertEntities: vi.fn(async () => {}),
  };
});

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  AB_TEST_KIND,
  BUG_REPORT_KIND,
  EBM_BOARD_KIND,
  ENTITY_ROW_MAX_BYTES,
  EXAMPLE_MAP_KIND,
  HILL_CHART_KIND,
  IMPROVEMENT_KIND,
  KICKOFF_BRIEF_MAX,
  KICKOFF_ITEM_MAX,
  KICKOFF_KIND,
  KICKOFF_SLIDER_LABEL_MAX,
  MEETING_NOTE_KIND,
  PERSONA_KIND,
  PRODUCT_CANVAS_KIND,
  PRODUCT_METRIC_KIND,
  RETRO_CARD_DAY_MAX,
  STRATEGY_MAP_KIND,
  TEAM_TIME_PERSON_KIND,
  TEAM_TIME_POLL_KIND,
  TEAM_TIME_ROTATION_KIND,
  TEST_SESSION_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ExampleMap,
  type Improvement,
  type Kickoff,
  type ProductCanvas,
  type Workspace,
  WORKFLOW_DEFINITION_KIND,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import { SECTION_KEY_PATTERN, sectionsSchema } from "@/lib/actions/workspace/sectioned-schema";
import { SECTION_ITEM_ID_MAX } from "@/lib/sectioned/model";
import {
  AB_TEST,
  ANALYSIS_WITH_LOOP,
  AT as AT_TIME,
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
  PRODUCT_CANVAS,
  PRODUCT_CASE,
  PRODUCT_IDEA,
  PRODUCT_METRIC,
  RELEASES_WITH_NOTES,
  RETRO_WITH_DAYS,
  ROADMAP_WITH_HORIZON,
  STANDUP_PPP,
  STRATEGY_TREE,
  STORY_WITH_FLOW,
  TEAM_TIME_PERSON,
  TEAM_TIME_POLL,
  TEAM_TIME_ROTATION,
  TEST_SESSION,
  TRACKER_WITH_VALUE_CHECK,
  WORKFLOW_DEFINITION,
} from "../stores/phase43-fixtures";
import { AGREEMENT } from "../team/phase6-fixtures";

const upsertEntity = vi.mocked(serverStore.serverUpsertEntity);
const listEntities = vi.mocked(serverStore.serverListEntities);
const getEntity = vi.mocked(serverStore.serverGetEntity);

type Doc = { id: string };

const NOW = "2026-11-13T08:00:00.000Z";

const action = (id: string) => {
  const a = registry.get(id);
  if (!a) throw new Error(`missing action ${id}`);
  return a;
};

const parseCreate = (toolId: string, entity: unknown) =>
  action(`${toolId}.create`).paramsSchema.safeParse({ entity });

const rejects = (toolId: string, entity: unknown) =>
  expect(parseCreate(toolId, entity).success, JSON.stringify(entity).slice(0, 120)).toBe(false);

const accepts = (toolId: string, entity: unknown) => {
  const parsed = parseCreate(toolId, entity);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
};

/** Run `create` the way both transports do: params validated first. */
async function create(toolId: string, entity: unknown, mcp = false) {
  const a = action(`${toolId}.create`);
  const parsed = a.paramsSchema.safeParse({ entity });
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  return mcp
    ? a.mcpHandler!(parsed.data, makeContext("u", "mcp"))
    : a.handler(parsed.data, makeContext("u", "agent"));
}

/** Seed the slice, run the in-tab `update` with `patch`, and read the record back. */
async function update(toolId: string, slice: keyof Workspace, doc: Doc, patch = {}) {
  useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
  await action(`${toolId}.update`).handler({ id: doc.id, patch }, makeContext("u", "agent"));
  return (useWorkspaceStore.getState()[slice] as Doc[]).find((d) => d.id === doc.id);
}

/** Run the MCP `update` of a stored `doc` with `patch`; resolves to the row it wrote. */
async function updateOverMcp(toolId: string, doc: Doc, patch = {}) {
  getEntity.mockResolvedValue(doc);
  await action(`${toolId}.update`).mcpHandler!({ id: doc.id, patch }, makeContext("u", "mcp"));
  return upsertEntity.mock.calls.at(-1)?.[2] as Doc | undefined;
}

/** Text of `n` characters that costs 3 bytes each in UTF-8 (the most a capped character of real text costs). */
const wide = (n: number) => "界".repeat(n);

/** Text of `n` characters that JSON-escapes to 6 bytes each (a control character). */
const escaped = (n: number) => String.fromCharCode(7).repeat(n);

/** `n` hand-off links on one route: a sentTo list has no cap of its own, so it can grow a row. */
const links = (n: number, route: string) =>
  Array.from({ length: n }, (_, i) => ({
    route,
    targetId: `${route}_${String(i).padStart(8, "0")}`,
    at: NOW,
  }));

const COLLECTIONS: [toolId: string, slice: keyof Workspace, doc: Doc, kind: string][] = [
  ["workspace.example_map", "exampleMaps", EXAMPLE_MAP, EXAMPLE_MAP_KIND],
  ["workspace.bug_report", "bugReports", BUG_REPORT, BUG_REPORT_KIND],
  ["workspace.hill_chart", "hillCharts", HILL_CHART, HILL_CHART_KIND],
  ["workspace.test_session", "testSessions", TEST_SESSION, TEST_SESSION_KIND],
  ["workspace.meeting_note", "meetingNotes", MEETING_NOTE, MEETING_NOTE_KIND],
  ["workspace.product_canvas", "productCanvases", PRODUCT_CANVAS, PRODUCT_CANVAS_KIND],
  ["workspace.product_canvas", "productCanvases", PRODUCT_IDEA, PRODUCT_CANVAS_KIND],
  ["workspace.product_canvas", "productCanvases", PRODUCT_CASE, PRODUCT_CANVAS_KIND],
  ["workspace.strategy_map", "strategyMaps", IMPACT_MAP, STRATEGY_MAP_KIND],
  ["workspace.persona", "personas", PERSONA, PERSONA_KIND],
  ["workspace.product_metric", "productMetrics", PRODUCT_METRIC, PRODUCT_METRIC_KIND],
  ["workspace.ab_test", "abTests", AB_TEST, AB_TEST_KIND],
  ["workspace.ebm_board", "ebmBoards", EBM_BOARD, EBM_BOARD_KIND],
  [
    "workspace.workflow_definition",
    "workflowDefinitions",
    WORKFLOW_DEFINITION,
    WORKFLOW_DEFINITION_KIND,
  ],
  ["workspace.improvement", "improvements", IMPROVEMENT, IMPROVEMENT_KIND],
  ["workspace.kickoff", "kickoffs", KICKOFF, KICKOFF_KIND],
  ["workspace.team_time_person", "teamTimePeople", TEAM_TIME_PERSON, TEAM_TIME_PERSON_KIND],
  ["workspace.team_time_poll", "teamTimePolls", TEAM_TIME_POLL, TEAM_TIME_POLL_KIND],
  [
    "workspace.team_time_rotation",
    "teamTimeRotations",
    TEAM_TIME_ROTATION,
    TEAM_TIME_ROTATION_KIND,
  ],
];

/** The one-document collections: create keeps their fixed id. */
const SINGLETONS: readonly string[] = ["workspace.ebm_board", "workspace.workflow_definition"];

/** A record to create: without its id, so the CRUD mints one, unless it is a singleton. */
const fresh = (toolId: string, doc: Doc) =>
  SINGLETONS.includes(toolId) ? doc : { ...doc, id: undefined };

/** The fields Phase 43 adds to existing records: the CRUD, its slice and a record with them set. */
const EXTENDED: [name: string, toolId: string, slice: keyof Workspace, doc: Doc][] = [
  [
    "a release's notes (P2.2)",
    "workspace.release_readiness",
    "releaseReadinesses",
    RELEASES_WITH_NOTES,
  ],
  [
    "an interrupt's sourceRef (P2.2)",
    "workspace.interrupt_item",
    "interruptItems",
    INTERRUPT_FROM_BUG,
  ],
  [
    "an epic's horizon and sourceRef (P2.4)",
    "workspace.epic_roadmap",
    "epicRoadmaps",
    ROADMAP_WITH_HORIZON,
  ],
  [
    "a hypothesis's value check (P2.5)",
    "workspace.hypothesis_tracker",
    "hypothesisTrackers",
    TRACKER_WITH_VALUE_CHECK,
  ],
  [
    "an impediment's cluster and side (P2.6)",
    "workspace.impediment",
    "impediments",
    IMPEDIMENT_IN_CLUSTER,
  ],
  [
    "a root-cause analysis's causal loop (P2.7)",
    "workspace.root_cause_analysis",
    "rootCauseAnalyses",
    ANALYSIS_WITH_LOOP,
  ],
  [
    "a standup entry's format, DRI and hand-over (P2.9)",
    "workspace.standup_entry",
    "standupEntries",
    STANDUP_PPP,
  ],
  [
    "the charter templates and a rule's template and sourceRef (P2.8, P2.9)",
    "workspace.working_agreement",
    "workingAgreements",
    AGREEMENT,
  ],
];

/** Everything but the times the CRUD stamps. */
const unstamped = (d: Doc) => {
  const {
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = d as Doc & {
    createdAt?: string;
    updatedAt?: string;
  };
  void _c;
  void _u;
  return rest;
};

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
  listEntities.mockReset();
  listEntities.mockResolvedValue([]);
  getEntity.mockReset();
  getEntity.mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Phase 43 CRUD schemas keep every field", () => {
  it.each(COLLECTIONS)("%s parses a full record unchanged", (toolId, _slice, doc) => {
    const parsed = parseCreate(toolId, doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
  });

  it.each(COLLECTIONS)("%s update keeps every field", async (toolId, slice, doc) => {
    const stored = await update(toolId, slice, doc);
    expect(unstamped(stored!)).toEqual(unstamped(doc));
  });

  it.each(COLLECTIONS)("%s update over MCP keeps every field", async (toolId, _slice, doc) => {
    const written = await updateOverMcp(toolId, doc);
    expect(unstamped(written!)).toEqual(unstamped(doc));
  });

  it.each(COLLECTIONS)(
    "%s syncs under its exported kind over MCP",
    async (toolId, _s, doc, kind) => {
      await create(toolId, fresh(toolId, doc), true);
      expect(upsertEntity).toHaveBeenCalledTimes(1);
      expect(upsertEntity.mock.calls[0][1]).toBe(kind);
    }
  );

  it.each(COLLECTIONS)(
    "%s stamps createdAt and updatedAt, never the caller's",
    async (toolId, slice, doc) => {
      await create(toolId, {
        ...fresh(toolId, doc),
        createdAt: "1999-01-01T00:00:00.000Z",
        updatedAt: "1999-01-01T00:00:00.000Z",
      });
      const made = (useWorkspaceStore.getState()[slice] as Doc[])[0] as Doc & {
        createdAt: string;
        updatedAt: string;
      };
      expect(made.createdAt).toBe(NOW);
      expect(made.updatedAt).toBe(NOW);
      const stored = (await update(toolId, slice, doc, {
        createdAt: "1999-01-01T00:00:00.000Z",
      })) as Doc & { createdAt: string; updatedAt: string };
      expect(stored.createdAt).toBe((doc as Doc & { createdAt: string }).createdAt);
      expect(stored.updatedAt).toBe(NOW);
    }
  );

  it("every CRUD verb is registered and its create schema converts to JSON Schema", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [toolId] of COLLECTIONS) {
      for (const verb of ["create", "list", "update", "delete"]) {
        expect(registry.get(`${toolId}.${verb}`), `${toolId}.${verb}`).toBeDefined();
      }
      const json = zodToJsonSchema(action(`${toolId}.create`).paramsSchema);
      expect(json, toolId).toHaveProperty("properties.entity");
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the row size guard", () => {
  it("is under the database's 512 KB row limit", () => {
    expect(ENTITY_ROW_MAX_BYTES).toBe(480 * 1024);
    expect(ENTITY_ROW_MAX_BYTES).toBeLessThan(512 * 1024);
  });
});

describe("P2.1 example maps", () => {
  const T = "workspace.example_map";
  const rule = (i: number) => ({ id: `r${i}`, text: "rule" });
  const example = (i: number) => ({ id: `e${i}`, ruleId: "r1", text: "example" });
  const question = (i: number) => ({ id: `q${i}`, text: "question", status: "open" });

  it("mint exmap_ ids", async () => {
    const { id } = (await create(T, { ...EXAMPLE_MAP, id: undefined })) as { id: string };
    expect(id).toMatch(/^exmap_/);
  });

  it("hold every cap", () => {
    rejects(T, { ...EXAMPLE_MAP, title: "  " });
    rejects(T, { ...EXAMPLE_MAP, title: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    rejects(T, { ...EXAMPLE_MAP, storyId: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    rejects(T, {
      ...EXAMPLE_MAP,
      rules: Array.from({ length: TOOL_LIST_MAX.mapRules + 1 }, (_, i) => rule(i)),
    });
    accepts(T, {
      ...EXAMPLE_MAP,
      rules: Array.from({ length: TOOL_LIST_MAX.mapRules }, (_, i) => rule(i)),
    });
    rejects(T, {
      ...EXAMPLE_MAP,
      examples: Array.from({ length: TOOL_LIST_MAX.mapExamples + 1 }, (_, i) => example(i)),
    });
    rejects(T, {
      ...EXAMPLE_MAP,
      questions: Array.from({ length: TOOL_LIST_MAX.mapQuestions + 1 }, (_, i) => question(i)),
    });
    rejects(T, {
      ...EXAMPLE_MAP,
      rules: [{ id: "r1", text: "x".repeat(TOOL_TEXT_MAX.short + 1) }],
    });
    rejects(T, { ...EXAMPLE_MAP, rules: [{ id: "", text: "rule" }] });
    rejects(T, {
      ...EXAMPLE_MAP,
      examples: [{ ...example(1), text: "x".repeat(TOOL_TEXT_MAX.short + 1) }],
    });
    rejects(T, {
      ...EXAMPLE_MAP,
      examples: [
        { ...example(1), given: "x".repeat(TOOL_TEXT_MAX.text + 1), when: "w", then: "t" },
      ],
    });
    rejects(T, {
      ...EXAMPLE_MAP,
      questions: [{ ...question(1), owner: "x".repeat(TOOL_TEXT_MAX.short + 1) }],
    });
    rejects(T, {
      ...EXAMPLE_MAP,
      questions: [{ ...question(1), answer: "x".repeat(TOOL_TEXT_MAX.text + 1) }],
    });
  });

  it("refuse values outside their range or set", () => {
    rejects(T, { ...EXAMPLE_MAP, verdict: "maybe" });
    rejects(T, { ...EXAMPLE_MAP, questions: [{ ...question(1), status: "parked" }] });
    rejects(T, { ...EXAMPLE_MAP, timeboxMinutes: 4 });
    rejects(T, { ...EXAMPLE_MAP, timeboxMinutes: 61 });
    rejects(T, { ...EXAMPLE_MAP, timeboxMinutes: 25.5 });
    rejects(T, { ...EXAMPLE_MAP, sentAt: "yesterday" });
    rejects(T, {
      ...EXAMPLE_MAP,
      sentTo: [{ route: "nowhere", targetId: "s", at: NOW }],
    });
  });

  it("take Given, When and Then all three or none, on both transports", async () => {
    rejects(T, { ...EXAMPLE_MAP, examples: [{ ...example(1), given: "g", when: "w" }] });
    rejects(T, { ...EXAMPLE_MAP, examples: [{ ...example(1), then: "t" }] });
    accepts(T, { ...EXAMPLE_MAP, examples: [example(1)] });
    accepts(T, {
      ...EXAMPLE_MAP,
      examples: [{ ...example(1), given: "g", when: "w", then: "t" }],
    });
    const half = { examples: [{ ...example(1), given: "g" }] };
    await expect(update(T, "exampleMaps", EXAMPLE_MAP, half)).rejects.toThrow(
      /Given, When and Then all three, or none/
    );
    expect(useWorkspaceStore.getState().exampleMaps).toEqual([EXAMPLE_MAP]);
    await expect(updateOverMcp(T, EXAMPLE_MAP, half)).rejects.toThrow(
      /Given, When and Then all three, or none/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("put every example under a rule on the map, on both transports", async () => {
    const one = { ...EXAMPLE_MAP, rules: [{ id: "r1", text: "R" }] };
    accepts(T, { ...one, examples: [{ id: "e1", ruleId: "r1", text: "A" }] });
    rejects(T, { ...one, examples: [{ id: "e1", ruleId: "ghost", text: "A" }] });
    await expect(
      create(T, { ...one, id: undefined, examples: [{ id: "e1", ruleId: "ghost", text: "A" }] })
    ).rejects.toThrow(/Every example goes under a rule on the map\./);
    // Removing a rule that still has examples is refused too.
    const orphans = { rules: [EXAMPLE_MAP.rules[0]] };
    await expect(update(T, "exampleMaps", EXAMPLE_MAP, orphans)).rejects.toThrow(
      /Every example goes under a rule on the map\./
    );
    expect(useWorkspaceStore.getState().exampleMaps).toEqual([EXAMPLE_MAP]);
    await expect(updateOverMcp(T, EXAMPLE_MAP, orphans)).rejects.toThrow(
      /Every example goes under a rule on the map\./
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("refuse a map too big for one row, on both transports", async () => {
    // 60 examples with Given, When and Then at their caps, in 3-byte text.
    const examples = Array.from({ length: TOOL_LIST_MAX.mapExamples }, (_, i) => ({
      ...example(i),
      given: wide(TOOL_TEXT_MAX.text),
      when: wide(TOOL_TEXT_MAX.text),
      then: wide(TOOL_TEXT_MAX.text),
    }));
    const big: ExampleMap = { ...EXAMPLE_MAP, examples };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(
      ENTITY_ROW_MAX_BYTES
    );
    await expect(create(T, { ...big, id: undefined })).rejects.toThrow(
      /This example map is too big to save\. Shorten or remove some lines\. Nothing was saved\./
    );
    await expect(create(T, { ...big, id: undefined }, true)).rejects.toThrow(/too big to save/);
    await expect(update(T, "exampleMaps", EXAMPLE_MAP, { examples })).rejects.toThrow(
      /too big to save/
    );
    expect(useWorkspaceStore.getState().exampleMaps).toEqual([EXAMPLE_MAP]);
    await expect(updateOverMcp(T, EXAMPLE_MAP, { examples })).rejects.toThrow(/too big to save/);
    expect(upsertEntity).not.toHaveBeenCalled();
    // Half of them fits.
    accepts(T, { ...big, examples: examples.slice(0, 30) });
  });
});

describe("the fields Phase 43 adds to existing records", () => {
  it.each(EXTENDED)("%s parses and survives update", async (_name, toolId, slice, doc) => {
    const parsed = parseCreate(toolId, doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
    expect(unstamped((await update(toolId, slice, doc))!)).toEqual(unstamped(doc));
  });

  it("cap a release's notes", () => {
    const [release] = RELEASES_WITH_NOTES.releases;
    const withNotes = (releaseNotes: unknown) => ({
      ...RELEASES_WITH_NOTES,
      releases: [{ ...release, releaseNotes }],
    });
    rejects(
      "workspace.release_readiness",
      withNotes({ ...release.releaseNotes, text: "x".repeat(TOOL_TEXT_MAX.releaseNotes + 1) })
    );
    rejects("workspace.release_readiness", withNotes({ ...release.releaseNotes, audience: "all" }));
    accepts(
      "workspace.release_readiness",
      withNotes({ ...release.releaseNotes, text: "x".repeat(TOOL_TEXT_MAX.releaseNotes) })
    );
  });

  it("keep a reopened ship's reopen time, an ISO time", async () => {
    const [release] = RELEASES_WITH_NOTES.releases;
    const withShip = (ship: unknown) => ({
      ...RELEASES_WITH_NOTES,
      releases: [{ ...release, previousShips: [ship] }],
    });
    const kept = withShip({ shippedDate: "2026-11-10", reopenedAt: "2026-11-15T09:30:00.000Z" });
    accepts("workspace.release_readiness", kept);
    expect(
      unstamped((await update("workspace.release_readiness", "releaseReadinesses", kept))!)
    ).toEqual(unstamped(kept));
    rejects(
      "workspace.release_readiness",
      withShip({ shippedDate: "2026-11-10", reopenedAt: "15 Nov" })
    );
  });
});

describe("P2.2 bug reports", () => {
  const T = "workspace.bug_report";

  it("mint bug_ ids", async () => {
    const { id } = (await create(T, { title: "Crash on start", status: "new" })) as { id: string };
    expect(id).toMatch(/^bug_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...BUG_REPORT, title: "" });
    rejects(T, { ...BUG_REPORT, title: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    for (const key of ["steps", "expected", "actual"]) {
      rejects(T, { ...BUG_REPORT, [key]: "x".repeat(TOOL_TEXT_MAX.text + 1) });
    }
    for (const key of ["environment", "area", "reportedBy", "duplicateOf"]) {
      rejects(T, { ...BUG_REPORT, [key]: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    }
    rejects(T, { ...BUG_REPORT, severity: "blocker" });
    rejects(T, { ...BUG_REPORT, priority: "asap" });
    rejects(T, { ...BUG_REPORT, status: "open" });
    rejects(T, { ...BUG_REPORT, closeReason: "fixed-it" });
    rejects(T, { ...BUG_REPORT, checks: { reach: "everyone" } });
    rejects(T, { ...BUG_REPORT, triagedAt: "today" });
    rejects(T, { ...BUG_REPORT, closedAt: "2026-11-12" });
  });
});

describe("P2.2 hill charts", () => {
  const T = "workspace.hill_chart";
  const scope = (i: number) => ({ id: `sc${i}`, title: "scope", position: 10, movedAt: NOW });

  it("mint hill_ ids", async () => {
    const { id } = (await create(T, { ...HILL_CHART, id: undefined })) as { id: string };
    expect(id).toMatch(/^hill_/);
  });

  it("hold every cap", () => {
    rejects(T, { ...HILL_CHART, title: " " });
    rejects(T, { ...HILL_CHART, about: "x".repeat(TOOL_TEXT_MAX.text + 1) });
    rejects(T, {
      ...HILL_CHART,
      scopes: Array.from({ length: TOOL_LIST_MAX.hillScopes + 1 }, (_, i) => scope(i)),
    });
    accepts(T, {
      ...HILL_CHART,
      scopes: Array.from({ length: TOOL_LIST_MAX.hillScopes }, (_, i) => scope(i)),
    });
    rejects(T, {
      ...HILL_CHART,
      checkIns: Array.from({ length: TOOL_LIST_MAX.hillCheckIns + 1 }, (_, i) => ({
        id: `c${i}`,
        at: NOW,
        positions: [],
      })),
    });
    rejects(T, {
      ...HILL_CHART,
      scopes: [{ ...scope(1), note: "x".repeat(TOOL_TEXT_MAX.capture + 1) }],
    });
    rejects(T, {
      ...HILL_CHART,
      checkIns: [{ id: "c", at: NOW, positions: [], note: "x".repeat(TOOL_TEXT_MAX.capture + 1) }],
    });
  });

  it("place scopes only at whole positions from 0 to 100, at ISO times", () => {
    for (const position of [-1, 101, 50.5]) {
      rejects(T, { ...HILL_CHART, scopes: [{ ...scope(1), position }] });
      rejects(T, {
        ...HILL_CHART,
        checkIns: [{ id: "c", at: NOW, positions: [{ scopeId: "sc1", position }] }],
      });
    }
    accepts(T, { ...HILL_CHART, scopes: [{ ...scope(1), position: 0 }] });
    accepts(T, { ...HILL_CHART, scopes: [{ ...scope(1), position: 100 }] });
    rejects(T, { ...HILL_CHART, scopes: [{ ...scope(1), movedAt: "last week" }] });
    rejects(T, { ...HILL_CHART, checkIns: [{ id: "c", at: "Monday", positions: [] }] });
  });
});

describe("P2.2 test sessions", () => {
  const T = "workspace.test_session";
  const note = (i: number) => ({ id: `n${i}`, at: NOW, kind: "note", text: "note" });

  it("mint tsess_ ids", async () => {
    const { id } = (await create(T, { ...TEST_SESSION, id: undefined })) as { id: string };
    expect(id).toMatch(/^tsess_/);
  });

  it("hold every cap and range", () => {
    rejects(T, { ...TEST_SESSION, charter: { ...TEST_SESSION.charter, target: "" } });
    rejects(T, {
      ...TEST_SESSION,
      charter: { ...TEST_SESSION.charter, toLearn: "x".repeat(TOOL_TEXT_MAX.text + 1) },
    });
    rejects(T, {
      ...TEST_SESSION,
      charter: { ...TEST_SESSION.charter, using: "x".repeat(TOOL_TEXT_MAX.short + 1) },
    });
    for (const minutes of [14, 241, 30.5]) rejects(T, { ...TEST_SESSION, minutes });
    accepts(T, { ...TEST_SESSION, minutes: 15 });
    accepts(T, { ...TEST_SESSION, minutes: 240 });
    rejects(T, { ...TEST_SESSION, status: "paused" });
    rejects(T, { ...TEST_SESSION, coverage: "none" });
    rejects(T, {
      ...TEST_SESSION,
      notes: Array.from({ length: TOOL_LIST_MAX.sessionNotes + 1 }, (_, i) => note(i)),
    });
    rejects(T, {
      ...TEST_SESSION,
      notes: [{ ...note(1), text: "x".repeat(TOOL_TEXT_MAX.capture + 1) }],
    });
    rejects(T, { ...TEST_SESSION, notes: [{ ...note(1), kind: "todo" }] });
    rejects(T, { ...TEST_SESSION, debrief: "x".repeat(TOOL_TEXT_MAX.text + 1) });
  });

  it("take a time split that adds up to 100, on both transports", async () => {
    rejects(T, { ...TEST_SESSION, split: { testing: 50, bugs: 30, setup: 10 } });
    rejects(T, { ...TEST_SESSION, split: { testing: 60.5, bugs: 29.5, setup: 10 } });
    accepts(T, { ...TEST_SESSION, split: { testing: 100, bugs: 0, setup: 0 } });
    const off = { split: { testing: 90, bugs: 30, setup: 10 } };
    await expect(update(T, "testSessions", TEST_SESSION, off)).rejects.toThrow(/adds up to 100/);
    await expect(updateOverMcp(T, TEST_SESSION, off)).rejects.toThrow(/adds up to 100/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("refuse a session too big for one row, on both transports", async () => {
    // 200 notes at their cap in 3-byte text stay under the limit, so each
    // note also lists where it was sent: sentTo has no cap of its own.
    const notes = Array.from({ length: TOOL_LIST_MAX.sessionNotes }, (_, i) => ({
      ...note(i),
      text: wide(TOOL_TEXT_MAX.capture),
    }));
    accepts(T, { ...TEST_SESSION, notes });
    const sent = notes.map((n) => ({ ...n, sentTo: links(20, "bug") }));
    const big = { ...TEST_SESSION, notes: sent };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(
      ENTITY_ROW_MAX_BYTES
    );
    await expect(create(T, { ...big, id: undefined })).rejects.toThrow(
      /This test session is too big to save\. Shorten or remove some lines\. Nothing was saved\./
    );
    await expect(create(T, { ...big, id: undefined }, true)).rejects.toThrow(/too big to save/);
    await expect(update(T, "testSessions", TEST_SESSION, { notes: sent })).rejects.toThrow(
      /too big to save/
    );
    expect(useWorkspaceStore.getState().testSessions).toEqual([TEST_SESSION]);
    await expect(updateOverMcp(T, TEST_SESSION, { notes: sent })).rejects.toThrow(
      /too big to save/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });
});

describe("P2.2 meeting notes", () => {
  const T = "workspace.meeting_note";
  const item = (i: number) => ({
    id: `i${i}`,
    kind: "action",
    text: "act",
    status: "open",
    keptAt: NOW,
  });

  it("mint mnote_ ids", async () => {
    const { id } = (await create(T, { ...MEETING_NOTE, id: undefined })) as { id: string };
    expect(id).toMatch(/^mnote_/);
  });

  it("hold every cap and set", () => {
    accepts(T, { ...MEETING_NOTE, text: "" });
    accepts(T, { ...MEETING_NOTE, text: "x".repeat(TOOL_TEXT_MAX.paste) });
    rejects(T, { ...MEETING_NOTE, text: "x".repeat(TOOL_TEXT_MAX.paste + 1) });
    rejects(T, { ...MEETING_NOTE, meeting: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    rejects(T, { ...MEETING_NOTE, date: "Thursday" });
    rejects(T, { ...MEETING_NOTE, forgottenAt: "2026-11-12" });
    rejects(T, {
      ...MEETING_NOTE,
      items: Array.from({ length: TOOL_LIST_MAX.noteItems + 1 }, (_, i) => item(i)),
    });
    rejects(T, { ...MEETING_NOTE, items: [{ ...item(1), kind: "todo" }] });
    rejects(T, { ...MEETING_NOTE, items: [{ ...item(1), status: "done" }] });
    rejects(T, { ...MEETING_NOTE, items: [{ ...item(1), due: "Friday" }] });
    rejects(T, { ...MEETING_NOTE, items: [{ ...item(1), quote: "x".repeat(201) }] });
    rejects(T, {
      ...MEETING_NOTE,
      items: [{ ...item(1), detail: "x".repeat(TOOL_TEXT_MAX.text + 1) }],
    });
  });

  it("refuse a note too big for one row, on both transports", async () => {
    // The pasted notes and 50 items at their caps in 3-byte text stay under
    // the limit, so each item also lists where it was sent: sentTo has no
    // cap of its own.
    const items = Array.from({ length: TOOL_LIST_MAX.noteItems }, (_, i) => ({
      ...item(i),
      text: wide(TOOL_TEXT_MAX.short),
      detail: wide(TOOL_TEXT_MAX.text),
      owner: wide(TOOL_TEXT_MAX.short),
      quote: wide(TOOL_TEXT_MAX.short),
    }));
    const full = { ...MEETING_NOTE, text: wide(TOOL_TEXT_MAX.paste), items };
    accepts(T, full);
    const sent = items.map((i) => ({ ...i, sentTo: links(80, "retro-action") }));
    const big = { ...full, items: sent };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(
      ENTITY_ROW_MAX_BYTES
    );
    await expect(create(T, { ...big, id: undefined })).rejects.toThrow(
      /This meeting note is too big to save\. Shorten or remove some lines\. Nothing was saved\./
    );
    await expect(create(T, { ...big, id: undefined }, true)).rejects.toThrow(/too big to save/);
    await expect(update(T, "meetingNotes", MEETING_NOTE, { items: sent })).rejects.toThrow(
      /too big to save/
    );
    expect(useWorkspaceStore.getState().meetingNotes).toEqual([MEETING_NOTE]);
    await expect(updateOverMcp(T, MEETING_NOTE, { items: sent })).rejects.toThrow(
      /too big to save/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });
});

describe("the sectioned kit's schema factory", () => {
  const schema = sectionsSchema({
    itemMax: 20,
    itemExtra: { likelihood: z.number().int().min(1).max(5).optional() },
    sectionsMax: 3,
    perSectionMax: 2,
    totalMax: 4,
  });
  const item = (id: string, extra = {}) => ({ id, text: "line", ...extra });
  const ok = (v: unknown) => expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(true);
  const no = (v: unknown) => expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(false);

  it("keys sections by the kit's section id rule", () => {
    expect(SECTION_KEY_PATTERN.source).toBe("^[a-z][a-z0-9-]{0,31}$");
    ok({ goal: [item("a")], "open-questions": [item("b")] });
    for (const key of ["Goal", "1goal", "-goal", "goal_x", "", "g".repeat(33)]) {
      no({ [key]: [item("a")] });
    }
    ok({ ["g".repeat(32)]: [item("a")] });
  });

  it("caps an item id at the kit's SECTION_ITEM_ID_MAX, so every cleaned document passes", () => {
    ok({ goal: [item("i".repeat(SECTION_ITEM_ID_MAX))] });
    no({ goal: [item("i".repeat(SECTION_ITEM_ID_MAX + 1))] });
  });

  it("keeps every item field, the tool's own extras included", () => {
    const sections = {
      goal: [
        {
          id: "a",
          text: "line",
          owner: "Ana",
          sentTo: [{ route: "risk", targetId: "r1", at: NOW }],
          likelihood: 3,
        },
      ],
    };
    expect(schema.parse(sections)).toEqual(sections);
  });

  it("caps the text, the owner, the extras, each section, the sections and the total", () => {
    no({ goal: [item("a", { text: "x".repeat(21) })] });
    no({ goal: [item("a", { owner: "x".repeat(TOOL_TEXT_MAX.short + 1) })] });
    no({ goal: [item("a", { likelihood: 6 })] });
    no({ goal: [item("")] });
    no({ goal: [item("a"), item("b"), item("c")] });
    no({ a: [], b: [], c: [], d: [] });
    no({ a: [item("1"), item("2")], b: [item("3"), item("4")], c: [item("5")] });
    ok({ a: [item("1"), item("2")], b: [item("3"), item("4")], c: [] });
  });

  it("defaults to the kit's caps", () => {
    const plain = sectionsSchema({ itemMax: 10 });
    const many = Object.fromEntries(
      Array.from({ length: TOOL_LIST_MAX.sections + 1 }, (_, i) => [`s${i}`, []])
    );
    expect(plain.safeParse(many).success).toBe(false);
    expect(
      plain.safeParse({
        s: Array.from({ length: TOOL_LIST_MAX.sectionItems + 1 }, (_, i) => item(`i${i}`)),
      }).success
    ).toBe(false);
    expect(
      plain.safeParse({
        s: Array.from({ length: TOOL_LIST_MAX.sectionItems }, (_, i) => item(`i${i}`)),
      }).success
    ).toBe(true);
  });
});

describe("P2.3 product canvases", () => {
  const T = "workspace.product_canvas";
  const item = (i: number) => ({ id: `i${i}`, text: "line" });

  it("mint pcanvas_ ids", async () => {
    const { id } = (await create(T, { ...PRODUCT_CANVAS, id: undefined })) as { id: string };
    expect(id).toMatch(/^pcanvas_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...PRODUCT_CANVAS, format: "lean-canvas" });
    rejects(T, { ...PRODUCT_CANVAS, title: "" });
    rejects(T, { ...PRODUCT_CANVAS, sections: { Problem: [item(1)] } });
    rejects(T, {
      ...PRODUCT_CANVAS,
      sections: { problem: [{ ...item(1), text: "x".repeat(TOOL_TEXT_MAX.text + 1) }] },
    });
    accepts(T, {
      ...PRODUCT_CANVAS,
      sections: { problem: [{ ...item(1), text: "x".repeat(TOOL_TEXT_MAX.text) }] },
    });
    rejects(T, { ...PRODUCT_CANVAS, sections: { problem: [{ ...item(1), evidence: "hunch" }] } });
    rejects(T, {
      ...PRODUCT_CANVAS,
      sections: {
        problem: [
          {
            ...item(1),
            links: Array.from({ length: TOOL_LIST_MAX.itemLinks + 1 }, (_, i) => `l${i}`),
          },
        ],
      },
    });
    rejects(T, {
      ...PRODUCT_CANVAS,
      sections: { problem: [{ ...item(1), links: ["x".repeat(41)] }] },
    });
    // canvasItems over all sections, though each section is within its own cap.
    const half = Array.from({ length: TOOL_LIST_MAX.canvasItems / 2 }, (_, i) => item(i));
    accepts(T, { ...PRODUCT_CANVAS, sections: { a: half, b: half } });
    rejects(T, { ...PRODUCT_CANVAS, sections: { a: half, b: half, c: [item(99)] } });
    for (const appetiteWeeks of [0, 13, 2.5]) rejects(T, { ...PRODUCT_CANVAS, appetiteWeeks });
    rejects(T, { ...PRODUCT_IDEA, intake: { ...PRODUCT_IDEA.intake, demand: 0 } });
    rejects(T, { ...PRODUCT_IDEA, intake: { ...PRODUCT_IDEA.intake, demand: 10000 } });
    rejects(T, { ...PRODUCT_IDEA, intake: { ...PRODUCT_IDEA.intake, source: "press" } });
    rejects(T, {
      ...PRODUCT_IDEA,
      intake: {
        ...PRODUCT_IDEA.intake,
        requesters: Array.from({ length: TOOL_LIST_MAX.requesters + 1 }, (_, i) => `r${i}`),
      },
    });
    rejects(T, { ...PRODUCT_CASE, decision: { verdict: "maybe" } });
    rejects(T, { ...PRODUCT_CANVAS, bet: { ...PRODUCT_CANVAS.bet, cycle: 61 } });
    rejects(T, { ...PRODUCT_CANVAS, bet: { ...PRODUCT_CANVAS.bet, weeks: 13 } });
    rejects(T, { ...PRODUCT_CANVAS, bet: { ...PRODUCT_CANVAS.bet, start: "December" } });
    rejects(T, { ...PRODUCT_CANVAS, bet: { ...PRODUCT_CANVAS.bet, status: "won" } });
  });

  it("refuse a canvas too big for one row, on both transports", async () => {
    // 60 items with text and detail at the CRUD's caps: in 3-byte text a
    // canvas stays just under the limit, so the details are text that
    // JSON-escapes to 6 bytes a character.
    const items = Array.from({ length: TOOL_LIST_MAX.canvasItems }, (_, i) => ({
      id: `i${i}`,
      text: wide(TOOL_TEXT_MAX.text),
      detail: escaped(TOOL_TEXT_MAX.text),
    }));
    const sections = { a: items.slice(0, 30), b: items.slice(30) };
    const big: ProductCanvas = { ...PRODUCT_CANVAS, sections };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(
      ENTITY_ROW_MAX_BYTES
    );
    await expect(create(T, { ...big, id: undefined })).rejects.toThrow(
      /This product canvas is too big to save/
    );
    await expect(create(T, { ...big, id: undefined }, true)).rejects.toThrow(/too big to save/);
    await expect(updateOverMcp(T, PRODUCT_CANVAS, { sections })).rejects.toThrow(/too big to save/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("refuse a write the page would drop on its next save, on both transports", async () => {
    // productCanvasWriteProblems (lib/product-canvas/model): the format's own boxes and fields.
    const vision = {
      id: "pcanvas_vb",
      format: "vision-board",
      title: "Tapline",
      sections: { who: [{ id: "w1", text: "Stall holders", evidence: "fact" }] },
      createdAt: NOW,
      updatedAt: NOW,
    } as ProductCanvas;
    for (const mcp of [false, true]) {
      await expect(create(T, { ...vision, id: undefined }, mcp)).resolves.toBeDefined();
      await expect(
        create(T, { ...vision, id: undefined, sections: { nope: [item(1)] } }, mcp)
      ).rejects.toThrow('A Vision Board has no box called "nope". Nothing was saved.');
      await expect(
        create(T, { ...vision, id: undefined, bet: { status: "bet" } }, mcp)
      ).rejects.toThrow(/A Vision Board has no bet/);
      await expect(
        create(T, { ...vision, id: undefined, sections: { vision: [item(1), item(2)] } }, mcp)
      ).rejects.toThrow(/holds one answer/);
    }
    await expect(updateOverMcp(T, vision, { format: "pr-faq" })).rejects.toThrow(
      /keeps its format/
    );
    // P2.3b's formats are checked too: each fixture passes, another format's field doesn't.
    for (const row of [PRODUCT_CANVAS, PRODUCT_IDEA, PRODUCT_CASE]) {
      await expect(create(T, { ...row, id: undefined }, true)).resolves.toBeDefined();
    }
    await expect(
      create(T, { ...PRODUCT_CANVAS, id: undefined, intake: PRODUCT_IDEA.intake }, true)
    ).rejects.toThrow(/A Shape Up pitch has no intake/);
  });
});

describe("P2.4 strategy maps", () => {
  const T = "workspace.strategy_map";
  const node = (id: string, parentId: string | null, level: number, extra = {}) => ({
    id,
    parentId,
    level,
    text: id,
    ...extra,
  });

  it("mint strategyMap_ ids, and keep a strategy tree's every field", async () => {
    const { id } = (await create(T, { ...IMPACT_MAP, id: undefined })) as { id: string };
    expect(id).toMatch(/^strategyMap_/);
    const parsed = parseCreate(T, STRATEGY_TREE);
    expect((parsed.data as { entity: Doc }).entity).toEqual(STRATEGY_TREE);
    const stored = await update(T, "strategyMaps", STRATEGY_TREE);
    expect(unstamped(stored!)).toEqual(unstamped(STRATEGY_TREE));
  });

  it("hold every cap and set", () => {
    rejects(T, { ...IMPACT_MAP, format: "okr-tree" });
    rejects(T, { ...IMPACT_MAP, title: "" });
    rejects(T, { ...IMPACT_MAP, targetDate: "March" });
    rejects(T, { ...IMPACT_MAP, productGoalId: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    const chain = [node("g", null, 0)];
    accepts(T, { ...IMPACT_MAP, nodes: chain });
    rejects(T, {
      ...IMPACT_MAP,
      nodes: [
        node("g", null, 0),
        ...Array.from({ length: TOOL_LIST_MAX.strategyNodes }, (_, i) => node(`n${i}`, "g", 1)),
      ],
    });
    rejects(T, { ...IMPACT_MAP, nodes: [node("g", null, 0, { text: " " })] });
    rejects(T, { ...IMPACT_MAP, nodes: [node("g", null, 4)] });
    rejects(T, { ...IMPACT_MAP, nodes: [node("g", null, 0.5)] });
    rejects(T, { ...STRATEGY_TREE, nodes: [node("g", null, 0, { status: "maybe" })] });
    rejects(T, {
      ...STRATEGY_TREE,
      nodes: [node("g", null, 0, { detail: "x".repeat(TOOL_TEXT_MAX.text + 1) })],
    });
    rejects(T, {
      ...STRATEGY_TREE,
      nodes: [node("g", null, 0, { measure: "x".repeat(TOOL_TEXT_MAX.short + 1) })],
    });
  });

  it("refuse a map that breaks the tree rules, on both transports", async () => {
    const twoRoots = { nodes: [node("g", null, 0), node("h", null, 0)] };
    await expect(create(T, { ...IMPACT_MAP, id: undefined, ...twoRoots })).rejects.toThrow(
      /one root.*Nothing was saved\./
    );
    await expect(create(T, { ...IMPACT_MAP, id: undefined, ...twoRoots }, true)).rejects.toThrow(
      /one root/
    );
    const skipped = { nodes: [node("g", null, 0), node("d", "g", 2)] };
    await expect(update(T, "strategyMaps", IMPACT_MAP, skipped)).rejects.toThrow(
      /one level below its parent/
    );
    expect(useWorkspaceStore.getState().strategyMaps).toEqual([IMPACT_MAP]);
    await expect(updateOverMcp(T, IMPACT_MAP, skipped)).rejects.toThrow(
      /one level below its parent/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("keep the format a map was made with, on both transports", async () => {
    const change = { format: "dibb", nodes: [node("g", null, 0)] };
    await expect(update(T, "strategyMaps", IMPACT_MAP, change)).rejects.toThrow(
      /Make a new map instead/
    );
    await expect(updateOverMcp(T, IMPACT_MAP, change)).rejects.toThrow(/Make a new map instead/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("keep an impact map's own fields on an impact map", async () => {
    await expect(
      create(T, { ...STRATEGY_TREE, id: undefined, nodes: [node("g", null, 0, { focus: true })] })
    ).rejects.toThrow(/focus/);
    await expect(
      create(T, { ...IMPACT_MAP, id: undefined, nodes: [node("g", null, 0, { note: "n" })] })
    ).rejects.toThrow(/no status or note/);
  });

  it("refuse a map too big for one row, on both transports", async () => {
    // A strategy tree of 150 nodes, one root and the rest under it, with
    // every text field at its cap in 3-byte text: a valid tree, so only its
    // size refuses it.
    const full = (id: string, parentId: string | null, level: number) =>
      node(id, parentId, level, {
        text: wide(TOOL_TEXT_MAX.short),
        detail: wide(TOOL_TEXT_MAX.text),
        measure: wide(TOOL_TEXT_MAX.short),
        owner: wide(TOOL_TEXT_MAX.short),
        note: wide(TOOL_TEXT_MAX.text),
      });
    const nodes = [
      full("v", null, 0),
      ...Array.from({ length: TOOL_LIST_MAX.strategyNodes - 1 }, (_, i) => full(`n${i}`, "v", 1)),
    ];
    const big = { ...STRATEGY_TREE, nodes };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(
      ENTITY_ROW_MAX_BYTES
    );
    await expect(create(T, { ...big, id: undefined })).rejects.toThrow(
      /This strategy map is too big to save\. Shorten or remove some lines\. Nothing was saved\./
    );
    await expect(create(T, { ...big, id: undefined }, true)).rejects.toThrow(/too big to save/);
    await expect(update(T, "strategyMaps", STRATEGY_TREE, { nodes })).rejects.toThrow(
      /too big to save/
    );
    expect(useWorkspaceStore.getState().strategyMaps).toEqual([STRATEGY_TREE]);
    await expect(updateOverMcp(T, STRATEGY_TREE, { nodes })).rejects.toThrow(/too big to save/);
    expect(upsertEntity).not.toHaveBeenCalled();
    // A third of them fits.
    accepts(T, { ...big, nodes: nodes.slice(0, 50) });
  });
});

describe("P2.4 personas", () => {
  const T = "workspace.persona";

  it("mint persona_ ids", async () => {
    const { id } = (await create(T, { ...PERSONA, id: undefined })) as { id: string };
    expect(id).toMatch(/^persona_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...PERSONA, name: "" });
    rejects(T, { ...PERSONA, role: " " });
    rejects(T, { ...PERSONA, tier: "main" });
    rejects(T, { ...PERSONA, evidence: "lots" });
    for (const key of ["goals", "pains", "behaviours"]) {
      rejects(T, {
        ...PERSONA,
        [key]: Array.from({ length: TOOL_LIST_MAX.personaPoints + 1 }, (_, i) => `p${i}`),
      });
      rejects(T, { ...PERSONA, [key]: ["x".repeat(TOOL_TEXT_MAX.short + 1)] });
    }
    rejects(T, {
      ...PERSONA,
      tags: Array.from({ length: TOOL_LIST_MAX.tags + 1 }, (_, i) => `t${i}`),
    });
    rejects(T, {
      ...PERSONA,
      interviewIds: Array.from({ length: TOOL_LIST_MAX.personaInterviews + 1 }, (_, i) => `i${i}`),
    });
    rejects(T, { ...PERSONA, quote: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    rejects(T, { ...PERSONA, context: "x".repeat(TOOL_TEXT_MAX.text + 1) });
  });
});

describe("P2.4 epics", () => {
  it("take only the three horizons", () => {
    const [epic] = ROADMAP_WITH_HORIZON.epics;
    rejects("workspace.epic_roadmap", {
      ...ROADMAP_WITH_HORIZON,
      epics: [{ ...epic, horizon: "someday" }],
    });
  });
});

describe("P2.5 product metrics", () => {
  const T = "workspace.product_metric";
  const metric = (id: string, extra = {}) => ({
    id,
    name: id,
    direction: "increase",
    readings: [],
    ...extra,
  });
  const seed = (...rows: Doc[]) => {
    useWorkspaceStore.setState({ productMetrics: rows as never });
    listEntities.mockResolvedValue(rows);
  };

  it("mint metric_ ids", async () => {
    const { id } = (await create(T, metric("m", { id: undefined }))) as { id: string };
    expect(id).toMatch(/^metric_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...PRODUCT_METRIC, name: "" });
    rejects(T, { ...PRODUCT_METRIC, unit: "x".repeat(41) });
    rejects(T, { ...PRODUCT_METRIC, direction: "up" });
    rejects(T, { ...PRODUCT_METRIC, role: "output" });
    rejects(T, { ...PRODUCT_METRIC, aarrr: "awareness" });
    rejects(T, { ...PRODUCT_METRIC, kva: "value" });
    rejects(T, { ...PRODUCT_METRIC, source: "velocity" });
    rejects(T, { ...PRODUCT_METRIC, heart: { category: "joy", feature: "f" } });
    rejects(T, { ...PRODUCT_METRIC, heart: { category: "adoption", feature: " " } });
    rejects(T, { ...PRODUCT_METRIC, baseline: Number.POSITIVE_INFINITY });
    rejects(T, {
      ...PRODUCT_METRIC,
      readings: Array.from({ length: 53 }, (_, i) => ({
        id: `r${i}`,
        date: "2026-01-01",
        value: i,
      })),
    });
    for (const date of ["2026-02-30", "2026-13-01", "Monday"]) {
      rejects(T, { ...PRODUCT_METRIC, readings: [{ id: "r", date, value: 1 }] });
    }
  });

  it("keep readings oldest first, one per day, the later one winning", async () => {
    const { id } = (await create(
      T,
      metric("m", {
        id: undefined,
        readings: [
          { id: "r2", date: "2026-11-09", value: 2 },
          { id: "r1", date: "2026-11-02", value: 1 },
          { id: "r3", date: "2026-11-09", value: 3 },
        ],
      })
    )) as { id: string };
    const stored = useWorkspaceStore.getState().productMetrics!.find((m) => m.id === id)!;
    expect(stored.readings.map((r) => [r.date, r.value])).toEqual([
      ["2026-11-02", 1],
      ["2026-11-09", 3],
    ]);
  });

  it("refuse a second North Star, in the tab and over MCP", async () => {
    seed(metric("m1", { role: "north-star" }));
    await expect(create(T, metric("m2", { role: "north-star" }))).rejects.toThrow(
      /Another metric is the North Star.*Nothing was saved\./
    );
    await expect(create(T, metric("m2", { role: "north-star" }), true)).rejects.toThrow(
      /there is one North Star/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
    // The North Star itself can be edited.
    const kept = await update(T, "productMetrics", metric("m1", { role: "north-star" }), {
      name: "Renamed",
    });
    expect((kept as unknown as { name: string }).name).toBe("Renamed");
  });

  it("refuse a sixth input, a second metric on a stage and on a HEART goal", async () => {
    seed(
      ...Array.from({ length: 5 }, (_, i) => metric(`in${i}`, { role: "input" })),
      metric("stage", { aarrr: "activation" }),
      metric("heart", { heart: { category: "adoption", feature: "Refunds" } })
    );
    await expect(create(T, metric("in5", { role: "input" }))).rejects.toThrow(
      /already has 5 inputs/
    );
    await expect(create(T, metric("s2", { aarrr: "activation" }), true)).rejects.toThrow(
      /one metric per funnel stage/
    );
    await expect(
      create(T, metric("h2", { heart: { category: "adoption", feature: "  refunds " } }))
    ).rejects.toThrow(/one metric per HEART feature and category/);
    // Another category on the same feature is fine.
    await create(T, metric("h3", { heart: { category: "retention", feature: "Refunds" } }));
  });

  it("refuse a 61st metric", async () => {
    seed(...Array.from({ length: TOOL_LIST_MAX.productMetrics }, (_, i) => metric(`m${i}`)));
    await expect(create(T, metric("one-more"))).rejects.toThrow(/the most the tool keeps/);
    await expect(create(T, metric("one-more"), true)).rejects.toThrow(/the most the tool keeps/);
  });

  it("refuse an EBM source from another area or against its direction, in the tab and over MCP", async () => {
    seed();
    await expect(
      create(
        T,
        metric("cycle", {
          direction: "increase",
          kva: "time-to-market",
          source: "cycle-time-median",
        })
      )
    ).rejects.toThrow(/“Lower is better” number/);
    await expect(
      create(
        T,
        metric("nps", { direction: "increase", kva: "unrealized-value", source: "nps-90d" }),
        true
      )
    ).rejects.toThrow(/is a Current Value number, not Unrealized Value/);
    expect(upsertEntity).not.toHaveBeenCalled();
    await create(
      T,
      metric("cycle", { direction: "decrease", kva: "time-to-market", source: "cycle-time-median" })
    );
    // A source on a metric that isn't an EBM measure isn't checked against an area.
    await create(T, metric("plain", { direction: "increase", source: "cycle-time-median" }));
  });

  it("count the example's rows apart from real ones", async () => {
    seed(metric("example-m1", { role: "north-star" }), metric("example-m2", { aarrr: "revenue" }));
    await create(T, metric("m1", { role: "north-star", aarrr: "revenue" }));
    await expect(create(T, metric("example-m3", { role: "north-star" }))).rejects.toThrow(
      /North Star/
    );
  });
});

describe("P2.5 A/B tests", () => {
  const T = "workspace.ab_test";
  const variant = (id: string, visitors: number, conversions: number) => ({
    id,
    name: id,
    visitors,
    conversions,
  });

  it("mint abtest_ ids", async () => {
    const { id } = (await create(T, { ...AB_TEST, id: undefined })) as { id: string };
    expect(id).toMatch(/^abtest_/);
  });

  it("take exactly two versions, whole counts, conversions at most visitors", async () => {
    rejects(T, { ...AB_TEST, variants: [variant("a", 10, 1)] });
    rejects(T, {
      ...AB_TEST,
      variants: [variant("a", 10, 1), variant("b", 10, 1), variant("c", 10, 1)],
    });
    rejects(T, { ...AB_TEST, variants: [variant("a", 10.5, 1), variant("b", 10, 1)] });
    rejects(T, { ...AB_TEST, variants: [variant("a", 10, -1), variant("b", 10, 1)] });
    rejects(T, { ...AB_TEST, variants: [variant("a", 10, 11), variant("b", 10, 1)] });
    accepts(T, { ...AB_TEST, variants: [variant("a", 10, 10), variant("b", 0, 0)] });
    const over = { variants: [variant("a", 10, 11), variant("b", 10, 1)] };
    await expect(update(T, "abTests", AB_TEST, over)).rejects.toThrow(/at most visitors/);
    await expect(updateOverMcp(T, AB_TEST, over)).rejects.toThrow(/at most visitors/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("keep the plan's fractions in range", () => {
    const plan = (p: object) => ({ ...AB_TEST, plan: { ...AB_TEST.plan, ...p } });
    rejects(T, plan({ baseline: 1.2 }));
    rejects(T, plan({ baseline: -0.1 }));
    rejects(T, plan({ mde: 0 }));
    rejects(T, plan({ mdeMode: "absolute", mde: 1.5 }));
    accepts(T, plan({ mdeMode: "relative", mde: 1.5 }));
    rejects(T, plan({ confidence: 0.8 }));
    rejects(T, plan({ power: 0.95 }));
    rejects(T, plan({ sided: "both" }));
    rejects(T, plan({ dailyTraffic: 0 }));
  });

  it("hold every cap and set", () => {
    rejects(T, { ...AB_TEST, name: "" });
    rejects(T, { ...AB_TEST, status: "paused" });
    rejects(T, { ...AB_TEST, decision: "maybe" });
    rejects(T, { ...AB_TEST, startedOn: "October" });
    rejects(T, {
      ...AB_TEST,
      guardrails: Array.from({ length: TOOL_LIST_MAX.abGuardrails + 1 }, (_, i) => ({
        name: `g${i}`,
      })),
    });
  });
});

describe("P2.5 the EBM board", () => {
  const T = "workspace.ebm_board";

  it("is one document: create needs its id, and a second is refused", async () => {
    rejects(T, { ...EBM_BOARD, id: "ebmBoard_other" });
    rejects(T, { ...EBM_BOARD, id: undefined });
    await create(T, EBM_BOARD);
    await expect(create(T, EBM_BOARD)).rejects.toThrow();
  });

  it("hold every cap and range", () => {
    const review = EBM_BOARD.reviews[0];
    rejects(T, {
      ...EBM_BOARD,
      reviews: Array.from({ length: TOOL_LIST_MAX.ebmReviews + 1 }, (_, i) => ({
        ...review,
        id: `r${i}`,
      })),
    });
    rejects(T, { ...EBM_BOARD, reviews: [{ ...review, focus: "speed" }] });
    rejects(T, { ...EBM_BOARD, reviews: [{ ...review, areas: { "current-value": 1.5 } }] });
    rejects(T, { ...EBM_BOARD, reviews: [{ ...review, date: "Q3" }] });
    rejects(T, { ...EBM_BOARD, strategicWhy: "x".repeat(TOOL_TEXT_MAX.text + 1) });
  });
});

describe("P2.5 a hypothesis's value check", () => {
  const T = "workspace.hypothesis_tracker";
  const [hypothesis] = TRACKER_WITH_VALUE_CHECK.hypotheses;
  const withMeasure = (measuredBy: object) => ({
    ...TRACKER_WITH_VALUE_CHECK,
    hypotheses: [{ ...hypothesis, measuredBy }],
  });

  it("names what each way of measuring needs", () => {
    rejects(T, withMeasure({ kind: "metric" }));
    rejects(T, withMeasure({ kind: "key-result", okrId: "okr_1" }));
    rejects(T, withMeasure({ kind: "words", note: " " }));
    rejects(T, withMeasure({ kind: "gut" }));
    accepts(T, withMeasure({ kind: "key-result", okrId: "okr_1", keyResultId: "kr_1" }));
    accepts(T, withMeasure({ kind: "words", note: "Ask five shops." }));
    rejects(T, withMeasure({ kind: "words", note: "x".repeat(201) }));
  });

  it("caps the shipped item and takes the check day as a day", () => {
    const withShipped = (shipped: object) => ({
      ...TRACKER_WITH_VALUE_CHECK,
      hypotheses: [{ ...hypothesis, shipped }],
    });
    rejects(T, withShipped({ ...hypothesis.shipped, kind: "release" }));
    rejects(T, withShipped({ ...hypothesis.shipped, title: "x".repeat(201) }));
    rejects(T, {
      ...TRACKER_WITH_VALUE_CHECK,
      hypotheses: [{ ...hypothesis, checkOn: "next month" }],
    });
  });
});

describe("P2.6 the workflow definition and the flow fields", () => {
  const T = "workspace.workflow_definition";

  it("is one document: create needs its id", async () => {
    rejects(T, { ...WORKFLOW_DEFINITION, id: "workflow_other" });
    await create(T, WORKFLOW_DEFINITION);
    await expect(create(T, WORKFLOW_DEFINITION)).rejects.toThrow();
  });

  it("hold every cap and set", () => {
    const wd = WORKFLOW_DEFINITION;
    rejects(T, { ...wd, board: "wall" });
    rejects(T, { ...wd, workItem: "x".repeat(TOOL_TEXT_MAX.short + 1) });
    rejects(T, { ...wd, workTypes: [...wd.workTypes!, { type: "feature" }] });
    rejects(T, { ...wd, workTypes: [{ type: "chore" }] });
    rejects(T, { ...wd, workTypes: [{ type: "feature", targetPct: 101 }] });
    rejects(T, { ...wd, workTypes: [{ type: "feature", targetPct: 33.3 }] });
    rejects(T, {
      ...wd,
      policies: Array.from({ length: 7 }, (_, i) => ({ stage: `s${i}` })),
    });
    rejects(T, { ...wd, policies: [{ stage: "x".repeat(21) }] });
    rejects(T, { ...wd, classPolicies: [{ class: "urgent", policy: "p" }] });
    rejects(T, { ...wd, sle: { days: 0, pct: 85 } });
    rejects(T, { ...wd, sle: { days: 366, pct: 85 } });
    rejects(T, { ...wd, sle: { days: 10, pct: 80 } });
    rejects(T, { ...wd, statik: { inside: "x".repeat(TOOL_TEXT_MAX.text + 1) } });
    rejects(T, {
      ...wd,
      cadences: Array.from({ length: TOOL_LIST_MAX.kanbanCadences + 1 }, (_, i) => ({
        id: `c${i}`,
        name: "c",
        cadence: "weekly",
      })),
    });
    rejects(T, { ...wd, cadences: [{ id: "c", name: "c", cadence: "hourly" }] });
    rejects(T, { ...wd, cadences: [{ id: "c", name: "c", cadence: "weekly", minutes: 4 }] });
    const version = wd.versions![0];
    rejects(T, {
      ...wd,
      versions: Array.from({ length: TOOL_LIST_MAX.workflowVersions + 1 }, (_, i) => ({
        ...version,
        version: i + 1,
      })),
    });
    rejects(T, { ...wd, versions: [{ ...version, version: 0 }] });
    rejects(T, {
      ...wd,
      versions: [{ ...version, snapshot: { ...version.snapshot, wipLimits: { doing: 3 } } }],
    });
  });

  it("a story keeps its work type, demand and blocked spells, capped", async () => {
    const parsed = parseCreate("workspace.story", STORY_WITH_FLOW);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const stored = (await update("workspace.story", "stories", STORY_WITH_FLOW, {
      title: "Fix the refund button on Android",
    })) as typeof STORY_WITH_FLOW;
    expect(stored.workType).toBe("defect");
    expect(stored.demand).toBe("failure");
    expect(stored.blockLog).toEqual(STORY_WITH_FLOW.blockLog);
    const spell = STORY_WITH_FLOW.blockLog![0];
    const withLog = (blockLog: unknown) => ({ ...STORY_WITH_FLOW, blockLog });
    rejects("workspace.story", { ...STORY_WITH_FLOW, workType: "chore" });
    rejects("workspace.story", { ...STORY_WITH_FLOW, demand: "both" });
    rejects(
      "workspace.story",
      withLog(Array.from({ length: TOOL_LIST_MAX.blockLog + 1 }, () => ({ from: NOW })))
    );
    rejects("workspace.story", withLog([{ ...spell, cause: "x".repeat(TOOL_TEXT_MAX.short + 1) }]));
    rejects("workspace.story", withLog([{ ...spell, cluster: "x".repeat(61) }]));
    rejects("workspace.story", withLog([{ ...spell, side: "both" }]));
    rejects("workspace.story", withLog([{ ...spell, earlier: false }]));
    // One link per route, as cleanBlockLog keeps them: two routes are fine,
    // two links on one route are not.
    expect(
      parseCreate(
        "workspace.story",
        withLog([{ ...spell, sentTo: [spell.sentTo![0], { ...spell.sentTo![0], route: "risk" }] }])
      ).success
    ).toBe(true);
    rejects(
      "workspace.story",
      withLog([{ ...spell, sentTo: [spell.sentTo![0], { ...spell.sentTo![0], targetId: "i2" }] }])
    );
  });

  it("an impediment's cluster is capped and its side is inside or outside", () => {
    rejects("workspace.impediment", { ...IMPEDIMENT_IN_CLUSTER, cluster: "x".repeat(61) });
    rejects("workspace.impediment", { ...IMPEDIMENT_IN_CLUSTER, blockSide: "both" });
  });

  describe("a Kanban board's cards", () => {
    const K = "workspace.kanban_board";
    const LIMITS = { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 };
    const EARLIER = "2026-11-10T08:00:00.000Z";
    type Board = Doc & { cards: Record<string, unknown>[]; wipLimits: typeof LIMITS };
    const card = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      title: `Card ${id}`,
      column: "in_progress",
      class: "standard",
      createdAt: "2026-11-01",
      ...extra,
    });
    const board = (cards: Record<string, unknown>[]): Board => ({
      id: "kanban:current",
      cards,
      wipLimits: LIMITS,
    });
    const written = () => upsertEntity.mock.calls.at(-1)?.[2] as Board | undefined;

    it("are cleaned and capped, and a card created blocked opens a spell, over MCP", async () => {
      await create(
        K,
        {
          cards: [
            card("a", { blocked: true }),
            card("b", {
              workType: "chore",
              demand: "both",
              blockLog: [
                "not a spell",
                { from: "not a time" },
                { from: EARLIER, to: "2026-11-01T00:00:00.000Z", side: "both", extra: 1 },
                ...Array.from({ length: TOOL_LIST_MAX.blockLog }, () => ({
                  from: EARLIER,
                  to: NOW,
                })),
              ],
            }),
            card("c", { workType: "debt", demand: "value" }),
          ],
          wipLimits: LIMITS,
        },
        true
      );
      const [a, b, c] = written()!.cards;
      expect(a.blockLog).toEqual([{ from: NOW }]);
      expect(b).not.toHaveProperty("workType");
      expect(b).not.toHaveProperty("demand");
      expect(b.blockLog).toHaveLength(TOOL_LIST_MAX.blockLog);
      expect((b.blockLog as unknown[]).every((s) => JSON.stringify(s).includes(EARLIER))).toBe(
        true
      );
      expect(c).toMatchObject({ workType: "debt", demand: "value" });
      expect(c).not.toHaveProperty("blockLog");
    });

    it("close the open spell when the flag comes off, over MCP", async () => {
      const stored = board([card("a", { blocked: true, blockLog: [{ from: EARLIER }] })]);
      const next = (await updateOverMcp(K, stored, {
        cards: [card("a", { blockLog: [{ from: EARLIER }] })],
      })) as Board;
      expect(next.cards[0].blockLog).toEqual([{ from: EARLIER, to: NOW }]);
    });

    it("open one spell in the tab: the store keeps the log the CRUD wrote", async () => {
      const stored = (await update(K, "kanbanBoards", board([card("a")]), {
        cards: [card("a", { blocked: true })],
      })) as Board;
      expect(stored.cards[0]).toMatchObject({ blocked: true, blockLog: [{ from: NOW }] });
    });
  });
});

describe("P2.7 improvements", () => {
  const T = "workspace.improvement";
  const open: Improvement = { ...IMPROVEMENT, status: "open", closedAt: undefined };
  const step = (id: string, status: string, extra = {}) => ({ id, text: id, status, ...extra });

  it("mint improve_ ids", async () => {
    const { id } = (await create(T, { ...IMPROVEMENT, id: undefined })) as { id: string };
    expect(id).toMatch(/^improve_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...IMPROVEMENT, title: " " });
    accepts(T, { ...IMPROVEMENT, background: "", target: { text: "" } });
    rejects(T, { ...IMPROVEMENT, method: "pdca" });
    rejects(T, { ...IMPROVEMENT, status: "done" });
    rejects(T, { ...IMPROVEMENT, current: { text: "x", unit: "x".repeat(21) } });
    rejects(T, { ...IMPROVEMENT, current: { text: "x", value: Number.NaN } });
    rejects(T, { ...IMPROVEMENT, current: { text: "x", date: "December" } });
    rejects(T, { ...IMPROVEMENT, rootCauseId: "x".repeat(65) });
    rejects(T, {
      ...IMPROVEMENT,
      pastTargets: [{ text: "t", reachedAt: "2026-11-15" }],
    });
    rejects(T, {
      ...IMPROVEMENT,
      obstacles: Array.from({ length: TOOL_LIST_MAX.kataObstacles + 1 }, (_, i) => ({
        id: `o${i}`,
        text: "o",
        status: "open",
      })),
    });
    rejects(T, {
      ...IMPROVEMENT,
      steps: Array.from({ length: TOOL_LIST_MAX.improveSteps + 1 }, (_, i) =>
        step(`s${i}`, "planned")
      ),
    });
    rejects(T, {
      ...IMPROVEMENT,
      readings: Array.from({ length: TOOL_LIST_MAX.improveReadings + 1 }, (_, i) => ({
        id: `r${i}`,
        date: "2026-11-01",
        value: i,
      })),
    });
    rejects(T, { ...IMPROVEMENT, steps: [step("s", "skipped")] });
    rejects(T, { ...IMPROVEMENT, steps: [step("s", "done", { doneAt: "Tuesday" })] });
    rejects(T, { ...IMPROVEMENT, steps: [step("s", "planned", { due: "soon" })] });
    rejects(T, { ...IMPROVEMENT, nextCoachingAt: "Friday" });
  });

  it("stamp closedAt with the status, and clear it when it is open again", async () => {
    const closed = (await update(T, "improvements", open, { status: "dropped" })) as Improvement;
    expect(closed.closedAt).toBe(NOW);
    const kept = (await update(T, "improvements", IMPROVEMENT, {
      title: "Renamed",
    })) as Improvement;
    expect(kept.closedAt).toBe(IMPROVEMENT.closedAt);
    const reopened = (await update(T, "improvements", IMPROVEMENT, {
      status: "checking",
    })) as Improvement;
    expect(reopened).not.toHaveProperty("closedAt");
  });

  it("stamp a done step's doneAt, and drop it from a step that isn't done", async () => {
    const stored = (await update(T, "improvements", open, {
      steps: [
        step("a", "done"),
        step("b", "running", { doneAt: AT_TIME }),
        step("c", "done", { doneAt: AT_TIME }),
      ],
    })) as Improvement;
    expect(stored.steps.map((s) => s.doneAt)).toEqual([NOW, undefined, AT_TIME]);
    expect(stored.steps[1]).not.toHaveProperty("doneAt");
  });

  it("keep only the first working obstacle working, over MCP too", async () => {
    const obstacles = [
      { id: "o1", text: "a", status: "open" },
      { id: "o2", text: "b", status: "working" },
      { id: "o3", text: "c", status: "working" },
    ];
    const stored = (await update(T, "improvements", open, { obstacles })) as Improvement;
    expect(stored.obstacles.map((o) => o.status)).toEqual(["open", "working", "open"]);
    const written = (await updateOverMcp(T, open, { obstacles })) as Improvement;
    expect(written.obstacles.map((o) => o.status)).toEqual(["open", "working", "open"]);
  });

  it("refuse a change of method, in the tab and over MCP", async () => {
    await expect(update(T, "improvements", IMPROVEMENT, { method: "a3" })).rejects.toThrow(
      "An improvement keeps the method it started with. Nothing was saved."
    );
    expect(useWorkspaceStore.getState().improvements).toEqual([IMPROVEMENT]);
    await expect(updateOverMcp(T, IMPROVEMENT, { method: "a3" })).rejects.toThrow(
      /keeps the method it started with/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("refuse an improvement too big for one row", async () => {
    const steps = Array.from({ length: TOOL_LIST_MAX.improveSteps }, (_, i) =>
      step(`s${i}`, "planned", {
        text: wide(TOOL_TEXT_MAX.text),
        expect: wide(TOOL_TEXT_MAX.text),
        result: wide(TOOL_TEXT_MAX.text),
        learned: wide(TOOL_TEXT_MAX.text),
      })
    );
    await expect(create(T, { ...open, id: undefined, steps })).rejects.toThrow(
      /This improvement is too big to save/
    );
    await expect(updateOverMcp(T, open, { steps })).rejects.toThrow(/too big to save/);
  });
});

describe("P2.7 the causal loop and the card day", () => {
  const T = "workspace.root_cause_analysis";
  const loop = ANALYSIS_WITH_LOOP.loop!;

  it("caps the loop's things, arrows and names", () => {
    const withLoop = (patch: object) => ({ ...ANALYSIS_WITH_LOOP, loop: { ...loop, ...patch } });
    rejects(T, withLoop({ nodes: [{ id: "n", text: " " }] }));
    rejects(T, withLoop({ nodes: [{ id: "n", text: "x".repeat(121) }] }));
    rejects(T, withLoop({ nodes: [{ id: "", text: "n" }] }));
    rejects(
      T,
      withLoop({
        nodes: Array.from({ length: TOOL_LIST_MAX.loopNodes + 1 }, (_, i) => ({
          id: `n${i}`,
          text: "n",
        })),
      })
    );
    rejects(
      T,
      withLoop({
        links: Array.from({ length: TOOL_LIST_MAX.loopLinks + 1 }, (_, i) => ({
          id: `l${i}`,
          from: "n1",
          to: "n2",
          polarity: "same",
        })),
      })
    );
    rejects(T, withLoop({ links: [{ id: "l", from: "n1", to: "n2", polarity: "plus" }] }));
    rejects(T, withLoop({ names: [{ key: "k", name: "x".repeat(81) }] }));
    rejects(T, withLoop({ names: [{ key: "x".repeat(1001), name: "n" }] }));
    rejects(
      T,
      withLoop({
        names: Array.from({ length: TOOL_LIST_MAX.loopNames + 1 }, (_, i) => ({
          key: `k${i}`,
          name: "n",
        })),
      })
    );
  });

  it("keeps a retro card's day on the board", async () => {
    const stored = await update("workspace.retro_board", "retroBoards", RETRO_WITH_DAYS);
    expect(stored).toEqual(RETRO_WITH_DAYS);
    expect(RETRO_CARD_DAY_MAX).toBe(30);
  });
});

describe("P2.8 kickoffs", () => {
  const T = "workspace.kickoff";
  const item = (id: string, extra = {}) => ({ id, text: id, ...extra });

  it("mint kickoff_ ids", async () => {
    const { id } = (await create(T, { ...KICKOFF, id: undefined })) as { id: string };
    expect(id).toMatch(/^kickoff_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...KICKOFF, title: "" });
    rejects(T, { ...KICKOFF, format: "lean-canvas" });
    rejects(T, { ...KICKOFF, status: "done" });
    rejects(T, { ...KICKOFF, brief: "x".repeat(KICKOFF_BRIEF_MAX + 1) });
    rejects(T, { ...KICKOFF, date: "Monday" });
    rejects(T, {
      ...KICKOFF,
      participants: Array.from(
        { length: TOOL_LIST_MAX.kickoffParticipants + 1 },
        (_, i) => `p${i}`
      ),
    });
    rejects(T, {
      ...KICKOFF,
      sections: { goal: [item("a", { text: "x".repeat(KICKOFF_ITEM_MAX + 1) })] },
    });
    accepts(T, {
      ...KICKOFF,
      sections: { goal: [item("a", { text: "x".repeat(KICKOFF_ITEM_MAX) })] },
    });
    rejects(T, { ...KICKOFF, sections: { Goal: [item("a")] } });
    rejects(T, { ...KICKOFF, sections: { worries: [item("a", { likelihood: 6 })] } });
    rejects(T, { ...KICKOFF, sections: { worries: [item("a", { impact: 0 })] } });
    rejects(T, { ...KICKOFF, sections: { worries: [item("a", { likelihood: 2.5 })] } });
    rejects(T, {
      ...KICKOFF,
      sections: {
        goal: Array.from({ length: TOOL_LIST_MAX.sectionItems + 1 }, (_, i) => item(`i${i}`)),
      },
    });
    rejects(T, {
      ...KICKOFF,
      sliders: Array.from({ length: TOOL_LIST_MAX.kickoffSliders + 1 }, (_, i) => ({
        id: `s${i}`,
        label: "l",
        position: i + 1,
      })),
    });
    rejects(T, {
      ...KICKOFF,
      sliders: [{ id: "s", label: "x".repeat(KICKOFF_SLIDER_LABEL_MAX + 1), position: 1 }],
    });
    rejects(T, { ...KICKOFF, sliders: [{ id: "s", label: "l", position: 9 }] });
    rejects(T, { ...KICKOFF, agreedAt: "2026-11-16" });
  });

  it("take an item with no text only when it has an owner, on both transports", async () => {
    rejects(T, { ...KICKOFF, sections: { people: [item("a", { text: " " })] } });
    accepts(T, { ...KICKOFF, sections: { people: [item("a", { text: "", owner: "Ana" })] } });
    const blank = { sections: { people: [item("a", { text: "" })] } };
    await expect(update(T, "kickoffs", KICKOFF, blank)).rejects.toThrow(/text, or an owner/);
    await expect(updateOverMcp(T, KICKOFF, blank)).rejects.toThrow(/text, or an owner/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("give each slider its own position, on both transports", async () => {
    const twice = {
      sliders: [
        { id: "a", label: "Time", position: 1 },
        { id: "b", label: "Scope", position: 1 },
      ],
    };
    rejects(T, { ...KICKOFF, ...twice });
    await expect(update(T, "kickoffs", KICKOFF, twice)).rejects.toThrow(/its own position/);
    await expect(updateOverMcp(T, KICKOFF, twice)).rejects.toThrow(/its own position/);
  });

  it("refuse a kickoff too big for one row", async () => {
    const sections = Object.fromEntries(
      Array.from({ length: TOOL_LIST_MAX.sections }, (_, s) => [
        `s${s}`,
        Array.from({ length: TOOL_LIST_MAX.sectionItems }, (_, i) =>
          item(`i${s}-${i}`, { text: wide(KICKOFF_ITEM_MAX) })
        ),
      ])
    );
    await expect(create(T, { ...KICKOFF, id: undefined, sections })).rejects.toThrow(
      /This kickoff is too big to save/
    );
    await expect(updateOverMcp(T, KICKOFF, { sections })).rejects.toThrow(/too big to save/);
  });

  it("refuse what the kickoff's format doesn't take, on both transports", async () => {
    const offFormat: [Record<string, unknown>, RegExp][] = [
      [
        { sections: { ...KICKOFF.sections, people: [item("p", { owner: "Ana" })] } },
        /“people” isn't a section of the Inception deck format/,
      ],
      [
        { sections: { ...KICKOFF.sections, why: [item("y", { owner: "Ana" })] } },
        /Lines in “why” have no owner/,
      ],
      [
        { sections: { ...KICKOFF.sections, needs: [item("n", { likelihood: 3 })] } },
        /Lines in “needs” aren't rated/,
      ],
      [
        { sections: { ...KICKOFF.sections, "in-scope": [item("s", { covers: "w1" })] } },
        /Lines in “in-scope” can't cover a worry/,
      ],
      [{ format: "team-canvas", sections: {} }, /The Team Canvas format has no trade-off sliders/],
    ];
    for (const [patch, message] of offFormat) {
      await expect(update(T, "kickoffs", KICKOFF, patch)).rejects.toThrow(message);
      await expect(updateOverMcp(T, KICKOFF, patch)).rejects.toThrow(message);
    }
    await expect(create(T, { ...KICKOFF, id: undefined, format: "team-canvas" })).rejects.toThrow(
      /isn't a section of the Team Canvas format.*Nothing was saved/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
    // A cover whose worry is gone (deleted, its Undo still open) is kept.
    const undoing = { sections: { ...KICKOFF.sections, worries: [] } };
    const kept = (await update(T, "kickoffs", KICKOFF, undoing)) as Kickoff | undefined;
    expect(kept?.sections).toEqual(undoing.sections);
  });
});

describe("P2.9 Team Time people", () => {
  const T = "workspace.team_time_person";
  const person = (id: string, extra = {}) => ({
    id,
    name: id,
    timeZone: "UTC",
    start: "09:00",
    end: "17:00",
    workingDays: [1, 2, 3, 4, 5],
    ...extra,
  });

  it("mint ttp_ ids", async () => {
    const { id } = (await create(T, { ...TEAM_TIME_PERSON, id: undefined })) as { id: string };
    expect(id).toMatch(/^ttp_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...TEAM_TIME_PERSON, name: "" });
    rejects(T, { ...TEAM_TIME_PERSON, timeZone: "Mars/Olympus" });
    rejects(T, { ...TEAM_TIME_PERSON, timeZone: "x".repeat(65) });
    accepts(T, { ...TEAM_TIME_PERSON, timeZone: "America/New_York" });
    for (const time of ["9:00", "24:00", "09:60", "nine"]) {
      rejects(T, { ...TEAM_TIME_PERSON, start: time });
    }
    rejects(T, { ...TEAM_TIME_PERSON, workingDays: [] });
    rejects(T, { ...TEAM_TIME_PERSON, workingDays: [7] });
    rejects(T, { ...TEAM_TIME_PERSON, officeDays: [1.5] });
    rejects(T, { ...TEAM_TIME_PERSON, site: "x".repeat(61) });
  });

  it("refuse hours that start and end together, and office days off the working days", async () => {
    await expect(create(T, person("p", { start: "09:00", end: "09:00" }))).rejects.toThrow(
      /start and end at the same time.*Nothing was saved\./
    );
    await expect(
      create(T, person("p", { workingDays: [1, 2], officeDays: [2, 6] }), true)
    ).rejects.toThrow(/Office days 6 aren't working days/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("refuse a second row for the same person, in the tab and over MCP", async () => {
    const ana = person("ttp_ana", { name: "Ana", teamMemberId: "member_ana" });
    useWorkspaceStore.setState({ teamTimePeople: [ana] as never });
    listEntities.mockResolvedValue([ana]);
    await expect(create(T, person("ttp_x", { name: " ana " }))).rejects.toThrow(
      /Ana is already on Team Time \(ttp_ana\)/
    );
    await expect(
      create(T, person("ttp_y", { name: "Anna", teamMemberId: "member_ana" }), true)
    ).rejects.toThrow(/one row per person/);
    // Another member with the same name is someone else.
    await create(T, person("ttp_z", { name: "Ana", teamMemberId: "member_ana2" }));
    // The row itself can be edited.
    await update(T, "teamTimePeople", ana, { note: "Moved to Leeds" });
  });
});

describe("P2.9 Team Time polls", () => {
  const T = "workspace.team_time_poll";

  it("mint ttpoll_ ids", async () => {
    const { id } = (await create(T, { ...TEAM_TIME_POLL, id: undefined })) as { id: string };
    expect(id).toMatch(/^ttpoll_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...TEAM_TIME_POLL, title: "" });
    rejects(T, { ...TEAM_TIME_POLL, minutes: 0 });
    rejects(T, { ...TEAM_TIME_POLL, status: "draft" });
    rejects(T, { ...TEAM_TIME_POLL, slots: [{ id: "s1", start: "Tuesday 3pm" }] });
    rejects(T, {
      ...TEAM_TIME_POLL,
      slots: Array.from({ length: 21 }, (_, i) => ({
        id: `s${i}`,
        start: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
      })),
      chosenSlotId: undefined,
      answers: [],
    });
    rejects(T, { ...TEAM_TIME_POLL, answers: [{ name: "Ana", picks: { s1: "perhaps" } }] });
  });

  it("refuse repeated slots and a choice or pick of a slot it doesn't have, on both transports", async () => {
    const twice = {
      slots: [
        { id: "s1", start: "2026-11-24T14:00:00.000Z" },
        { id: "s2", start: "2026-11-24T16:00:00+02:00" },
      ],
    };
    await expect(update(T, "teamTimePolls", TEAM_TIME_POLL, twice)).rejects.toThrow(
      /repeat a time/
    );
    await expect(updateOverMcp(T, TEAM_TIME_POLL, { chosenSlotId: "s9" })).rejects.toThrow(
      /chosen slot s9 isn't one of the poll's slots/
    );
    await expect(
      update(T, "teamTimePolls", TEAM_TIME_POLL, {
        answers: [{ name: "Ana", picks: { s1: "yes", s7: "no" } }],
      })
    ).rejects.toThrow(/Ana's answer picks slots the poll doesn't have \(s7\)/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });
});

describe("P2.9 Team Time rotations", () => {
  const T = "workspace.team_time_rotation";
  const option = TEAM_TIME_ROTATION.options[0];

  it("mint ttrot_ ids", async () => {
    const { id } = (await create(T, { ...TEAM_TIME_ROTATION, id: undefined })) as { id: string };
    expect(id).toMatch(/^ttrot_/);
  });

  it("hold every cap and set", () => {
    rejects(T, { ...TEAM_TIME_ROTATION, meeting: "" });
    rejects(T, { ...TEAM_TIME_ROTATION, everyWeeks: 5 });
    rejects(T, { ...TEAM_TIME_ROTATION, mode: "random" });
    rejects(T, { ...TEAM_TIME_ROTATION, startDate: "next week" });
    rejects(T, { ...TEAM_TIME_ROTATION, options: [{ ...option, weekday: 7 }] });
    rejects(T, { ...TEAM_TIME_ROTATION, options: [{ ...option, timeZone: "Nowhere/Land" }] });
    rejects(T, {
      ...TEAM_TIME_ROTATION,
      options: Array.from({ length: 5 }, (_, i) => ({ ...option, id: `o${i}` })),
    });
    rejects(T, {
      ...TEAM_TIME_ROTATION,
      held: Array.from({ length: 53 }, () => ({ date: "2026-11-05", optionId: "o1" })),
    });
    rejects(T, {
      ...TEAM_TIME_ROTATION,
      held: [{ date: "2026-11-05", optionId: "o1", skipped: false }],
    });
  });

  it("refuse fewer than 2 options and a start date the calendar lacks, on both transports", async () => {
    await expect(
      update(T, "teamTimeRotations", TEAM_TIME_ROTATION, { options: [option] })
    ).rejects.toThrow(/between 2 and 4 times; this one has 1/);
    await expect(updateOverMcp(T, TEAM_TIME_ROTATION, { startDate: "2026-02-30" })).rejects.toThrow(
      /2026-02-30 isn't a day on the calendar/
    );
    expect(upsertEntity).not.toHaveBeenCalled();
  });
});

describe("P2.9 standups and charter templates", () => {
  it("cap a standup entry's format, DRI and hand-over", () => {
    rejects("workspace.standup_entry", { ...STANDUP_PPP, format: "scrum" });
    rejects("workspace.standup_entry", { ...STANDUP_PPP, blockerDri: "x".repeat(121) });
    rejects("workspace.standup_entry", { ...STANDUP_PPP, handoff: "x".repeat(4001) });
  });

  it("cap every charter template field", () => {
    const T = "workspace.working_agreement";
    const templates = AGREEMENT.templates!;
    const withTemplates = (patch: object) => ({
      ...AGREEMENT,
      templates: { ...templates, ...patch },
    });
    const ladder = templates.urgencyLadder!;
    rejects(T, withTemplates({ urgencyLadder: { ...ladder, levels: ladder.levels.slice(0, 1) } }));
    rejects(
      T,
      withTemplates({
        urgencyLadder: {
          ...ladder,
          levels: Array.from({ length: 7 }, (_, i) => ({ ...ladder.levels[0], id: `l${i}` })),
        },
      })
    );
    rejects(
      T,
      withTemplates({
        urgencyLadder: {
          ...ladder,
          levels: [{ ...ladder.levels[0], when: "x".repeat(161) }, ladder.levels[1]],
        },
      })
    );
    const core = templates.coreHours!;
    rejects(T, withTemplates({ coreHours: { ...core, purposes: [] } }));
    rejects(T, withTemplates({ coreHours: { ...core, timeZone: "Atlantis/Main" } }));
    rejects(T, withTemplates({ coreHours: { ...core, start: "10am" } }));
    rejects(
      T,
      withTemplates({
        coreHours: {
          ...core,
          anchorDays: Array.from({ length: 5 }, () => ({ site: "s", days: [1] })),
        },
      })
    );
    const focus = templates.focusTime!;
    rejects(T, withTemplates({ focusTime: { ...focus, weeklyMinHours: 41 } }));
    accepts(T, withTemplates({ focusTime: { ...focus, timeZone: "Asia/Tokyo" } }));
    const ai = templates.aiUse!;
    rejects(
      T,
      withTemplates({ aiUse: { ...ai, tools: Array.from({ length: 6 }, (_, i) => `t${i}`) } })
    );
    rejects(T, withTemplates({ aiUse: { ...ai, neverIn: ["everything"] } }));
    rejects(T, withTemplates({ aiUse: { ...ai, review: "never" } }));
    rejects(T, withTemplates({ aiUse: { ...ai, shareWhere: "x".repeat(121) } }));
    rejects(T, {
      ...AGREEMENT,
      rules: [{ ...AGREEMENT.rules[0], template: { id: "dress-code", slot: "s" } }],
    });
    rejects(T, {
      ...AGREEMENT,
      rules: [{ ...AGREEMENT.rules[0], template: { id: "core-hours", slot: "x".repeat(41) } }],
    });
  });
});

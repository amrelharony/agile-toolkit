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
  BUG_REPORT_KIND,
  ENTITY_ROW_MAX_BYTES,
  EXAMPLE_MAP_KIND,
  HILL_CHART_KIND,
  MEETING_NOTE_KIND,
  PERSONA_KIND,
  PRODUCT_CANVAS_KIND,
  STRATEGY_MAP_KIND,
  TEST_SESSION_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ExampleMap,
  type ProductCanvas,
  type Workspace,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import { SECTION_KEY_PATTERN, sectionsSchema } from "@/lib/actions/workspace/sectioned-schema";
import {
  BUG_REPORT,
  EXAMPLE_MAP,
  HILL_CHART,
  IMPACT_MAP,
  INTERRUPT_FROM_BUG,
  MEETING_NOTE,
  PERSONA,
  PRODUCT_CANVAS,
  RELEASES_WITH_NOTES,
  ROADMAP_WITH_HORIZON,
  STRATEGY_TREE,
  TEST_SESSION,
} from "../stores/phase43-fixtures";

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

const COLLECTIONS: [toolId: string, slice: keyof Workspace, doc: Doc, kind: string][] = [
  ["workspace.example_map", "exampleMaps", EXAMPLE_MAP, EXAMPLE_MAP_KIND],
  ["workspace.bug_report", "bugReports", BUG_REPORT, BUG_REPORT_KIND],
  ["workspace.hill_chart", "hillCharts", HILL_CHART, HILL_CHART_KIND],
  ["workspace.test_session", "testSessions", TEST_SESSION, TEST_SESSION_KIND],
  ["workspace.meeting_note", "meetingNotes", MEETING_NOTE, MEETING_NOTE_KIND],
  ["workspace.product_canvas", "productCanvases", PRODUCT_CANVAS, PRODUCT_CANVAS_KIND],
  ["workspace.strategy_map", "strategyMaps", IMPACT_MAP, STRATEGY_MAP_KIND],
  ["workspace.persona", "personas", PERSONA, PERSONA_KIND],
];

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
      await create(toolId, { ...doc, id: undefined }, true);
      expect(upsertEntity).toHaveBeenCalledTimes(1);
      expect(upsertEntity.mock.calls[0][1]).toBe(kind);
    }
  );

  it.each(COLLECTIONS)(
    "%s stamps createdAt and updatedAt, never the caller's",
    async (toolId, slice, doc) => {
      await create(toolId, {
        ...doc,
        id: undefined,
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
    expect(await update(toolId, slice, doc)).toEqual(doc);
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
    rejects(T, { ...PRODUCT_CANVAS, intake: { ...PRODUCT_CANVAS.intake, demand: 0 } });
    rejects(T, { ...PRODUCT_CANVAS, intake: { ...PRODUCT_CANVAS.intake, demand: 10000 } });
    rejects(T, { ...PRODUCT_CANVAS, intake: { ...PRODUCT_CANVAS.intake, source: "press" } });
    rejects(T, {
      ...PRODUCT_CANVAS,
      intake: {
        ...PRODUCT_CANVAS.intake,
        requesters: Array.from({ length: TOOL_LIST_MAX.requesters + 1 }, (_, i) => `r${i}`),
      },
    });
    rejects(T, { ...PRODUCT_CANVAS, decision: { verdict: "maybe" } });
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

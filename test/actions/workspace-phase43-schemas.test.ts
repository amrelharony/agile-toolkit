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
  ENTITY_ROW_MAX_BYTES,
  EXAMPLE_MAP_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ExampleMap,
  type Workspace,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import { EXAMPLE_MAP } from "../stores/phase43-fixtures";

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

const COLLECTIONS: [toolId: string, slice: keyof Workspace, doc: Doc, kind: string][] = [
  ["workspace.example_map", "exampleMaps", EXAMPLE_MAP, EXAMPLE_MAP_KIND],
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

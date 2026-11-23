/**
 * tool.persona_library.* coverage, in the browser and over MCP.
 *
 *   1. registration — one read and two writes, each with an MCP handler,
 *      none refused to a visitor.
 *   2. list_state — the page's order, where each persona is used, the
 *      interviews it links (and ones since deleted), counts.
 *   3. add_persona — defaults, caps and cleaning; a duplicate name refused;
 *      over MCP it is the user's row.
 *   4. add_points — within the list's cap, repeats skipped, unknown ids.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona, StrategyMap, UserInterviewLog } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/persona-library";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = async <T>(id: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = registry.get(id)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const AT = "2026-11-20T10:00:00.000Z";
const persona = (id: string, over: Partial<Persona> = {}): Persona => ({
  id,
  name: id,
  role: "Role",
  tier: "secondary",
  evidence: "assumed",
  goals: [],
  pains: [],
  behaviours: [],
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const impactMap: StrategyMap = {
  id: "strategyMap_1",
  format: "impact-map",
  title: "Fewer refund calls",
  nodes: [
    { id: "g", parentId: null, level: 0, text: "Fewer refund calls" },
    { id: "a", parentId: "g", level: 1, text: "Shop owners", personaId: "persona_maya" },
  ],
  createdAt: AT,
  updatedAt: AT,
};
const log: UserInterviewLog = {
  id: "userInterviewLog:current",
  interviews: [
    { id: "i1", date: AT, participant: "Dana", quotes: [] },
    { id: "i2", date: AT, participant: "Sam", quotes: [] },
  ],
};

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => (ws().personas ?? []).find((p) => p.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ personas: [], strategyMaps: [], userInterviewLogs: [] });
});

describe("tool.persona_library — registration", () => {
  it("has a read and two writes, each over MCP too, and none kept from visitors", () => {
    expect(registry.get("tool.persona_library.list_state")?.category).toBe("read");
    for (const verb of ["list_state", "add_persona", "add_points"]) {
      const a = registry.get(`tool.persona_library.${verb}`);
      expect(a?.mcpHandler, verb).toBeTypeOf("function");
      expect(a?.visitor, verb).not.toBe(false);
    }
    for (const verb of ["add_persona", "add_points"]) {
      expect(registry.get(`tool.persona_library.${verb}`)?.category).toBe("write");
    }
  });
});

describe("tool.persona_library.list_state", () => {
  it("lists the personas as the page orders them, with where each is used and its interviews", async () => {
    useWorkspaceStore.setState({
      personas: [
        persona("persona_tom", { name: "Tom" }),
        persona("persona_maya", {
          name: "Maya",
          tier: "primary",
          evidence: "some",
          interviewIds: ["i1", "gone"],
        }),
      ],
      strategyMaps: [impactMap],
      userInterviewLogs: [log],
    });
    const out = await run<{
      personas: {
        id: string;
        usedOn: { id: string; title: string }[];
        interviews: { linked: number; missing: number };
        example: boolean;
      }[];
      counts: { tiers: Record<string, number>; evidence: Record<string, number> };
      interviewsLogged: number;
    }>("tool.persona_library.list_state");
    expect(out.personas.map((p) => p.id)).toEqual(["persona_maya", "persona_tom"]);
    expect(out.personas[0]).toMatchObject({
      usedOn: [{ id: "strategyMap_1", title: "Fewer refund calls" }],
      interviews: { linked: 1, missing: 1 },
      example: false,
    });
    expect(out.personas[1].usedOn).toEqual([]);
    expect(out.counts.tiers).toEqual({ primary: 1, secondary: 1, anti: 0 });
    expect(out.counts.evidence).toEqual({ assumed: 1, some: 1, researched: 0 });
    expect(out.interviewsLogged).toBe(2);
  });

  it("reads the user's rows over MCP", async () => {
    server.rows.set("workspace:persona/persona_maya", persona("persona_maya", { name: "Maya" }));
    server.rows.set("workspace:strategyMap/strategyMap_1", impactMap);
    server.rows.set("workspace:userInterviewLog/userInterviewLog:current", log);
    const out = await run<{ personas: { usedOn: unknown[] }[]; interviewsLogged: number }>(
      "tool.persona_library.list_state",
      {},
      true
    );
    expect(out.personas[0].usedOn).toHaveLength(1);
    expect(out.interviewsLogged).toBe(2);
  });
});

describe("tool.persona_library.add_persona", () => {
  it("adds a persona with the defaults, cleaned and stamped", async () => {
    const out = await run<{ added: boolean; id: string; tier: string }>(
      "tool.persona_library.add_persona",
      {
        name: "  Maya ",
        role: "Shift nurse",
        goals: ["Dinner in 30 minutes", " ", "dinner in 30 minutes"],
        tags: ["mobile"],
      }
    );
    expect(out).toMatchObject({ added: true, tier: "primary" });
    expect(out.id).toMatch(/^persona_/);
    const p = stored(out.id)!;
    expect(p).toMatchObject({
      name: "Maya",
      evidence: "assumed",
      goals: ["Dinner in 30 minutes"],
      pains: [],
      tags: ["mobile"],
    });
    expect(p.createdAt).toBe(p.updatedAt);
    expect(Date.parse(p.createdAt)).not.toBeNaN();
    // The library now has a main persona: the next one is also served.
    const next = await run<{ tier: string }>("tool.persona_library.add_persona", {
      name: "Tom",
      role: "Office manager",
    });
    expect(next.tier).toBe("secondary");
  });

  it("refuses a name already in the library, in any case", async () => {
    useWorkspaceStore.setState({ personas: [persona("persona_maya", { name: "Maya" })] });
    const out = await run<{ added: boolean; reason: string; message: string }>(
      "tool.persona_library.add_persona",
      { name: "MAYA", role: "Someone" }
    );
    expect(out).toMatchObject({ added: false, reason: "duplicate_name" });
    expect(out.message).toContain("persona_maya");
    expect(ws().personas).toHaveLength(1);
  });

  it("holds an agent to the CRUD's caps", () => {
    const schema = registry.get("tool.persona_library.add_persona")!.paramsSchema;
    expect(schema.safeParse({ name: "", role: "r" }).success).toBe(false);
    expect(schema.safeParse({ name: "n".repeat(201), role: "r" }).success).toBe(false);
    expect(schema.safeParse({ name: "n", role: "r", goals: Array(9).fill("g") }).success).toBe(
      false
    );
    expect(schema.safeParse({ name: "n", role: "r", tier: "boss" }).success).toBe(false);
    expect(schema.safeParse({ name: "n", role: "r", context: "c".repeat(1001) }).success).toBe(
      false
    );
  });

  it("writes the user's row over MCP", async () => {
    const out = await run<{ added: boolean; id: string }>(
      "tool.persona_library.add_persona",
      { name: "Riley", role: "Deal hunter", tier: "anti" },
      true
    );
    expect(out.added).toBe(true);
    expect(server.rows.get(`workspace:persona/${out.id}`)).toMatchObject({
      name: "Riley",
      tier: "anti",
    });
    expect(ws().personas).toEqual([]);
  });
});

describe("tool.persona_library.add_points", () => {
  it("adds points within the cap and skips repeats", async () => {
    useWorkspaceStore.setState({
      personas: [persona("persona_maya", { pains: Array.from({ length: 6 }, (_, i) => `p${i}`) })],
    });
    const out = await run<{ updated: boolean; added: number; skipped: number }>(
      "tool.persona_library.add_points",
      { personaId: "persona_maya", list: "pains", items: ["P0", "slow", "late", "too many"] }
    );
    expect(out).toEqual({ updated: true, added: 2, skipped: 2 });
    expect(stored("persona_maya")!.pains).toHaveLength(8);
    expect(stored("persona_maya")!.updatedAt).not.toBe(AT);
    const full = await run<{ updated: boolean; reason: string }>(
      "tool.persona_library.add_points",
      { personaId: "persona_maya", list: "pains", items: ["one more"] }
    );
    expect(full).toMatchObject({ updated: false, reason: "full" });
  });

  it("says when nothing is new, or the persona is unknown", async () => {
    useWorkspaceStore.setState({ personas: [persona("persona_maya", { goals: ["Eat well"] })] });
    expect(
      await run("tool.persona_library.add_points", {
        personaId: "persona_maya",
        list: "goals",
        items: ["eat well"],
      })
    ).toMatchObject({ updated: false, reason: "unchanged" });
    expect(
      await run("tool.persona_library.add_points", {
        personaId: "nope",
        list: "goals",
        items: ["x"],
      })
    ).toMatchObject({ updated: false, reason: "not_found" });
  });

  it("writes the user's row over MCP", async () => {
    server.rows.set("workspace:persona/persona_maya", persona("persona_maya"));
    await run(
      "tool.persona_library.add_points",
      { personaId: "persona_maya", list: "behaviours", items: ["Orders on Sunday"] },
      true
    );
    expect(server.rows.get("workspace:persona/persona_maya")).toMatchObject({
      behaviours: ["Orders on Sunday"],
    });
  });
});

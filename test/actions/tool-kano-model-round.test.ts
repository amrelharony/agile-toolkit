import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * tool.kano_model.record_round on both transports: a round's totals for
 * one feature, as counts or the 5×5 joint, replace its earlier answers (or
 * add to them, a single pair counting as one), drop a hand-picked
 * category, and read back as the page reads them (category and
 * Better/Worse from 3 answers). The page's save gives the same fields.
 */

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
    serverBulkUpsertEntities: vi.fn(async (_u: string, kind: string, list: { id: string }[]) => {
      for (const e of list) server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { applyKanoRound } from "@/app/(tools)/kano-model/survey";
import type { PairRoundResult } from "@/lib/realtime/vote-room/pair";
import "@/lib/actions/tools/kano-model";

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
const browser = async <T>(params: unknown) =>
  (await registry.get("tool.kano_model.record_round")!.handler(params as never, ctx())) as T;
const mcp = async <T>(params: unknown) => {
  const a = registry.get("tool.kano_model.record_round")!;
  return (await a.mcpHandler!(params as never, ctx())) as T;
};

const feature = (id: string, fields: Record<string, number | string> = {}) =>
  ({
    id,
    framework: "kano",
    title: `Feature ${id}`,
    fields,
    status: "open",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) as PrioritizationItem;
const joint = (cells: [number, number, number][]) => {
  const out = new Array<number>(25).fill(0);
  for (const [f, s, n] of cells) out[f * 5 + s] = n;
  return out;
};
const storedRow = (id: string) =>
  (useWorkspaceStore.getState().prioritizations ?? []).find((r) => r.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ prioritizations: [] });
});

interface Recorded {
  category: string | null;
  score: number | null;
  n: number;
  better: number | null;
  worse: number | null;
  enough: boolean;
  replaced: boolean;
  previous: { n: number } | null;
}

describe("tool.kano_model.record_round", () => {
  it("is a write verb with a refine for counts or joint", () => {
    const a = registry.get("tool.kano_model.record_round")!;
    expect(a.category).toBe("write");
    expect(a.paramsSchema.safeParse({ featureId: "a" }).success).toBe(false);
    expect(
      a.paramsSchema.safeParse({
        featureId: "a",
        counts: { A: 1, O: 0, M: 0, I: 0, R: 0, Q: 0 },
        joint: joint([]),
      }).success
    ).toBe(false);
    expect(a.paramsSchema.safeParse({ featureId: "a", joint: [1, 2, 3] }).success).toBe(false);
  });

  it("folds a joint into class counts and replaces a hand-picked category", async () => {
    useWorkspaceStore.setState({ prioritizations: [feature("a", { category: "attractive" })] });
    const r = await browser<Recorded>({
      featureId: "a",
      joint: joint([
        [1, 4, 4],
        [0, 4, 1],
      ]),
      source: "room",
      roundId: "round_abcdefgh",
      at: "2026-10-27T10:00:00.000Z",
    });
    expect(r).toMatchObject({ category: "must-be", score: 5, n: 5, enough: true, replaced: false });
    expect(r.better).toBeCloseTo(0.2);
    expect(r.worse).toBeCloseTo(-1);
    expect(storedRow("a")?.fields).toEqual({
      kanoA: 0,
      kanoO: 1,
      kanoM: 4,
      kanoI: 0,
      kanoR: 0,
      kanoQ: 0,
      kanoN: 5,
      kanoSource: "room",
      kanoRoundId: "round_abcdefgh",
      kanoAt: "2026-10-27T10:00:00.000Z",
    });
    expect(storedRow("a")).toMatchObject({ score: 5, status: "scored" });
  });

  it("writes the same fields as the page's Save round for the same totals", async () => {
    const row = feature("a", { kanoA: 2, kanoN: 2, kanoSource: "counts" });
    useWorkspaceStore.setState({ prioritizations: [row] });
    const j = joint([[0, 2, 3]]);
    const page = applyKanoRound(
      [row],
      {
        kind: "pair",
        roundId: "round_abcdefgh",
        tool: "kano-model",
        sheetId: "kano-survey",
        title: "Kano survey",
        prompts: { first: "a", second: "b" },
        answers: [],
        closedAt: "2026-10-27T10:00:00.000Z",
        minN: 3,
        ballots: 3,
        source: "live",
        items: [{ id: "a", text: "Feature a", responses: 3, joint: j }],
      } as PairRoundResult,
      { add: true }
    )[0];
    await browser({
      featureId: "a",
      joint: j,
      add: true,
      source: "room",
      roundId: "round_abcdefgh",
      at: "2026-10-27T10:00:00.000Z",
    });
    expect(storedRow("a")?.fields).toEqual(page.fields);
    expect(storedRow("a")?.score).toBe(page.score);
  });

  it("replaces earlier counts by default and adds when asked, a pair counting as one", async () => {
    server.rows.set(
      "workspace:prioritization/a",
      feature("a", { kanoM: 9, kanoN: 9, kanoSource: "counts" })
    );
    server.rows.set(
      "workspace:prioritization/b",
      feature("b", { functional: "like", dysfunctional: "neutral" })
    );
    const replaced = await mcp<Recorded>({
      featureId: "a",
      counts: { A: 0, O: 2, M: 0, I: 0, R: 0, Q: 0 },
    });
    expect(replaced).toMatchObject({
      n: 2,
      category: null,
      enough: false,
      better: null,
      replaced: true,
      previous: { n: 9 },
    });
    const added = await mcp<Recorded>({
      featureId: "b",
      counts: { A: 0, O: 0, M: 2, I: 0, R: 0, Q: 0 },
      add: true,
    });
    expect(added).toMatchObject({ n: 3, category: "must-be", enough: true, replaced: false });
    const b = server.rows.get("workspace:prioritization/b") as PrioritizationItem;
    expect(b.fields).toMatchObject({ kanoA: 1, kanoM: 2, kanoN: 3, kanoSource: "tally" });
  });

  it("refuses an unknown feature, another method's row and an empty round", async () => {
    useWorkspaceStore.setState({
      prioritizations: [{ ...feature("ice"), framework: "ice" }, feature("a")],
    });
    await expect(browser({ featureId: "gone", joint: joint([[0, 0, 3]]) })).rejects.toThrow(
      "No Kano feature gone"
    );
    await expect(browser({ featureId: "ice", joint: joint([[0, 0, 3]]) })).rejects.toThrow(
      "No Kano feature ice"
    );
    await expect(browser({ featureId: "a", joint: joint([]) })).rejects.toThrow(
      "The round has no answers for this feature."
    );
    expect(storedRow("a")?.fields).toEqual({});
  });
});

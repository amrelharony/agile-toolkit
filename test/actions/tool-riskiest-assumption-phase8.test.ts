/**
 * tool.riskiest_assumption.* after Phase 8, on both transports: ratings are
 * optional, list_state ranks with lib/assumptions (the page's score, tested
 * and unrated left out, examples too), rate_assumption sets and clears,
 * and test_assumption makes the linked hypothesis once, never for an example.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Assumption,
  AssumptionLevel,
  Hypothesis,
  HypothesisTracker,
  RiskiestAssumption,
} from "@/lib/stores/workspace-types";
import { RA_ID, rankAssumptions } from "@/lib/assumptions/model";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";

import "@/lib/actions/tools/riskiest-assumption";

type Path = "handler" | "mcpHandler";
const TRANSPORTS: Path[] = ["handler", "mcpHandler"];
const KIND_RA = "workspace:riskiestAssumption";
const KIND_HT = "workspace:hypothesisTracker";
const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

const run = <T = Record<string, unknown>>(
  path: Path,
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.riskiest_assumption.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

function seed(path: Path, assumptions: Assumption[], hypotheses?: Hypothesis[]) {
  const canvas: RiskiestAssumption = { id: RA_ID, assumptions };
  const tracker: HypothesisTracker | undefined = hypotheses && {
    id: HYPOTHESIS_TRACKER_ID,
    hypotheses,
  };
  if (path === "handler") {
    useWorkspaceStore.setState({
      riskiestAssumptions: [canvas],
      hypothesisTrackers: tracker ? [tracker] : [],
    });
  } else {
    rows.set(`${KIND_RA}/${RA_ID}`, canvas);
    if (tracker) rows.set(`${KIND_HT}/${HYPOTHESIS_TRACKER_ID}`, tracker);
  }
}

const canvas = (path: Path): Assumption[] =>
  (path === "handler"
    ? (useWorkspaceStore.getState().riskiestAssumptions ?? []).find((d) => d.id === RA_ID)
    : (rows.get(`${KIND_RA}/${RA_ID}`) as RiskiestAssumption | undefined)
  )?.assumptions ?? [];
const tracker = (path: Path): Hypothesis[] =>
  (path === "handler"
    ? (useWorkspaceStore.getState().hypothesisTrackers ?? []).find(
        (d) => d.id === HYPOTHESIS_TRACKER_ID
      )
    : (rows.get(`${KIND_HT}/${HYPOTHESIS_TRACKER_ID}`) as HypothesisTracker | undefined)
  )?.hypotheses ?? [];

const a = (
  id: string,
  risk?: number,
  evidence?: number,
  over: Partial<Assumption> = {}
): Assumption => ({
  id,
  statement: `Assumption ${id}`,
  ...(risk !== undefined ? { riskLevel: risk as AssumptionLevel } : {}),
  ...(evidence !== undefined ? { evidenceLevel: evidence as AssumptionLevel } : {}),
  status: "untested",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  rows.clear();
  useWorkspaceStore.setState({ riskiestAssumptions: [], hypothesisTrackers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registration", () => {
  it("adds rate_assumption and test_assumption as writes with server paths", () => {
    for (const verb of ["rate_assumption", "test_assumption"]) {
      const action = registry.get(`tool.riskiest_assumption.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
    }
  });
});

describe.each(TRANSPORTS)("%s", (path) => {
  it("list_state ranks as the page does: (4, 2) before (5, 3); unrated, tested and examples out", async () => {
    const list = [
      a("A", 5, 3),
      a("B", 4, 2),
      a("unrated", 5),
      a("done", 5, 1, { status: "invalidated" }),
      a("via", 5, 1, {
        sentTo: [{ route: "hypothesis", targetId: "h1", at: "2026-10-20T00:00:00Z" }],
      }),
      a("example-1", 5, 1),
    ];
    const hs: Hypothesis[] = [
      {
        id: "h1",
        believe: "x",
        willDo: "",
        toLearn: "",
        successMetric: "",
        status: "validated",
        raisedAt: "2026-10-20",
      },
    ];
    seed(path, list, hs);
    const r = (await run(path, "list_state")) as {
      riskiest: { id: string; score: number };
      ranking: {
        id: string;
        rank: number;
        score: number;
        quadrant: string;
        test: { state: string };
      }[];
      unrated: { id: string }[];
      tested: { id: string; result: string }[];
      total: number;
    };
    expect(r.riskiest).toMatchObject({ id: "B", score: 16, riskLevel: 4, evidenceLevel: 2 });
    const lib = rankAssumptions(
      list.filter((x) => !x.id.startsWith("example-")),
      hs
    );
    expect(r.ranking.map((x) => [x.id, x.rank, x.score])).toEqual(
      lib.ranked.map((x) => [x.assumption.id, x.rank, x.score])
    );
    expect(r.ranking[0]).toMatchObject({ quadrant: "test-first", test: { state: "none" } });
    expect(r.unrated.map((x) => x.id)).toEqual(["unrated"]);
    expect(r.tested).toEqual([
      { id: "done", statement: "Assumption done", status: "invalidated", result: "invalidated" },
      { id: "via", statement: "Assumption via", status: "untested", result: "validated" },
    ]);
    expect(r.total).toBe(6);
  });

  it("add_assumption leaves ratings unset when the user hasn't rated it", async () => {
    const r = await run(path, "add_assumption", { statement: "Teams will pay" });
    expect(r).toMatchObject({ added: true, rated: false, score: null });
    expect(canvas(path)[0]).not.toHaveProperty("riskLevel");
    expect(canvas(path)[0]).not.toHaveProperty("evidenceLevel");
    const state = (await run(path, "list_state")) as { riskiest: unknown; unrated: unknown[] };
    expect(state.riskiest).toBeNull();
    expect(state.unrated).toHaveLength(1);
    const rated = await run(path, "add_assumption", {
      statement: "x",
      riskLevel: 4,
      evidenceLevel: 2,
    });
    expect(rated).toMatchObject({ rated: true, score: 16 });
  });

  it("rate_assumption sets, keeps and clears ratings, and says where it ranks", async () => {
    seed(path, [a("x"), a("y", 2, 2)]);
    expect(await run(path, "rate_assumption", { assumptionId: "x", riskLevel: 5 })).toEqual({
      updated: true,
      riskLevel: 5,
      evidenceLevel: null,
      score: null,
      rank: null,
    });
    expect(await run(path, "rate_assumption", { assumptionId: "x", evidenceLevel: 1 })).toEqual({
      updated: true,
      riskLevel: 5,
      evidenceLevel: 1,
      score: 25,
      rank: 1,
    });
    await run(path, "rate_assumption", { assumptionId: "x", riskLevel: null });
    expect(canvas(path)[0]).not.toHaveProperty("riskLevel");
    expect(canvas(path)[0].evidenceLevel).toBe(1);
    expect(await run(path, "rate_assumption", { assumptionId: "x" })).toEqual({
      updated: false,
      reason: "no_change",
    });
    expect(await run(path, "rate_assumption", { assumptionId: "nope", riskLevel: 2 })).toEqual({
      updated: false,
      reason: "not_found",
    });
    expect(() =>
      registry
        .get("tool.riskiest_assumption.rate_assumption")!
        .paramsSchema.parse({ assumptionId: "x", riskLevel: 6 })
    ).toThrow();
  });

  it("test_assumption makes the linked hypothesis once, with the test idea as what we'll do", async () => {
    seed(
      path,
      [a("as1", 4, 2, { testIdea: "Fake-door test", description: "Interviews split" })],
      [
        {
          id: "old",
          believe: "o",
          willDo: "w",
          toLearn: "l",
          successMetric: "m",
          status: "running",
          raisedAt: "2026-10-01",
        },
      ]
    );
    const r = await run(path, "test_assumption", { assumptionId: "as1" });
    expect(r).toMatchObject({ sent: true, believe: "Assumption as1", missing: ["successMetric"] });
    const hs = tracker(path);
    expect(hs.map((h) => h.id)).toEqual([r.hypothesisId, "old"]);
    expect(hs[0]).toEqual({
      id: r.hypothesisId,
      believe: "Assumption as1",
      willDo: "Fake-door test",
      toLearn: "Interviews split",
      successMetric: "",
      status: "drafted",
      raisedAt: "2026-10-27",
      sourceRef: { tool: "riskiest-assumption", id: "as1", doc: RA_ID },
    });
    const sent = canvas(path)[0];
    expect(sent.sentTo).toEqual([
      { route: "hypothesis", targetId: r.hypothesisId, at: expect.any(String) },
    ]);
    // The status stays the user's call.
    expect(sent.status).toBe("untested");

    expect(await run(path, "test_assumption", { assumptionId: "as1" })).toEqual({
      sent: false,
      reason: "already_sent",
      hypothesisId: r.hypothesisId,
    });
  });

  it("test_assumption can send again once its hypothesis is gone; never an example, a tested or an unknown one", async () => {
    seed(
      path,
      [
        a("as1", 4, 2, {
          sentTo: [{ route: "hypothesis", targetId: "gone", at: "2026-10-01T00:00:00Z" }],
        }),
        a("example-2", 4, 2),
        a("done", 4, 2, { status: "validated" }),
      ],
      []
    );
    const again = await run(path, "test_assumption", { assumptionId: "as1" });
    expect(again.sent).toBe(true);
    expect(canvas(path)[0].sentTo).toHaveLength(1);
    expect(await run(path, "test_assumption", { assumptionId: "example-2" })).toEqual({
      sent: false,
      reason: "example",
    });
    expect(await run(path, "test_assumption", { assumptionId: "done" })).toEqual({
      sent: false,
      reason: "tested",
    });
    expect(await run(path, "test_assumption", { assumptionId: "nope" })).toEqual({
      sent: false,
      reason: "not_found",
    });
    expect(tracker(path)).toHaveLength(1);
  });
});

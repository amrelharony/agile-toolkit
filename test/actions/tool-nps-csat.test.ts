/**
 * tool.nps_csat.* coverage.
 *
 *   1. list_state (read) + record (write, mcpHandler, no confirm)
 *   2. list_state — lib/nps' numbers: NPS null with no NPS responses, CSAT
 *      as % satisfied, periods with n and the enough flags, tags; a tag
 *      filter; example rows left out; the same over MCP
 *   3. record — the score checked against its kind's scale, a real day
 *      never in the future, tags normalised
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { periodSeries, summarizeCsat, summarizeNps, tagCounts } from "@/lib/nps/score";
import { exampleId } from "@/lib/utils/example-id";
// The page form's caps: record refuses what the form would refuse on the next edit.
import { RESPONDENT_MAX, VERBATIM_MAX } from "@/app/(tools)/nps-csat/form";

import "@/lib/actions/tools/nps-csat";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T>(path: "handler" | "mcpHandler", verb: string, params: Record<string, unknown>) => {
  const action = registry.get(`tool.nps_csat.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", verb, params);

/** 3 Nov 2026, noon local: only Date is faked, so promises run as usual. */
const NOW = new Date(2026, 10, 3, 12);
const TODAY = "2026-11-03";

let seq = 0;
function resp(p: Partial<NpsResponse> & Pick<NpsResponse, "kind" | "score">): NpsResponse {
  return { id: `r${seq++}`, date: "2026-10-01", ...p };
}

/** Seeds the browser store and the server rows with the same responses. */
function seed(responses: NpsResponse[]) {
  useWorkspaceStore.setState({ npsResponses: responses });
  for (const r of responses) rows.set(`workspace:npsResponse/${r.id}`, r);
}

const stored = () => useWorkspaceStore.getState().npsResponses ?? [];

beforeEach(() => {
  rows.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seed([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tool.nps_csat — registration", () => {
  it("list_state read; record write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.nps_csat.list_state")?.category).toBe("read");
    expect(registry.get("tool.nps_csat.record")?.category).toBe("write");
    expect(registry.get("tool.nps_csat.record")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.nps_csat.record")?.requiresConfirmation).toBe(false);
  });

  it("advertises every param to MCP (the day's refinement and the tags union convert)", () => {
    const record = zodToJsonSchema(registry.get("tool.nps_csat.record")!.paramsSchema);
    expect(Object.keys(record.properties as object).sort()).toEqual(
      ["date", "kind", "respondent", "score", "tags", "verbatim"].sort()
    );
    const list = zodToJsonSchema(registry.get("tool.nps_csat.list_state")!.paramsSchema);
    expect(Object.keys(list.properties as object).sort()).toEqual(["by", "maxPeriods", "tag"]);
  });
});

describe("tool.nps_csat.list_state", () => {
  type State = {
    total: number;
    matching: number;
    tag: string | null;
    nps: { count: number; n: number; score: number | null };
    csat: { count: number; satisfiedPct: number | null; average: number | null };
    by: string;
    minPerPeriod: number;
    periods: unknown[];
    headline: { nps: unknown; csat: unknown };
    undated: number;
    offScale: number;
    tags: unknown[];
  };

  it("reads no NPS as null, never 0", async () => {
    const r = await call<State>("list_state");
    expect(r.total).toBe(0);
    expect(r.nps).toMatchObject({ count: 0, n: 0, score: null });
    expect(r.csat).toMatchObject({ count: 0, satisfiedPct: null, average: null });
    expect(r.periods).toEqual([]);
    expect(r.headline).toEqual({ nps: null, csat: null });
    expect(r.minPerPeriod).toBe(MIN_SAMPLE.surveyPeriod);
  });

  it("computes NPS score, buckets, and CSAT as % satisfied", async () => {
    // 5 NPS: 3 promoters (9,10,9), 1 passive (7), 1 detractor (4) → 40.
    // 2 CSAT: 4 and 5 → 100% satisfied, average 4.5.
    seed([
      ...[9, 10, 9, 7, 4].map((score) => resp({ kind: "nps", score })),
      resp({ kind: "csat", score: 4 }),
      resp({ kind: "csat", score: 5 }),
    ]);
    const r = await call<State & { nps: Record<string, number>; csat: Record<string, number> }>(
      "list_state"
    );
    expect(r.nps).toEqual({ n: 5, count: 5, score: 40, promoters: 3, passives: 1, detractors: 1 });
    expect(r.csat).toEqual({ n: 2, count: 2, satisfied: 2, satisfiedPct: 100, average: 4.5 });
  });

  it("gives the library's periods, headline and tags, the example rows left out", async () => {
    const real = [
      ...Array.from({ length: 10 }, (_, i) =>
        resp({ kind: "nps", score: i < 6 ? 9 : 3, date: "2026-09-10", tags: ["pricing"] })
      ),
      resp({ kind: "csat", score: 2, date: "2026-10-05", tags: ["support"] }),
      resp({ kind: "nps", score: 9, date: "" }),
      resp({ kind: "nps", score: 11, date: "2026-10-06" }),
    ];
    seed([...real, { ...real[0], id: exampleId("nps-1") }]);
    const r = await call<State>("list_state");
    const series = periodSeries(real, "month", { maxPeriods: 24, through: TODAY });
    expect(r.total).toBe(real.length);
    expect(r.by).toBe("month");
    expect(r.nps).toEqual({ ...summarizeNps(real), count: summarizeNps(real).n });
    expect(r.csat).toEqual({ ...summarizeCsat(real), count: summarizeCsat(real).n });
    expect(r.periods).toEqual(series.points);
    expect(r.periods.map((p) => (p as { period: string }).period)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(r.headline).toEqual({
      nps: { period: "2026-09", label: "Sep 2026", score: 20, n: 10 },
      csat: null,
    });
    expect(r.undated).toBe(1);
    expect(r.offScale).toBe(1);
    expect(r.tags).toEqual(tagCounts(real));
  });

  it("filters by a tag and groups by week", async () => {
    seed([
      resp({ kind: "nps", score: 3, date: "2026-10-26", tags: ["support"] }),
      resp({ kind: "nps", score: 9, date: "2026-10-27", tags: ["pricing"] }),
    ]);
    const r = await call<
      Omit<State, "periods"> & { periods: { period: string; nps: { n: number } }[] }
    >("list_state", { by: "week", tag: " Support " });
    expect(r).toMatchObject({ total: 2, matching: 1, tag: "support", by: "week" });
    expect(r.nps.score).toBe(-100);
    expect(r.periods.map((p) => [p.period, p.nps.n])).toEqual([
      ["2026-W44", 1],
      ["2026-W45", 0],
    ]);
    // The tag table stays over every response.
    expect((r.tags as { tag: string }[]).map((t) => t.tag)).toEqual(["support", "pricing"]);
  });

  it("heads with the latest period with enough answers even when it is older than the periods returned", async () => {
    // A busy week 14 months ago, a few answers a month since: the page's
    // cards read every period, so that week still heads them.
    const busy = Array.from({ length: 12 }, () =>
      resp({ kind: "nps", score: 10, date: "2025-09-03" })
    );
    const since = ["2026-01-14", "2026-06-10", "2026-10-21"].map((date) =>
      resp({ kind: "nps", score: 3, date })
    );
    seed([...busy, ...since]);
    const page = periodSeries([...busy, ...since], "week", { through: TODAY });
    for (const read of [call, callMcp]) {
      const r = await read<State>("list_state", { by: "week" });
      expect(r.periods).toHaveLength(52);
      expect((r.periods[0] as { period: string }).period).toBe(
        page.points[page.points.length - 52].period
      );
      expect(r.periods).toEqual(page.points.slice(-52));
      expect(r.headline).toEqual({
        nps: { period: "2025-W36", label: expect.any(String), score: 100, n: 12 },
        csat: null,
      });
    }
    // A shorter window keeps the same headline.
    const short = await call<State>("list_state", { by: "week", maxPeriods: 2 });
    expect(short.periods).toHaveLength(2);
    expect((short.headline as { nps: { period: string } }).nps.period).toBe("2025-W36");
  });

  it("returns the same over MCP as in the browser", async () => {
    seed([
      resp({ kind: "nps", score: 10, date: "2026-08-03", tags: ["board"] }),
      resp({ kind: "csat", score: 3, date: "2026-10-12" }),
      resp({ kind: "nps", score: 7.5, date: "2026-10-12" }),
    ]);
    for (const params of [{}, { by: "week" }, { tag: "board" }, { maxPeriods: 2 }]) {
      expect(await callMcp("list_state", params)).toEqual(await call("list_state", params));
    }
  });
});

describe("tool.nps_csat.record", () => {
  it("adds a response dated today, with its tags normalised", async () => {
    const r = await call<{ added: boolean; id: string; date: string; tags: string[] }>("record", {
      kind: "nps",
      score: 10,
      respondent: " Dana ",
      tags: "Pricing, onboarding, pricing",
    });
    expect(r).toMatchObject({ added: true, date: TODAY, tags: ["pricing", "onboarding"] });
    expect(r.id).toMatch(/^nps_/);
    expect(stored()).toEqual([
      {
        id: r.id,
        kind: "nps",
        score: 10,
        date: TODAY,
        respondent: "Dana",
        tags: ["pricing", "onboarding"],
      },
    ]);
  });

  it("refuses a score off the kind's scale or not whole", async () => {
    for (const [kind, score] of [
      ["nps", 11],
      ["nps", -1],
      ["nps", 7.5],
      ["csat", 0],
      ["csat", 6],
      ["csat", 3.5],
    ] as const) {
      expect(await call("record", { kind, score }), `${kind} ${score}`).toMatchObject({
        added: false,
        reason: "off_scale",
      });
    }
    expect(await call("record", { kind: "csat", score: 1 })).toMatchObject({ added: true });
    expect(stored()).toHaveLength(1);
  });

  it("refuses a future day and too many or too long tags", async () => {
    expect(await call("record", { kind: "nps", score: 9, date: "2026-11-04" })).toMatchObject({
      added: false,
      reason: "future_day",
    });
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(await call("record", { kind: "nps", score: 9, tags: eleven })).toMatchObject({
      added: false,
      reason: "tags",
    });
    expect(await call("record", { kind: "nps", score: 9, tags: ["x".repeat(41)] })).toMatchObject({
      added: false,
      reason: "tags",
    });
    expect(stored()).toEqual([]);
    const schema = registry.get("tool.nps_csat.record")!.paramsSchema;
    expect(schema.safeParse({ kind: "nps", score: 9, date: "2026-02-30" }).success).toBe(false);
    expect(schema.safeParse({ kind: "nps", score: 9, date: "yesterday" }).success).toBe(false);
  });

  it("refuses a respondent or a verbatim longer than the page's form saves, on both paths", async () => {
    for (const read of [call, callMcp]) {
      expect(
        await read("record", { kind: "nps", score: 3, verbatim: "v".repeat(VERBATIM_MAX + 1) })
      ).toMatchObject({ added: false, reason: "too_long", message: expect.stringMatching(/4000/) });
      expect(
        await read("record", { kind: "nps", score: 3, respondent: "r".repeat(RESPONDENT_MAX + 1) })
      ).toMatchObject({ added: false, reason: "too_long", message: expect.stringMatching(/120/) });
    }
    expect(stored()).toEqual([]);
    expect(rows.size).toBe(0);
    // At the caps, and padded past them by spaces it trims, it saves.
    const r = await call<{ added: boolean; id: string }>("record", {
      kind: "nps",
      score: 3,
      respondent: ` ${"r".repeat(RESPONDENT_MAX)} `,
      verbatim: `${"v".repeat(VERBATIM_MAX)}\n`,
    });
    expect(r).toMatchObject({ added: true });
    expect(stored()[0]).toMatchObject({
      respondent: "r".repeat(RESPONDENT_MAX),
      verbatim: "v".repeat(VERBATIM_MAX),
    });
  });

  it("over MCP writes the server store and takes the day after the server's", async () => {
    const r = await callMcp<{ added: boolean; id: string }>("record", {
      kind: "csat",
      score: 5,
      date: "2026-11-04",
      tags: ["Support"],
    });
    expect(r).toMatchObject({ added: true, date: "2026-11-04", tags: ["support"] });
    expect(rows.get(`workspace:npsResponse/${r.id}`)).toMatchObject({
      kind: "csat",
      score: 5,
      date: "2026-11-04",
      tags: ["support"],
    });
    expect(await callMcp("record", { kind: "csat", score: 5, date: "2026-11-05" })).toMatchObject({
      added: false,
      reason: "future_day",
    });
    expect(stored()).toEqual([]);
  });
});

/**
 * tool.nps_csat.* coverage.
 *
 *   1. list_state (read) + record (write, mcpHandler, no confirm)
 *   2. NPS score = round((promoters − detractors)/npsCount × 100) with
 *      9–10 promoter / 7–8 passive / 0–6 detractor buckets; CSAT average
 *   3. record appends a response (auto id + date)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/nps-csat";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function resp(p: Partial<NpsResponse> & Pick<NpsResponse, "id" | "kind" | "score">): NpsResponse {
  return { date: "2026-01-01", ...p };
}

describe("tool.nps_csat — registration", () => {
  it("list_state read; record write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.nps_csat.list_state")?.category).toBe("read");
    expect(registry.get("tool.nps_csat.record")?.category).toBe("write");
    expect(registry.get("tool.nps_csat.record")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.nps_csat.record")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.nps_csat.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ npsResponses: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.nps_csat.list_state")!.handler({}, ctx())) as {
      total: number;
      nps: { score: number };
      csat: { average: number };
    };
    expect(r.total).toBe(0);
    expect(r.nps.score).toBe(0);
    expect(r.csat.average).toBe(0);
  });

  it("computes NPS score, buckets, and CSAT average", async () => {
    // 5 NPS: 3 promoters (9,10,9), 1 passive (7), 1 detractor (4)
    // score = round((3-1)/5*100) = 40
    for (const s of [9, 10, 9, 7, 4]) {
      useWorkspaceStore
        .getState()
        .upsertNpsResponse(resp({ id: `n${s}-${Math.random()}`, kind: "nps", score: s }));
    }
    // 2 CSAT: 4 and 5 → avg 4.5
    useWorkspaceStore.getState().upsertNpsResponse(resp({ id: "c1", kind: "csat", score: 4 }));
    useWorkspaceStore.getState().upsertNpsResponse(resp({ id: "c2", kind: "csat", score: 5 }));

    const r = (await registry.get("tool.nps_csat.list_state")!.handler({}, ctx())) as {
      nps: {
        count: number;
        score: number;
        promoters: number;
        passives: number;
        detractors: number;
      };
      csat: { count: number; average: number };
    };
    expect(r.nps.count).toBe(5);
    expect(r.nps.promoters).toBe(3);
    expect(r.nps.passives).toBe(1);
    expect(r.nps.detractors).toBe(1);
    expect(r.nps.score).toBe(40);
    expect(r.csat.count).toBe(2);
    expect(r.csat.average).toBe(4.5);
  });
});

describe("tool.nps_csat.record", () => {
  beforeEach(() => useWorkspaceStore.setState({ npsResponses: [] }));

  it("appends a response with auto id + date", async () => {
    const r = (await registry
      .get("tool.nps_csat.record")!
      .handler({ kind: "nps", score: 10, respondent: "Dana" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().npsResponses ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].score).toBe(10);
    expect(stored[0].date).toBeTruthy();
  });
});

describe("tool.nps_csat.record — edges", () => {
  beforeEach(() => useWorkspaceStore.setState({ npsResponses: [] }));
  afterEach(() => vi.useRealTimers());

  const record = registry.get("tool.nps_csat.record")!;

  it("keeps the respondent, verbatim and a supplied date", async () => {
    await record.handler(
      { kind: "csat", score: 4, respondent: "Lee", verbatim: "Quick fix", date: "2026-09-30" },
      ctx()
    );
    expect(useWorkspaceStore.getState().npsResponses).toEqual([
      expect.objectContaining({
        kind: "csat",
        score: 4,
        respondent: "Lee",
        verbatim: "Quick fix",
        date: "2026-09-30",
      }),
    ]);
  });

  // Bug: the default date was the UTC day, so a response recorded just after
  // local midnight east of UTC landed on the day before.
  it("defaults the date to the local day, like the in-app form", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const at of [new Date(2026, 9, 18, 0, 30), new Date(2026, 9, 18, 23, 30)]) {
      vi.setSystemTime(at);
      useWorkspaceStore.setState({ npsResponses: [] });
      await record.handler({ kind: "nps", score: 9 }, ctx());
      expect(useWorkspaceStore.getState().npsResponses?.[0].date).toBe("2026-10-18");
    }
  });

  // Bug: the schema took any number, so an agent could store NPS 50 or a
  // CSAT 8 that the CSAT card then averaged under its "(1-5)" hint.
  it("rejects a score outside its survey's range at the schema boundary", () => {
    const parse = (p: unknown) => record.paramsSchema.safeParse(p).success;
    expect(parse({ kind: "nps", score: 0 })).toBe(true);
    expect(parse({ kind: "nps", score: 10 })).toBe(true);
    expect(parse({ kind: "nps", score: 11 })).toBe(false);
    expect(parse({ kind: "nps", score: -1 })).toBe(false);
    expect(parse({ kind: "csat", score: 1 })).toBe(true);
    expect(parse({ kind: "csat", score: 5 })).toBe(true);
    expect(parse({ kind: "csat", score: 0 })).toBe(false);
    expect(parse({ kind: "csat", score: 8 })).toBe(false);
  });
});

describe("tool.nps_csat.list_state — edges", () => {
  beforeEach(() => useWorkspaceStore.setState({ npsResponses: [] }));

  it("rounds the CSAT average to two decimals and the NPS to a whole number", async () => {
    useWorkspaceStore.setState({
      npsResponses: [
        resp({ id: "c1", kind: "csat", score: 4 }),
        resp({ id: "c2", kind: "csat", score: 4 }),
        resp({ id: "c3", kind: "csat", score: 5 }),
        resp({ id: "n1", kind: "nps", score: 10 }),
        resp({ id: "n2", kind: "nps", score: 8 }),
        resp({ id: "n3", kind: "nps", score: 8 }),
      ],
    });
    const r = (await registry.get("tool.nps_csat.list_state")!.handler({}, ctx())) as {
      total: number;
      nps: { score: number; passives: number };
      csat: { average: number };
    };
    expect(r.total).toBe(6);
    // 1 promoter of 3 → 33.33… → 33.
    expect(r.nps).toMatchObject({ score: 33, passives: 2 });
    expect(r.csat.average).toBe(4.33);
  });
});

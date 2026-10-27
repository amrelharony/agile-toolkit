/**
 * The workspace.* CRUD schemas for the Outcomes, quality & library tools
 * keep every Phase 8 field. `update` validates the merged record and writes
 * what the schema parsed, and z.object drops keys it doesn't know, so a
 * field missing from a schema would be erased by every agent update.
 *
 * Also: rows stored before Phase 8 still parse and load; the bounds the new
 * fields bring; the OKR update keeping a key result's check-ins when a
 * keyResults patch leaves them out; and the risk and tech-debt CRUDs
 * stamping updatedAt on both transports.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverGetEntity: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => {}),
  };
});

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KeyResult, Okr, Risk, TechDebtItem, Workspace } from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import {
  CODE_REVIEW_LOG,
  FLAKY_BOARD,
  FULL_CHECK_INS,
  HYPOTHESES,
  INTERVIEWS,
  LEGACY_CSAT,
  LEGACY_OKR,
  LEGACY_RISK,
  LEGACY_RISKIEST,
  LEGACY_TECH_DEBT,
  LEGACY_TEST_PYRAMID,
  NPS,
  OKR,
  OPPORTUNITIES,
  RISK,
  RISKIEST,
  TECH_DEBT,
  TEST_PYRAMID,
} from "../stores/phase8-fixtures";

const upsertEntity = vi.mocked(serverStore.serverUpsertEntity);
const getEntity = vi.mocked(serverStore.serverGetEntity);

type Doc = { id: string };

const action = (id: string) => {
  const a = registry.get(id);
  if (!a) throw new Error(`missing action ${id}`);
  return a;
};

/** What `create` accepts for this entity, parsed. */
function parseCreate(toolId: string, entity: unknown) {
  return action(`${toolId}.create`).paramsSchema.safeParse({ entity });
}

/** Seed the slice, run the in-tab `update` with `patch`, and read the row back. */
async function updateInTab(toolId: string, slice: keyof Workspace, doc: Doc, patch = {}) {
  useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
  await action(`${toolId}.update`).handler({ id: doc.id, patch }, makeContext("u", "agent"));
  return (useWorkspaceStore.getState()[slice] as Doc[]).find((d) => d.id === doc.id);
}

/** Run the MCP `update` against a stored `doc` and return what it wrote. */
async function updateOnServer(toolId: string, doc: Doc, patch = {}) {
  getEntity.mockResolvedValueOnce(structuredClone(doc) as never);
  await action(`${toolId}.update`).mcpHandler!({ id: doc.id, patch }, makeContext("u", "mcp"));
  expect(upsertEntity).toHaveBeenCalledTimes(1);
  return upsertEntity.mock.calls[0][2] as Doc;
}

const rejects = (toolId: string, entity: unknown) =>
  expect(parseCreate(toolId, entity).success, JSON.stringify(entity)).toBe(false);

const accepts = (toolId: string, entity: unknown) => {
  const parsed = parseCreate(toolId, entity);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
};

/** A copy of `record` without `keys`. */
function without<T extends object>(record: T, ...keys: (keyof T)[]): Partial<T> {
  const copy: Partial<T> = { ...record };
  for (const k of keys) delete copy[k];
  return copy;
}

/** A record without the `updatedAt` the risk and tech-debt CRUDs stamp. */
const unstamped = <T extends { updatedAt?: string }>(r: T | undefined) =>
  without((r ?? {}) as T, "updatedAt");

// Entities whose store upsert writes the parsed record as is.
const FULL: [toolId: string, slice: keyof Workspace, doc: Doc][] = [
  ["workspace.okr", "okrs", OKR],
  ["workspace.test_pyramid", "testPyramids", TEST_PYRAMID],
  ["workspace.flaky_test_board", "flakyTestBoards", FLAKY_BOARD],
  ["workspace.code_review_log", "codeReviewLogs", CODE_REVIEW_LOG],
  ["workspace.riskiest_assumption", "riskiestAssumptions", RISKIEST],
  ["workspace.hypothesis_tracker", "hypothesisTrackers", HYPOTHESES],
  ["workspace.user_interview_log", "userInterviewLogs", INTERVIEWS],
  ["workspace.opportunity_tree", "opportunityTrees", OPPORTUNITIES],
  ["workspace.nps_response", "npsResponses", NPS],
];

// The two whose CRUD stamps updatedAt on every write.
const STAMPED: [toolId: string, slice: keyof Workspace, doc: Doc][] = [
  ["workspace.risk", "risks", RISK],
  ["workspace.tech_debt", "techDebt", TECH_DEBT],
];

// Rows stored before Phase 8.
const LEGACY: [toolId: string, slice: keyof Workspace, doc: Doc][] = [
  ["workspace.risk", "risks", LEGACY_RISK],
  ["workspace.okr", "okrs", LEGACY_OKR],
  ["workspace.tech_debt", "techDebt", LEGACY_TECH_DEBT],
  ["workspace.test_pyramid", "testPyramids", LEGACY_TEST_PYRAMID],
  ["workspace.riskiest_assumption", "riskiestAssumptions", LEGACY_RISKIEST],
  ["workspace.nps_response", "npsResponses", LEGACY_CSAT],
];

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
  getEntity.mockClear();
});

describe("Phase 8 CRUD schemas keep every field", () => {
  it.each([...FULL, ...STAMPED])("%s parses a full record unchanged", (toolId, _slice, doc) => {
    const parsed = parseCreate(toolId, doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
  });

  it.each(FULL)("%s update keeps every field", async (toolId, slice, doc) => {
    expect(await updateInTab(toolId, slice, doc)).toEqual(doc);
  });

  it.each(STAMPED)("%s update keeps every field but the save stamp", async (toolId, slice, doc) => {
    const stored = (await updateInTab(toolId, slice, doc)) as Risk | TechDebtItem;
    expect(unstamped(stored)).toEqual(unstamped(doc as Risk));
  });

  it.each(LEGACY)(
    "%s still parses and loads a row from before Phase 8",
    async (toolId, slice, doc) => {
      const parsed = parseCreate(toolId, doc);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
      const stored = await updateInTab(toolId, slice, doc);
      expect(unstamped(stored as Risk)).toEqual(doc);
    }
  );

  it("every Phase 8 CRUD create schema converts to JSON Schema", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [toolId] of [...FULL, ...STAMPED]) {
      const json = zodToJsonSchema(action(`${toolId}.create`).paramsSchema);
      expect(json, toolId).toHaveProperty("properties.entity");
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a hand-off link on the new opportunity route is a valid link", () => {
    expect(INTERVIEWS.interviews[0].quotes[0].sentTo?.[0].route).toBe("opportunity");
    accepts("workspace.user_interview_log", INTERVIEWS);
    const bad = structuredClone(INTERVIEWS);
    bad.interviews[0].quotes[0].sentTo = [{ route: "nope" as never, targetId: "x", at: "" }];
    rejects("workspace.user_interview_log", bad);
  });
});

describe("bounds", () => {
  it("a risk rates 1-5 in whole numbers, and its residual rating comes as a pair", () => {
    rejects("workspace.risk", { ...RISK, probability: 6 });
    rejects("workspace.risk", { ...RISK, impact: 2.5 });
    rejects("workspace.risk", { ...RISK, residualProbability: 0 });
    rejects("workspace.risk", without(RISK, "residualImpact"));
    rejects("workspace.risk", without(RISK, "residualProbability"));
    accepts("workspace.risk", without(RISK, "residualProbability", "residualImpact"));
  });

  it("a risk's owner is trimmed and its description capped", () => {
    const parsed = parseCreate("workspace.risk", { ...RISK, owner: "  Priya  " });
    expect((parsed.data as { entity: Risk }).entity.owner).toBe("Priya");
    rejects("workspace.risk", { ...RISK, owner: "x".repeat(121) });
    rejects("workspace.risk", { ...RISK, description: "x".repeat(4001) });
  });

  it("a tech-debt item rates 1-5 and its interest rate isn't negative", () => {
    rejects("workspace.tech_debt", { ...TECH_DEBT, impact: 0 });
    rejects("workspace.tech_debt", { ...TECH_DEBT, effort: 3.5 });
    rejects("workspace.tech_debt", { ...TECH_DEBT, interestRate: -1 });
    accepts("workspace.tech_debt", { ...TECH_DEBT, interestRate: 0 });
  });

  it("a key result's confidence is 0-10, its check-ins dated days and capped", () => {
    const kr = (patch: Partial<KeyResult>): Okr => ({
      ...OKR,
      keyResults: [{ ...OKR.keyResults[0], ...patch }],
    });
    rejects("workspace.okr", kr({ confidence: 11 }));
    rejects("workspace.okr", kr({ confidence: -1 }));
    accepts("workspace.okr", kr({ confidence: 0 }));
    rejects("workspace.okr", kr({ direction: "sideways" as never }));
    rejects("workspace.okr", kr({ baseline: Number.POSITIVE_INFINITY }));
    const day = (date: string) => kr({ checkIns: [{ id: "c", date, value: 1 }] });
    rejects("workspace.okr", day("2026-10-1"));
    rejects("workspace.okr", day("2026-10-01T09:00:00Z"));
    rejects(
      "workspace.okr",
      kr({ checkIns: [{ id: "c", date: "2026-10-01", value: 1, confidence: 12 }] })
    );
    rejects(
      "workspace.okr",
      kr({ checkIns: [{ id: "c", date: "2026-10-01", value: 1, note: "x".repeat(501) }] })
    );
    accepts("workspace.okr", kr({ checkIns: FULL_CHECK_INS }));
    rejects(
      "workspace.okr",
      kr({ checkIns: [...FULL_CHECK_INS, { id: "one-more", date: "2026-10-02", value: 1 }] })
    );
  });

  it("an NPS score is a whole 0-10, a CSAT score a whole 1-5", () => {
    rejects("workspace.nps_response", { ...NPS, score: 11 });
    rejects("workspace.nps_response", { ...NPS, score: 8.5 });
    accepts("workspace.nps_response", { ...NPS, score: 0 });
    rejects("workspace.nps_response", { ...LEGACY_CSAT, score: 0 });
    rejects("workspace.nps_response", { ...LEGACY_CSAT, score: 6 });
    accepts("workspace.nps_response", { ...LEGACY_CSAT, score: 1 });
  });

  it("a response's day is YYYY-MM-DD; a timestamp an older agent stored reads as its day", async () => {
    rejects("workspace.nps_response", { ...NPS, date: "yesterday" });
    rejects("workspace.nps_response", { ...NPS, date: "20/10/2026" });
    const parsed = parseCreate("workspace.nps_response", {
      ...NPS,
      date: "2026-10-20T15:00:00.000Z",
    });
    expect((parsed.data as { entity: typeof NPS }).entity.date).toBe("2026-10-20");
    // An update to such a row heals it instead of failing.
    const timestamped: typeof NPS = { ...LEGACY_CSAT, date: "2026-08-02T10:00:00Z" };
    const stored = await updateInTab("workspace.nps_response", "npsResponses", timestamped);
    expect((stored as typeof NPS).date).toBe("2026-08-02");
  });

  it("a response holds at most 10 tags of 1-40 characters", () => {
    rejects("workspace.nps_response", {
      ...NPS,
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    });
    rejects("workspace.nps_response", { ...NPS, tags: [""] });
    rejects("workspace.nps_response", { ...NPS, tags: ["x".repeat(41)] });
    accepts("workspace.nps_response", {
      ...NPS,
      tags: Array.from({ length: 10 }, (_, i) => `t${i}`),
    });
  });

  it("an assumption's ratings are whole 1-5 or absent (not rated)", () => {
    const one = (patch: Record<string, unknown>) => ({
      ...RISKIEST,
      assumptions: [{ ...RISKIEST.assumptions[0], ...patch }],
    });
    rejects("workspace.riskiest_assumption", one({ riskLevel: 0 }));
    rejects("workspace.riskiest_assumption", one({ evidenceLevel: 2.5 }));
    accepts(
      "workspace.riskiest_assumption",
      one({ riskLevel: undefined, evidenceLevel: undefined })
    );
  });

  it("a hypothesis target has a direction and a finite value", () => {
    const one = (patch: Record<string, unknown>) => ({
      ...HYPOTHESES,
      hypotheses: [{ ...HYPOTHESES.hypotheses[0], ...patch }],
    });
    rejects("workspace.hypothesis_tracker", one({ target: { value: 8 } }));
    rejects("workspace.hypothesis_tracker", one({ target: { direction: "up", value: 8 } }));
    rejects(
      "workspace.hypothesis_tracker",
      one({ target: { direction: "increase", value: Number.NaN } })
    );
    rejects("workspace.hypothesis_tracker", one({ actual: Number.POSITIVE_INFINITY }));
    accepts("workspace.hypothesis_tracker", one({ target: { direction: "decrease", value: 0 } }));
  });

  it("only an opportunity can be its outcome's target", () => {
    const flagged = (kind: string) => ({
      ...OPPORTUNITIES,
      nodes: [{ id: "n", kind, text: "x", parentId: null, target: true }],
    });
    rejects("workspace.opportunity_tree", flagged("solution"));
    rejects("workspace.opportunity_tree", flagged("outcome"));
    accepts("workspace.opportunity_tree", flagged("opportunity"));
  });

  it("weighting a pyramid by runtime needs all three runtimes; counts in snapshots are whole", () => {
    rejects("workspace.test_pyramid", { ...TEST_PYRAMID, runtime: { unit: 4, integration: 11 } });
    rejects("workspace.test_pyramid", { ...TEST_PYRAMID, runtime: undefined });
    accepts("workspace.test_pyramid", {
      ...TEST_PYRAMID,
      weighting: "count",
      runtime: { unit: 4 },
    });
    rejects("workspace.test_pyramid", {
      ...TEST_PYRAMID,
      runtime: { ...TEST_PYRAMID.runtime, e2e: -1 },
    });
    const snap = TEST_PYRAMID.snapshots![0];
    rejects("workspace.test_pyramid", { ...TEST_PYRAMID, snapshots: [{ ...snap, unit: 1.5 }] });
    rejects("workspace.test_pyramid", {
      ...TEST_PYRAMID,
      snapshots: [{ ...snap, takenOn: "July" }],
    });
    rejects("workspace.test_pyramid", { ...TEST_PYRAMID, updatedOn: "2026-10-26T10:00:00Z" });
  });

  it("a flaky test's failures and runs come as a pair, failures no more than runs", () => {
    const test = (patch: Record<string, unknown>) => ({
      ...FLAKY_BOARD,
      tests: [{ ...FLAKY_BOARD.tests[0], ...patch }],
    });
    rejects("workspace.flaky_test_board", test({ failures: 201 }));
    rejects("workspace.flaky_test_board", test({ runs: 0, failures: 0 }));
    rejects("workspace.flaky_test_board", test({ runs: undefined }));
    rejects("workspace.flaky_test_board", test({ failures: 1.5 }));
    rejects("workspace.flaky_test_board", test({ quarantinedAt: "5 Oct" }));
    accepts("workspace.flaky_test_board", test({ failures: 200 }));
  });

  it("a first review is a wall-clock time between the open and the merge", () => {
    const pr = (patch: Record<string, unknown>) => ({
      ...CODE_REVIEW_LOG,
      samples: [{ ...CODE_REVIEW_LOG.samples[0], ...patch }],
    });
    rejects("workspace.code_review_log", pr({ firstReviewAt: "Monday morning" }));
    rejects("workspace.code_review_log", pr({ firstReviewAt: "2026-10-16T16:00" }));
    rejects("workspace.code_review_log", pr({ firstReviewAt: "2026-10-19T14:01" }));
    accepts("workspace.code_review_log", pr({ firstReviewAt: "2026-10-16T16:30" }));
    accepts(
      "workspace.code_review_log",
      pr({ firstReviewAt: "2026-10-19T14:00:00Z", mergedAt: undefined })
    );
  });

  it("a working window is two local HH:MM times, start before end", () => {
    const win = (start: string, end: string) => ({
      ...CODE_REVIEW_LOG,
      workingWindow: { start, end },
    });
    rejects("workspace.code_review_log", win("9:00", "17:00"));
    rejects("workspace.code_review_log", win("17:00", "09:00"));
    rejects("workspace.code_review_log", win("09:00", "09:00"));
    rejects("workspace.code_review_log", win("09:00", "24:00"));
    accepts("workspace.code_review_log", win("00:00", "23:59"));
  });
});

describe("an OKR update keeps the key results' check-ins", () => {
  // The patch an agent sends to retitle one key result: the whole list,
  // each key result as list_state shows it, without its check-ins.
  const retitle = (): { keyResults: KeyResult[] } => ({
    keyResults: OKR.keyResults.map((stored) => {
      const kr = without(stored, "checkIns") as KeyResult;
      return kr.id === "kr_churn" ? { ...kr, title: "Monthly logo churn" } : kr;
    }),
  });

  it("in the tab: a key result sent without checkIns keeps the stored ones", async () => {
    const stored = (await updateInTab("workspace.okr", "okrs", OKR, retitle())) as Okr;
    expect(stored.keyResults[0].title).toBe("Monthly logo churn");
    expect(stored.keyResults[0].checkIns).toEqual(OKR.keyResults[0].checkIns);
    expect(stored.keyResults[1].checkIns).toEqual([]);
  });

  it("over MCP: the same", async () => {
    const written = (await updateOnServer("workspace.okr", OKR, retitle())) as Okr;
    expect(written.keyResults[0].title).toBe("Monthly logo churn");
    expect(written.keyResults[0].checkIns).toEqual(OKR.keyResults[0].checkIns);
  });

  it("checkIns sent (even []) are what's saved; a new key result has none to keep", async () => {
    const patch = {
      keyResults: [
        { ...OKR.keyResults[0], checkIns: [] },
        { id: "kr_new", title: "Win-backs", target: 10, current: 0 },
      ],
    };
    const stored = (await updateInTab("workspace.okr", "okrs", OKR, patch)) as Okr;
    expect(stored.keyResults[0].checkIns).toEqual([]);
    expect(stored.keyResults[1]).toEqual(patch.keyResults[1]);
    expect(stored.keyResults).toHaveLength(2);
  });

  it("a create keeps what it was given", async () => {
    const rest = without(OKR, "id");
    const result = (await action("workspace.okr.create").handler(
      { entity: structuredClone(rest) },
      makeContext("u", "agent")
    )) as { id: string };
    expect(useWorkspaceStore.getState().okrs.find((o) => o.id === result.id)).toEqual({
      ...rest,
      id: result.id,
    });
  });
});

describe("the risk and tech-debt CRUDs stamp updatedAt", () => {
  const isFresh = (stamp: string | undefined, before: number) => {
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(stamp as string)).toBeGreaterThanOrEqual(before);
  };

  it.each([
    ["workspace.risk", "risks", LEGACY_RISK],
    ["workspace.tech_debt", "techDebt", LEGACY_TECH_DEBT],
  ] as const)(
    "%s create, in the tab and over MCP, a given value ignored",
    async (toolId, slice, doc) => {
      const before = Date.now() - 1;
      const entity = { ...doc, updatedAt: "2000-01-01T00:00:00.000Z" };
      await action(`${toolId}.create`).handler(
        { entity: { ...entity } },
        makeContext("u", "agent")
      );
      const inTab = (useWorkspaceStore.getState()[slice] as (Risk | TechDebtItem)[])[0];
      isFresh(inTab.updatedAt, before);
      expect(unstamped(inTab)).toEqual(doc);

      await action(`${toolId}.create`).mcpHandler!(
        { entity: { ...entity } },
        makeContext("u", "mcp")
      );
      const onServer = upsertEntity.mock.calls[0][2] as Risk | TechDebtItem;
      isFresh(onServer.updatedAt, before);
      expect(unstamped(onServer)).toEqual(doc);
    }
  );

  it.each([
    ["workspace.risk", "risks", LEGACY_RISK, { status: "closed", resolvedAt: "2026-10-20" }],
    ["workspace.tech_debt", "techDebt", LEGACY_TECH_DEBT, { area: "logging" }],
  ] as const)("%s update, in the tab and over MCP", async (toolId, slice, doc, patch) => {
    const before = Date.now() - 1;
    const inTab = (await updateInTab(toolId, slice, doc, patch)) as Risk | TechDebtItem;
    isFresh(inTab.updatedAt, before);
    expect(unstamped(inTab)).toEqual({ ...doc, ...patch });

    const onServer = (await updateOnServer(toolId, doc, patch)) as Risk | TechDebtItem;
    isFresh(onServer.updatedAt, before);
    expect(unstamped(onServer)).toEqual({ ...doc, ...patch });
  });

  it("a stored stamp is replaced by the new save's", async () => {
    const stored = (await updateInTab("workspace.risk", "risks", RISK, {
      title: "Renamed",
    })) as Risk;
    expect(stored.updatedAt).not.toBe(RISK.updatedAt);
    expect(stored.title).toBe("Renamed");
  });
});

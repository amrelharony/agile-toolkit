/**
 * The workspace.* CRUD schemas for the Outcomes, quality & library tools
 * keep every Phase 8 field. `update` validates the merged record and writes
 * what the schema parsed, and z.object drops keys it doesn't know, so a
 * field missing from a schema would be erased by every agent update.
 *
 * Also: rows stored before Phase 8 still parse and load; the bounds the new
 * fields bring, and the tightened bounds judged on what a write sets (a
 * stored value off them stays editable around); the OKR update keeping a
 * key result's check-ins when a keyResults patch leaves them out; and the
 * risk and tech-debt CRUDs stamping updatedAt on both transports.
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
    // The risk and tech-debt CRUDs read the old page blobs (none here).
    serverGetUserStateBlob: vi.fn(async () => null),
  };
});

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  KeyResult,
  NpsResponse,
  Okr,
  Risk,
  RiskiestAssumption,
  TechDebtItem,
  Workspace,
} from "@/lib/stores/workspace-types";
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

/** OKR with churn's current on its newest check-in (17), as tool.okrs.check_in keeps it. */
const CHECKED_IN: Okr = {
  ...OKR,
  keyResults: [{ ...OKR.keyResults[0], current: 17 }, OKR.keyResults[1]],
};

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

/**
 * A create the schema lets through (params parsed as the transport parses
 * them) but the CRUD's prepare refuses, on both transports, writing nothing.
 */
async function refusesCreate(
  toolId: string,
  slice: keyof Workspace,
  entity: unknown,
  message: RegExp
) {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
  const parsed = parseCreate(toolId, structuredClone(entity));
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  const params = parsed.data as { entity: Doc };
  await expect(
    action(`${toolId}.create`).handler(structuredClone(params), makeContext("u", "agent"))
  ).rejects.toThrow(message);
  await expect(
    action(`${toolId}.create`).mcpHandler!(structuredClone(params), makeContext("u", "mcp"))
  ).rejects.toThrow(message);
  expect(useWorkspaceStore.getState()[slice] ?? []).toEqual([]);
  expect(upsertEntity).not.toHaveBeenCalled();
}

/** A create both transports save. */
async function savesCreate(toolId: string, slice: keyof Workspace, entity: unknown) {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
  const parsed = parseCreate(toolId, structuredClone(entity));
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  const params = parsed.data as { entity: Doc };
  await action(`${toolId}.create`).handler(structuredClone(params), makeContext("u", "agent"));
  await action(`${toolId}.create`).mcpHandler!(structuredClone(params), makeContext("u", "mcp"));
  expect(useWorkspaceStore.getState()[slice] as Doc[]).toHaveLength(1);
  expect(upsertEntity).toHaveBeenCalledTimes(1);
}

/** An update both transports refuse: the stored row is left as it was. */
async function refusesUpdate(
  toolId: string,
  slice: keyof Workspace,
  doc: Doc,
  patch: Record<string, unknown>,
  message: RegExp
) {
  upsertEntity.mockClear();
  useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
  await expect(
    action(`${toolId}.update`).handler({ id: doc.id, patch }, makeContext("u", "agent"))
  ).rejects.toThrow(message);
  expect(useWorkspaceStore.getState()[slice]).toEqual([doc]);
  getEntity.mockResolvedValueOnce(structuredClone(doc) as never);
  await expect(
    action(`${toolId}.update`).mcpHandler!({ id: doc.id, patch }, makeContext("u", "mcp"))
  ).rejects.toThrow(message);
  expect(upsertEntity).not.toHaveBeenCalled();
}

/** Update `doc` with `patch` on both transports and return [in the tab, over MCP]. */
async function updateOnBoth(toolId: string, slice: keyof Workspace, doc: Doc, patch = {}) {
  const inTab = await updateInTab(toolId, slice, doc, structuredClone(patch));
  upsertEntity.mockClear();
  const onServer = await updateOnServer(toolId, doc, structuredClone(patch));
  return [inTab, onServer];
}

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
  it("a risk's write rates it 1-5 in whole numbers, on both transports", async () => {
    await refusesCreate("workspace.risk", "risks", { ...RISK, probability: 6 }, /probability/);
    await refusesCreate("workspace.risk", "risks", { ...RISK, impact: 2.5 }, /impact: a whole/);
    await savesCreate("workspace.risk", "risks", { ...RISK, probability: 1, impact: 5 });
  });

  it("a risk's residual rating is 1-5 and comes as a pair", () => {
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

  it("a tech-debt item's write rates it 1-5 and its interest rate 0-100", async () => {
    const td = "workspace.tech_debt";
    await refusesCreate(td, "techDebt", { ...TECH_DEBT, impact: 0 }, /impact: a whole/);
    await refusesCreate(td, "techDebt", { ...TECH_DEBT, effort: 3.5 }, /effort: a whole/);
    await refusesCreate(td, "techDebt", { ...TECH_DEBT, interestRate: -1 }, /interestRate/);
    await refusesCreate(td, "techDebt", { ...TECH_DEBT, interestRate: 101 }, /interestRate/);
    await savesCreate(td, "techDebt", { ...TECH_DEBT, interestRate: 0 });
    await savesCreate(td, "techDebt", without(TECH_DEBT, "interestRate"));
  });

  it("a key result's confidence is 0-10 on write, on both transports", async () => {
    // Without check-ins: with one scored, confidence is the newest scored one's.
    const kr = (patch: Partial<KeyResult>): Okr => ({
      ...OKR,
      keyResults: [{ ...(without(OKR.keyResults[0], "checkIns") as KeyResult), ...patch }],
    });
    await refusesCreate("workspace.okr", "okrs", kr({ confidence: 11 }), /confidence is from 0/);
    await refusesCreate("workspace.okr", "okrs", kr({ confidence: -1 }), /kr_churn: confidence/);
    await savesCreate("workspace.okr", "okrs", kr({ confidence: 0 }));
    await savesCreate("workspace.okr", "okrs", kr({ confidence: undefined }));
  });

  it("a key result's direction and baseline, its check-ins dated days and capped", () => {
    const kr = (patch: Partial<KeyResult>): Okr => ({
      ...OKR,
      keyResults: [{ ...OKR.keyResults[0], ...patch }],
    });
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

  it("an NPS score written is a whole 0-10, a CSAT score a whole 1-5", async () => {
    const nps = "workspace.nps_response";
    await refusesCreate(nps, "npsResponses", { ...NPS, score: 11 }, /an NPS score is a whole/);
    await refusesCreate(nps, "npsResponses", { ...NPS, score: 8.5 }, /0 to 10/);
    await savesCreate(nps, "npsResponses", { ...NPS, score: 0 });
    await refusesCreate(nps, "npsResponses", { ...LEGACY_CSAT, score: 0 }, /a CSAT score/);
    await refusesCreate(nps, "npsResponses", { ...LEGACY_CSAT, score: 6 }, /1 to 5/);
    await savesCreate(nps, "npsResponses", { ...LEGACY_CSAT, score: 1 });
  });

  it("a response's day written is YYYY-MM-DD; a timestamp an older agent stored reads as its day", async () => {
    const nps = "workspace.nps_response";
    await refusesCreate(nps, "npsResponses", { ...NPS, date: "yesterday" }, /date: the day/);
    await refusesCreate(nps, "npsResponses", { ...NPS, date: "20/10/2026" }, /YYYY-MM-DD/);
    await refusesCreate(nps, "npsResponses", { ...NPS, date: "" }, /YYYY-MM-DD/);
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

  it("tags a write sets are stored as the page and record store them: lower-case, once each", async () => {
    const nps = "workspace.nps_response";
    // A create, in the tab and over MCP.
    const typed = { ...NPS, tags: ["Pricing", " pricing ", "Slow  Support"] };
    await savesCreate(nps, "npsResponses", typed);
    expect(useWorkspaceStore.getState().npsResponses?.[0].tags).toEqual([
      "pricing",
      "slow support",
    ]);
    expect((upsertEntity.mock.calls[0][2] as NpsResponse).tags).toEqual([
      "pricing",
      "slow support",
    ]);
    // An update, on both transports.
    for (const row of await updateOnBoth(nps, "npsResponses", LEGACY_CSAT, {
      tags: ["Onboarding", "ONBOARDING"],
    })) {
      expect((row as NpsResponse).tags).toEqual(["onboarding"]);
    }
    // Nothing left once normalised: the key goes.
    for (const row of await updateOnBoth(nps, "npsResponses", NPS, { tags: [" "] })) {
      expect(row).toEqual(without(NPS, "tags"));
    }
    // One comma-separated string counts each tag it holds.
    await refusesUpdate(
      nps,
      "npsResponses",
      LEGACY_CSAT,
      { tags: [Array.from({ length: 11 }, (_, i) => `t${i}`).join(",")] },
      /tags: At most 10 tags on a response \(11 given\)/
    );
    // Stored tags a write leaves alone stay as they are.
    const odd = { ...LEGACY_CSAT, tags: ["Pricing"] };
    for (const row of await updateOnBoth(nps, "npsResponses", odd, { score: 5 })) {
      expect(row).toEqual({ ...odd, score: 5 });
    }
  });

  it("an assumption's ratings written are whole 1-5 or absent (not rated)", async () => {
    const ra = "workspace.riskiest_assumption";
    const one = (patch: Record<string, unknown>) => ({
      ...RISKIEST,
      assumptions: [{ ...RISKIEST.assumptions[0], ...patch }],
    });
    await refusesCreate(ra, "riskiestAssumptions", one({ riskLevel: 0 }), /as_1: riskLevel/);
    await refusesCreate(ra, "riskiestAssumptions", one({ evidenceLevel: 2.5 }), /evidenceLevel/);
    await savesCreate(ra, "riskiestAssumptions", one({ riskLevel: undefined, evidenceLevel: 1 }));
    await savesCreate(
      ra,
      "riskiestAssumptions",
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

describe("a stored value off the new bounds stays editable around", () => {
  // Rows the pages and the old loose schemas saved before Phase 8.
  const FRACTIONAL_NPS = { id: "nps_old1", kind: "nps", date: "", score: 7.5 } as NpsResponse;
  const ODD_CSAT = {
    id: "nps_old2",
    kind: "csat",
    date: "last Tuesday",
    score: 8,
    verbatim: "Fine",
  } as NpsResponse;
  const HALF_DEBT = {
    ...LEGACY_TECH_DEBT,
    impact: 2.5,
    interestRate: -1,
  } as unknown as TechDebtItem;
  const ODD_RISK = { ...LEGACY_RISK, probability: 6, impact: 0 } as unknown as Risk;
  const ODD_KR = {
    ...LEGACY_OKR,
    keyResults: [{ ...LEGACY_OKR.keyResults[0], confidence: 70 }],
  } as Okr;
  const ODD_CANVAS = {
    ...LEGACY_RISKIEST,
    assumptions: [{ ...LEGACY_RISKIEST.assumptions[0], riskLevel: 2.5 }],
  } as unknown as RiskiestAssumption;

  it("an NPS row with a fraction and a blank date takes tags, in the tab and over MCP", async () => {
    const patch = { tags: ["pricing"] };
    for (const row of await updateOnBoth(
      "workspace.nps_response",
      "npsResponses",
      FRACTIONAL_NPS,
      patch
    )) {
      expect(row).toEqual({ ...FRACTIONAL_NPS, ...patch });
    }
    for (const row of await updateOnBoth(
      "workspace.nps_response",
      "npsResponses",
      ODD_CSAT,
      patch
    )) {
      expect(row).toEqual({ ...ODD_CSAT, ...patch });
    }
  });

  it("a patch re-sending the stored values (a row echoed from list) isn't judged", async () => {
    const echo = { ...FRACTIONAL_NPS, tags: ["onboarding"] };
    const [inTab, onServer] = await updateOnBoth(
      "workspace.nps_response",
      "npsResponses",
      FRACTIONAL_NPS,
      echo
    );
    expect(inTab).toEqual(echo);
    expect(onServer).toEqual(echo);
  });

  it("a patch that sets a score, a kind or a date off the bounds is refused", async () => {
    const nps = "workspace.nps_response";
    await refusesUpdate(nps, "npsResponses", FRACTIONAL_NPS, { score: 8.5 }, /0 to 10/);
    await refusesUpdate(nps, "npsResponses", ODD_CSAT, { kind: "nps", score: 11 }, /NPS score/);
    // Turning the CSAT 8 into an NPS row re-reads its score, which fits.
    const [asNps] = await updateOnBoth(nps, "npsResponses", ODD_CSAT, { kind: "nps" });
    expect(asNps).toMatchObject({ kind: "nps", score: 8 });
    await refusesUpdate(nps, "npsResponses", FRACTIONAL_NPS, { date: "soon" }, /date: the day/);
    const [dated] = await updateOnBoth(nps, "npsResponses", FRACTIONAL_NPS, {
      date: "2026-10-20",
      score: 8,
    });
    expect(dated).toMatchObject({ date: "2026-10-20", score: 8 });
  });

  it("a tech-debt item with a 2.5 impact updates through another field", async () => {
    const before = Date.now() - 1;
    for (const row of await updateOnBoth("workspace.tech_debt", "techDebt", HALF_DEBT, {
      area: "logging",
    })) {
      expect(unstamped(row as TechDebtItem)).toEqual({ ...HALF_DEBT, area: "logging" });
      expect(Date.parse((row as TechDebtItem).updatedAt as string)).toBeGreaterThanOrEqual(before);
    }
    await refusesUpdate("workspace.tech_debt", "techDebt", HALF_DEBT, { impact: 3.5 }, /impact/);
    await refusesUpdate(
      "workspace.tech_debt",
      "techDebt",
      HALF_DEBT,
      { interestRate: -2 },
      /interestRate/
    );
  });

  it("a risk rated off the scale updates through another field", async () => {
    for (const row of await updateOnBoth("workspace.risk", "risks", ODD_RISK, {
      status: "closed",
    })) {
      expect(unstamped(row as Risk)).toEqual({ ...ODD_RISK, status: "closed" });
    }
    await refusesUpdate("workspace.risk", "risks", ODD_RISK, { impact: 9 }, /impact: a whole/);
  });

  it("an OKR whose key result holds confidence 70 takes a new objective", async () => {
    for (const row of await updateOnBoth("workspace.okr", "okrs", ODD_KR, {
      objective: "Ship it",
    })) {
      expect(row).toEqual({ ...ODD_KR, objective: "Ship it" });
    }
    const rescored = { keyResults: [{ ...ODD_KR.keyResults[0], confidence: 75 }] };
    await refusesUpdate("workspace.okr", "okrs", ODD_KR, rescored, /kr_a: confidence/);
  });

  it("one assumption rated 2.5 doesn't block the canvas: another can be added", async () => {
    const added = {
      assumptions: [
        ...ODD_CANVAS.assumptions,
        { id: "as_new", statement: "Admins read release notes", status: "untested" },
      ],
    };
    for (const row of await updateOnBoth(
      "workspace.riskiest_assumption",
      "riskiestAssumptions",
      ODD_CANVAS,
      added
    )) {
      expect(row).toEqual({ ...ODD_CANVAS, ...added });
    }
    const badNew = {
      assumptions: [
        ...ODD_CANVAS.assumptions,
        { id: "as_new", statement: "x", status: "untested", riskLevel: 7 },
      ],
    };
    await refusesUpdate(
      "workspace.riskiest_assumption",
      "riskiestAssumptions",
      ODD_CANVAS,
      badNew,
      /as_new: riskLevel/
    );
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
    // Churn's current is its newest check-in's (17), as check_in keeps it.
    const rest = without(CHECKED_IN, "id");
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

describe("an OKR write keeps current and confidence on the newest check-in", () => {
  // Churn is checked in at 19, 18 (scored 6) and 17: current 17, confidence 6.
  const churn = CHECKED_IN.keyResults[0];
  const withChurn = (patch: Partial<KeyResult>) => ({
    keyResults: [{ ...churn, ...patch }, CHECKED_IN.keyResults[1]],
  });

  it("a current set apart from the check-ins is refused on both transports, pointing to check_in", async () => {
    // Sent without checkIns, as list_state shows a key result: the stored ones are kept.
    const typed = withChurn({ current: 60 });
    delete typed.keyResults[0].checkIns;
    await refusesUpdate(
      "workspace.okr",
      "okrs",
      CHECKED_IN,
      typed,
      /kr_churn: current is its newest check-in's value \(17\); record a new value with tool\.okrs\.check_in/
    );
    await refusesUpdate(
      "workspace.okr",
      "okrs",
      CHECKED_IN,
      withChurn({ confidence: 9 }),
      /kr_churn: confidence is its newest scored check-in's \(6\)/
    );
    await refusesCreate(
      "workspace.okr",
      "okrs",
      { ...CHECKED_IN, keyResults: [{ ...churn, current: 60 }] },
      /kr_churn: current is its newest check-in's value/
    );
  });

  it("check-ins sent out of order are stored oldest first, current and confidence from the newest", async () => {
    const [c1, c2, c3] = churn.checkIns!;
    const added = { id: "ci_4", date: "2026-10-04", value: 16, confidence: 7 };
    // A new check-in sent first, with current and confidence left as they were.
    for (const row of await updateOnBoth(
      "workspace.okr",
      "okrs",
      CHECKED_IN,
      withChurn({ checkIns: [added, c3, c1, c2] })
    )) {
      const kr = (row as Okr).keyResults[0];
      expect(kr.checkIns!.map((c) => c.id)).toEqual(["ci_1", "ci_2", "ci_3", "ci_4"]);
      expect(kr).toMatchObject({ current: 16, confidence: 7 });
    }
    // A backdated one older than the newest joins without changing current.
    const backdated = { id: "ci_0", date: "2026-09-30", value: 21 };
    for (const row of await updateOnBoth(
      "workspace.okr",
      "okrs",
      CHECKED_IN,
      withChurn({ checkIns: [...churn.checkIns!, backdated] })
    )) {
      expect((row as Okr).keyResults[0]).toMatchObject({ current: 17, confidence: 6 });
      expect((row as Okr).keyResults[0].checkIns![0].id).toBe("ci_0");
    }
  });

  it("a confidence left out comes back from the scored check-in; the value sent with a check-in is taken", async () => {
    const unscored = withChurn({});
    delete unscored.keyResults[0].confidence;
    for (const row of await updateOnBoth("workspace.okr", "okrs", CHECKED_IN, unscored)) {
      expect((row as Okr).keyResults[0].confidence).toBe(6);
    }
    const added = { id: "ci_4", date: "2026-10-04", value: 16 };
    for (const row of await updateOnBoth(
      "workspace.okr",
      "okrs",
      CHECKED_IN,
      withChurn({ current: 16, checkIns: [...churn.checkIns!, added] })
    )) {
      expect((row as Okr).keyResults[0]).toMatchObject({ current: 16, confidence: 6 });
    }
  });

  it("a key result with no check-in takes any current; one the write leaves alone stays as stored", async () => {
    const [nps] = await updateOnBoth("workspace.okr", "okrs", CHECKED_IN, {
      keyResults: [churn, { ...CHECKED_IN.keyResults[1], current: 35 }],
    });
    expect((nps as Okr).keyResults[1].current).toBe(35);
    // The shared fixture holds churn at 18 beside a newest check-in of 17
    // (stored before this rule): a retitle leaves it as it is.
    for (const row of await updateOnBoth("workspace.okr", "okrs", OKR, {
      objective: "Keep customers",
    })) {
      expect(row).toEqual({ ...OKR, objective: "Keep customers" });
    }
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

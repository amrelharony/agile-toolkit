/**
 * Flaky Test Scoreboard — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     Log of flaky tests: failures out of runs, quarantine status and
 *           how long it has lasted, owner.
 *
 * Agent surface: tool.flaky_tests.*
 * Backing CRUD : workspace.flaky_test_board.* (auto-generated). Singleton:
 *                one FlakyTestBoard document (tests[]) under a fixed id.
 *
 *   1. list_state   — totals, byStatus, the weighted failure rate, long
 *                     quarantines, worst offenders (open tests), the verdict.
 *   2. add_test     — log a flaky test from failures and runs (or a bare
 *                     rate), first seen today unless backdated.
 *   3. update_test  — edit a test's name, suite, owner, counts, description
 *                     or first-seen day.
 *   4. set_status   — active | quarantined | fixed, by the page's one rule.
 *   5. remove_test  — delete a test.
 *
 * The rates and the status rule live in lib/quality/flaky, which the page
 * reads too, and FLAKY_BOARD_KIND + FLAKY_BOARD_ID match the page, so MCP
 * writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { FlakyStatus, FlakyTest, FlakyTestBoard } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  FLAKY_BOARD_ID,
  FLAKY_BOARD_KIND,
  FLAKY_DESCRIPTION_MAX,
  FLAKY_NAME_MAX,
  FLAKY_OWNER_MAX,
  FLAKY_STATUSES,
  FLAKY_SUITE_MAX,
  applyFlakyStatus,
  flakyDayError,
  flakySummary,
  flakyTestErrors,
  flakyVerdict,
  withRunCounts,
} from "@/lib/quality/flaky";

const StatusSchema = z.enum(FLAKY_STATUSES as [FlakyStatus, ...FlakyStatus[]]);

const ws = () => useWorkspaceStore.getState();

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round3OrNull = (n: number | null) => (n === null ? null : round3(n));

/** Where the board lives: the browser's workspace, or the user's rows on the server. */
interface FlakyStore {
  getDoc(): Promise<FlakyTestBoard | null>;
  putDoc(doc: FlakyTestBoard): Promise<void>;
}

const browserStore: FlakyStore = {
  getDoc: async () => (ws().flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID) ?? null,
  putDoc: async (doc) => ws().upsertFlakyTestBoard(doc),
};

function serverStore(userId: string): FlakyStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<FlakyTestBoard>(userId, FLAKY_BOARD_KIND, FLAKY_BOARD_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<FlakyTestBoard>(userId, FLAKY_BOARD_KIND, doc);
    },
  };
}

const testsOf = (doc: FlakyTestBoard | null) => (Array.isArray(doc?.tests) ? doc.tests : []);

/** The first error of a draft as "field: message", for an agent. */
const firstError = (errors: Partial<Record<string, string>>) => {
  const field = Object.keys(errors).find((k) => errors[k]);
  return field ? `${field}: ${errors[field]}` : null;
};

function summarize(doc: FlakyTestBoard | null) {
  const tests = testsOf(doc);
  const s = flakySummary(tests, todayLocalISO());
  return {
    exists: doc !== null,
    total: s.total,
    byStatus: s.byStatus,
    fixedThisQuarter: s.fixedThisQuarter,
    // The plain mean of the open tests' rates, legacy rows included (kept for older agents).
    avgFailureRate: round3OrNull(s.meanRate),
    weightedFailureRate: {
      rate: round3OrNull(s.weighted.rate),
      failures: s.weighted.failures,
      runs: s.weighted.runs,
      rateOnly: s.weighted.rateOnly,
    },
    highRateCount: s.highRate,
    fewRunsCount: s.fewRuns,
    longQuarantined: s.longQuarantined,
    quarantineDateUnknown: s.quarantineDateUnknown,
    worstOffenders: s.worstOffenders.map((o) => ({ ...o, failureRate: round3(o.failureRate) })),
    verdict: flakyVerdict(s),
    tests,
  };
}

// ──────── tool.flaky_tests.list_state ────────
registry.register({
  id: "tool.flaky_tests.list_state",
  toolId: "tool.flaky_tests",
  name: "list_state",
  category: "read",
  description:
    "Summarise the flaky-test scoreboard; 'open' means active or quarantined (fixed tests are out of every rate and ranking). Returns {exists, total, byStatus: {active, quarantined, fixed}, fixedThisQuarter, avgFailureRate (plain mean of the open tests' rates, null without any), weightedFailureRate: {rate (Σ failures ÷ Σ runs over open tests with run counts, null without), failures, runs, rateOnly (open tests with only a rate, left out)}, highRateCount (open, rate above 0.2), fewRunsCount (open, under 10 runs), longQuarantined: {id, name, days}[] (quarantined 14 days or more), quarantineDateUnknown, worstOffenders: {id, name, status, failureRate, failures, runs, fewRuns}[] (top 5 open), verdict, tests}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.getDoc()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).getDoc()),
});

// ──────── tool.flaky_tests.add_test ────────

const Day = z.string().describe("YYYY-MM-DD, never after today.");

const AddParams = z.object({
  name: z.string().trim().min(1).max(FLAKY_NAME_MAX),
  failures: z.number().int().min(0).optional().describe("Failed runs in the window; with runs."),
  runs: z.number().int().min(1).optional().describe("Runs in that window, at least failures."),
  failureRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("0..1, only for a test without run counts; failures and runs win when given."),
  status: StatusSchema.optional().describe("Defaults to 'active'."),
  suite: z.string().trim().max(FLAKY_SUITE_MAX).optional(),
  owner: z.string().trim().max(FLAKY_OWNER_MAX).optional(),
  description: z.string().trim().max(FLAKY_DESCRIPTION_MAX).optional(),
  firstSeenAt: Day.optional().describe("YYYY-MM-DD; defaults to today; never after today."),
  quarantinedAt: Day.optional().describe(
    "For status 'quarantined': the day it went in; defaults to today."
  ),
  fixedAt: Day.optional().describe("For status 'fixed': the day it was fixed; defaults to today."),
});

type AddResult =
  | { added: true; id: string }
  | {
      added: false;
      reason: "invalid_runs" | "missing_rate" | "invalid_date";
      message: string;
    };

async function addTest(store: FlakyStore, params: z.infer<typeof AddParams>): Promise<AddResult> {
  const today = todayLocalISO();
  const hasRuns = params.failures !== undefined || params.runs !== undefined;
  if (hasRuns) {
    const error = firstError(
      flakyTestErrors({ name: params.name, failures: params.failures, runs: params.runs }, today)
    );
    if (error) return { added: false, reason: "invalid_runs", message: error };
  } else if (params.failureRate === undefined) {
    return {
      added: false,
      reason: "missing_rate",
      message: "Give failures and runs (or a failureRate for a test without run counts).",
    };
  }
  const firstSeenAt = params.firstSeenAt?.trim() || today;
  const status = params.status ?? "active";
  const statusDay =
    status === "quarantined"
      ? params.quarantinedAt?.trim() || today
      : status === "fixed"
        ? params.fixedAt?.trim() || today
        : null;
  for (const [field, day] of [
    ["firstSeenAt", firstSeenAt],
    [status === "fixed" ? "fixedAt" : "quarantinedAt", statusDay],
  ] as const) {
    if (day === null) continue;
    const error = flakyDayError(day, today);
    if (error) return { added: false, reason: "invalid_date", message: `${field}: ${error}` };
  }
  if (statusDay !== null && statusDay < firstSeenAt) {
    return {
      added: false,
      reason: "invalid_date",
      message: `${status === "fixed" ? "fixedAt" : "quarantinedAt"}: It can't come before firstSeenAt.`,
    };
  }
  let test: FlakyTest = {
    id: crypto.randomUUID(),
    name: params.name,
    failureRate: params.failureRate ?? 0,
    status,
    firstSeenAt,
    ...(params.suite ? { suite: params.suite } : {}),
    ...(params.owner ? { owner: params.owner } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(status === "quarantined" && statusDay ? { quarantinedAt: statusDay } : {}),
    ...(status === "fixed" && statusDay ? { fixedAt: statusDay } : {}),
  };
  if (params.failures !== undefined && params.runs !== undefined) {
    test = withRunCounts(test, params.failures, params.runs);
  }
  const base = await store.getDoc();
  await store.putDoc({ ...(base ?? {}), id: FLAKY_BOARD_ID, tests: [...testsOf(base), test] });
  return { added: true, id: test.id };
}

registry.register({
  id: "tool.flaky_tests.add_test",
  toolId: "tool.flaky_tests",
  name: "add_test",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a flaky test from failures out of runs (failureRate is then failures ÷ runs); a bare failureRate (0..1) is for a test without run counts. status defaults to 'active'; firstSeenAt to today (backdatable); a quarantined or fixed test gets quarantinedAt or fixedAt (today unless given). Creates the board if absent. Returns {added: true, id}, or {added: false, reason: 'invalid_runs' | 'missing_rate' | 'invalid_date', message}.",
  paramsSchema: AddParams,
  handler: async (params) => addTest(browserStore, params),
  mcpHandler: async (params, ctx) => addTest(serverStore(ctx.userId), params),
});

// ──────── tool.flaky_tests.update_test ────────

const UpdateParams = z.object({
  testId: z.string().min(1),
  patch: z
    .object({
      name: z.string().trim().min(1).max(FLAKY_NAME_MAX).optional(),
      suite: z.string().trim().max(FLAKY_SUITE_MAX).nullable().optional(),
      owner: z.string().trim().max(FLAKY_OWNER_MAX).nullable().optional(),
      failures: z.number().int().min(0).optional(),
      runs: z.number().int().min(1).optional(),
      description: z.string().trim().max(FLAKY_DESCRIPTION_MAX).nullable().optional(),
      firstSeenAt: Day.optional(),
    })
    .describe(
      "Fields to change; null or blank clears suite, owner or description. failures and runs are checked together with the stored ones. Status goes through set_status."
    ),
});

async function updateTest(store: FlakyStore, params: z.infer<typeof UpdateParams>) {
  const doc = await store.getDoc();
  const current = testsOf(doc).find((t) => t.id === params.testId);
  if (!doc || !current) return { updated: false, reason: "not_found" as const };
  const p = params.patch;
  const today = todayLocalISO();
  let next: FlakyTest = { ...current };
  if (p.name !== undefined) next.name = p.name;
  for (const field of ["suite", "owner", "description"] as const) {
    const v = p[field];
    if (v === undefined) continue;
    if (v) next[field] = v;
    else delete next[field];
  }
  if (p.firstSeenAt !== undefined) {
    const day = p.firstSeenAt.trim();
    const error = day ? flakyDayError(day, today) : "Enter a date as YYYY-MM-DD.";
    if (error) {
      return { updated: false, reason: "invalid_date" as const, message: `firstSeenAt: ${error}` };
    }
    next.firstSeenAt = day;
  }
  if (p.failures !== undefined || p.runs !== undefined) {
    const failures = p.failures ?? current.failures;
    const runs = p.runs ?? current.runs;
    const error = firstError(flakyTestErrors({ name: next.name, failures, runs }, today));
    if (error) return { updated: false, reason: "invalid_runs" as const, message: error };
    next = withRunCounts(next, failures as number, runs as number);
  }
  await store.putDoc({
    ...doc,
    tests: testsOf(doc).map((t) => (t.id === current.id ? next : t)),
  });
  return { updated: true };
}

registry.register({
  id: "tool.flaky_tests.update_test",
  toolId: "tool.flaky_tests",
  name: "update_test",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit a flaky test: name, suite, owner, failures, runs, description or firstSeenAt (YYYY-MM-DD, never after today). failures and runs keep failureRate equal to failures ÷ runs; a test without run counts needs both. Returns {updated: true}, or {updated: false, reason: 'not_found' | 'invalid_runs' | 'invalid_date', message?}.",
  paramsSchema: UpdateParams,
  handler: async (params) => updateTest(browserStore, params),
  mcpHandler: async (params, ctx) => updateTest(serverStore(ctx.userId), params),
});

// ──────── tool.flaky_tests.set_status ────────

const StatusParams = z.object({ testId: z.string(), status: StatusSchema });

async function setStatus(store: FlakyStore, params: z.infer<typeof StatusParams>) {
  const doc = await store.getDoc();
  const current = testsOf(doc).find((t) => t.id === params.testId);
  if (!doc || !current) return { updated: false };
  const next = applyFlakyStatus(current, params.status, todayLocalISO());
  if (next !== current) {
    await store.putDoc({
      ...doc,
      tests: testsOf(doc).map((t) => (t.id === current.id ? next : t)),
    });
  }
  return {
    updated: true,
    status: next.status,
    fixedAt: next.fixedAt ?? null,
    quarantinedAt: next.quarantinedAt ?? null,
  };
}

registry.register({
  id: "tool.flaky_tests.set_status",
  toolId: "tool.flaky_tests",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a flaky test's status (active | quarantined | fixed), as the page does: going into quarantine stamps quarantinedAt with today (leaving clears it); becoming fixed stamps fixedAt with today, and reopening keeps it; the same status changes nothing. Returns {updated: true, status, fixedAt, quarantinedAt}, or {updated: false} when the test id is unknown.",
  paramsSchema: StatusParams,
  handler: async (params) => setStatus(browserStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params),
});

// ──────── tool.flaky_tests.remove_test ────────

const RemoveParams = z.object({ testId: z.string().min(1) });

async function removeTest(store: FlakyStore, params: z.infer<typeof RemoveParams>) {
  const doc = await store.getDoc();
  if (!doc || !testsOf(doc).some((t) => t.id === params.testId)) {
    return { removed: false, reason: "not_found" as const };
  }
  await store.putDoc({ ...doc, tests: testsOf(doc).filter((t) => t.id !== params.testId) });
  return { removed: true };
}

registry.register({
  id: "tool.flaky_tests.remove_test",
  toolId: "tool.flaky_tests",
  name: "remove_test",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a flaky test by id. Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: RemoveParams,
  handler: async (params) => removeTest(browserStore, params),
  mcpHandler: async (params, ctx) => removeTest(serverStore(ctx.userId), params),
});

/**
 * Flaky Test Scoreboard — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     Manual log of flaky tests with quarantine status, failure rate,
 *           and owner.
 *
 * Agent surface: tool.flaky_tests.*
 * Backing CRUD : workspace.flaky_test_board.* (auto-generated). Singleton:
 *                one FlakyTestBoard document (tests[]) under a fixed id.
 *
 *   1. list_state  — totals + byStatus + avg failure rate (active) + worst
 *                    offenders.
 *   2. add_test    — log a flaky test (firstSeenAt → today, status → active).
 *   3. set_status  — active | quarantined | fixed; stamps fixedAt on "fixed".
 *
 * Entity kind "workspace:flakyTestBoard" + the fixed FB_ID match
 * flaky-tests-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { FlakyTestBoard, FlakyTest, FlakyStatus } from "@/lib/stores/workspace-types";

const KIND_FLAKY = "workspace:flakyTestBoard";
// MUST match FB_ID in flaky-tests-client.tsx.
const FB_ID = "flakyTestBoard:current";

const STATUSES = ["active", "quarantined", "fixed"] as const;
const StatusSchema = z.enum(STATUSES);

const ws = () => useWorkspaceStore.getState();

// The local calendar day, as the scoreboard shows and buckets it (toISOString
// gave the UTC day, off by one near midnight away from UTC).
const today = () => todayLocalISO();
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function emptyDoc(): FlakyTestBoard {
  return { id: FB_ID, tests: [] };
}

function browserDoc(): FlakyTestBoard | null {
  return (ws().flakyTestBoards ?? []).find((d) => d.id === FB_ID) ?? null;
}

function summarize(doc: FlakyTestBoard | null) {
  const tests = doc?.tests ?? [];
  const byStatus: Record<FlakyStatus, number> = { active: 0, quarantined: 0, fixed: 0 };
  let activeRateSum = 0;
  let activeCount = 0;
  for (const t of tests) {
    if (t.status in byStatus) byStatus[t.status] += 1;
    if (t.status === "active") {
      activeRateSum += t.failureRate;
      activeCount += 1;
    }
  }
  const worstOffenders = [...tests]
    .sort((a, b) => b.failureRate - a.failureRate)
    .slice(0, 5)
    .map((t) => ({ id: t.id, name: t.name, failureRate: t.failureRate, status: t.status }));
  return {
    exists: doc !== null,
    total: tests.length,
    byStatus,
    // Average failure rate over ACTIVE (not-yet-fixed/quarantined) tests —
    // the live flakiness signal. 0 when none are active.
    avgFailureRate: activeCount ? round3(activeRateSum / activeCount) : 0,
    worstOffenders,
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
    "Summarise the flaky-test scoreboard. Returns {exists, total, byStatus: {active, quarantined, fixed}, avgFailureRate (0..1 over active tests), worstOffenders (top 5 by failureRate), tests}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<FlakyTestBoard>(ctx.userId, KIND_FLAKY, FB_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.flaky_tests.add_test ────────
registry.register({
  id: "tool.flaky_tests.add_test",
  toolId: "tool.flaky_tests",
  name: "add_test",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a flaky test. failureRate is 0..1; status defaults to 'active'; firstSeenAt defaults to today. Creates the board if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1).max(300),
    failureRate: z.number().min(0).max(1),
    status: StatusSchema.optional(),
    suite: z.string().max(200).optional(),
    owner: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    firstSeenAt: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const test = newTest(params);
    ws().upsertFlakyTestBoard({ ...base, id: FB_ID, tests: [...base.tests, test] });
    return { added: true, id: test.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<FlakyTestBoard>(ctx.userId, KIND_FLAKY, FB_ID)) ?? emptyDoc();
    const test = newTest(params);
    await serverUpsertEntity<FlakyTestBoard>(ctx.userId, KIND_FLAKY, {
      ...base,
      id: FB_ID,
      tests: [...base.tests, test],
    });
    return { added: true, id: test.id };
  },
});

// ──────── tool.flaky_tests.set_status ────────
registry.register({
  id: "tool.flaky_tests.set_status",
  toolId: "tool.flaky_tests",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a flaky test's status (active | quarantined | fixed). Stamps fixedAt when it becomes 'fixed'. Returns {updated: false} when the board or test id is unknown.",
  paramsSchema: z.object({
    testId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params.testId, params.status);
    if (!next) return { updated: false };
    ws().upsertFlakyTestBoard(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<FlakyTestBoard>(ctx.userId, KIND_FLAKY, FB_ID);
    const next = applyStatus(base ?? null, params.testId, params.status);
    if (!next) return { updated: false };
    await serverUpsertEntity<FlakyTestBoard>(ctx.userId, KIND_FLAKY, next);
    return { updated: true };
  },
});

function newTest(params: {
  name: string;
  failureRate: number;
  status?: FlakyStatus;
  suite?: string;
  owner?: string;
  description?: string;
  firstSeenAt?: string;
}): FlakyTest {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    failureRate: params.failureRate,
    status: params.status ?? "active",
    suite: params.suite,
    owner: params.owner,
    description: params.description,
    firstSeenAt: params.firstSeenAt ?? today(),
  };
}

function applyStatus(
  doc: FlakyTestBoard | null,
  testId: string,
  status: FlakyStatus
): FlakyTestBoard | null {
  if (!doc || !doc.tests.some((t) => t.id === testId)) return null;
  return {
    ...doc,
    tests: doc.tests.map((t) => {
      if (t.id !== testId) return t;
      return {
        ...t,
        status,
        fixedAt: status === "fixed" ? (t.fixedAt ?? today()) : undefined,
      };
    }),
  };
}

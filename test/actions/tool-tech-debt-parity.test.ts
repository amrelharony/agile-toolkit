/**
 * tool.tech_debt.list_state's timeToResolve, on both transports: the
 * page's "how long debt takes to pay down" (tech-debt/analysis.ts
 * timeToResolve) for the same items, examples left out, open items
 * counted as still waiting, and null below 5 paid-down items.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TechDebtItem } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async () => undefined),
    serverGetUserStateBlob: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => undefined),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { timeToResolve as pageTimeToResolve } from "@/app/(tools)/tech-debt/analysis";
import "@/lib/actions/tools/tech-debt";

const TODAY = "2026-10-27";
const tab = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const mcp = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };

const item = (id: string, raisedAt: string, resolvedAt?: string): TechDebtItem => ({
  id,
  title: id,
  impact: 3,
  effort: 3,
  raisedAt,
  ...(resolvedAt ? { resolvedAt } : {}),
});

const ITEMS: TechDebtItem[] = [
  item("a", "2026-10-01", "2026-10-03"),
  item("b", "2026-10-01", "2026-10-05"),
  item("c", "2026-10-01", "2026-10-07"),
  item("d", "2026-10-01", "2026-10-09"),
  item("e", "2026-10-01", "2026-10-11"),
  item("open", "2026-10-01"),
  item("example-x", "2026-10-01", "2026-10-02"),
];

async function listState(transport: "tab" | "mcp") {
  const action = registry.get("tool.tech_debt.list_state")!;
  const params = action.paramsSchema.parse({ today: TODAY });
  return (
    transport === "tab" ? action.handler(params, tab) : action.mcpHandler!(params, mcp)
  ) as Promise<{ timeToResolve: { resolved: number; medianDays: number | null } }>;
}

beforeEach(() => {
  rows.clear();
  localStorage.clear();
  useWorkspaceStore.setState({ techDebt: [], stories: [], ceremonyCadences: [] });
});

describe("list_state timeToResolve", () => {
  it.each(["tab", "mcp"] as const)("matches the page's median over %s", async (transport) => {
    if (transport === "tab") useWorkspaceStore.setState({ techDebt: ITEMS });
    else for (const t of ITEMS) rows.set(`workspace:techDebt/${t.id}`, t);
    const { timeToResolve } = await listState(transport);
    const page = pageTimeToResolve(
      ITEMS.filter((t) => !t.id.startsWith("example-")),
      TODAY
    );
    expect(timeToResolve).toEqual({ resolved: page.resolved, medianDays: page.medianDays });
    expect(timeToResolve).toEqual({ resolved: 5, medianDays: 6 });
  });

  it("is null below 5 paid-down items", async () => {
    useWorkspaceStore.setState({ techDebt: ITEMS.slice(0, 4) });
    expect((await listState("tab")).timeToResolve).toEqual({ resolved: 4, medianDays: null });
  });
});

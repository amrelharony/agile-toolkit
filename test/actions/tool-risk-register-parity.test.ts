/**
 * tool.risk_register.list_state's timeToClose, on both transports: the
 * page's "Median time to mitigate" (lib/risks/model riskTimeToClose, the
 * one function both read) for the same risks, examples left out, accepted
 * risks and closed ones with no close day left out, a reopened risk
 * counted as still waiting, and null below 3 closed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Risk } from "@/lib/stores/workspace-types";

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
import { riskTimeToClose } from "@/lib/risks/model";
import "@/lib/actions/tools/risk-register";

const TODAY = "2026-10-27";
const tab = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const mcp = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };

const risk = (over: Partial<Risk>): Risk => ({
  id: "r",
  title: "Risk",
  probability: 3,
  impact: 3,
  status: "open",
  raisedAt: "2026-10-01",
  ...over,
});

const RISKS: Risk[] = [
  risk({ id: "a", status: "closed", raisedAt: "2026-10-01", resolvedAt: "2026-10-05" }),
  risk({ id: "b", status: "closed", raisedAt: "2026-10-01", resolvedAt: "2026-10-09" }),
  risk({ id: "c", status: "closed", raisedAt: "2026-10-01", resolvedAt: "2026-10-13" }),
  // Reopened: the old close day stays, but it is still waiting.
  risk({ id: "d", status: "mitigating", raisedAt: "2026-10-01", resolvedAt: "2026-10-02" }),
  risk({ id: "e", status: "accepted", raisedAt: "2026-10-01" }),
  // Closed with no close day (the old generic CRUD): its duration isn't
  // known, so it is left out; counted as waiting it would make the median 12.
  risk({ id: "f", status: "closed", raisedAt: "2026-10-01" }),
  risk({ id: "example-x", status: "closed", raisedAt: "2026-10-01", resolvedAt: "2026-10-02" }),
];

async function listState(transport: "tab" | "mcp") {
  const action = registry.get("tool.risk_register.list_state")!;
  const params = action.paramsSchema.parse({ today: TODAY });
  return (
    transport === "tab" ? action.handler(params, tab) : action.mcpHandler!(params, mcp)
  ) as Promise<{ timeToClose: { closed: number; medianDays: number | null } }>;
}

beforeEach(() => {
  rows.clear();
  localStorage.clear();
  useWorkspaceStore.setState({ risks: [], impediments: [], ceremonyCadences: [] });
});

describe("list_state timeToClose", () => {
  it.each(["tab", "mcp"] as const)("matches the page's median over %s", async (transport) => {
    if (transport === "tab") useWorkspaceStore.setState({ risks: RISKS });
    else for (const r of RISKS) rows.set(`workspace:risk/${r.id}`, r);
    const { timeToClose } = await listState(transport);
    const page = riskTimeToClose(
      RISKS.filter((r) => !r.id.startsWith("example-")),
      TODAY
    );
    expect(timeToClose).toEqual(page);
    expect(timeToClose).toEqual({ closed: 3, medianDays: 8 });
  });

  it("is null below 3 closed risks", async () => {
    useWorkspaceStore.setState({ risks: RISKS.slice(0, 2) });
    expect((await listState("tab")).timeToClose).toEqual({ closed: 2, medianDays: null });
  });
});

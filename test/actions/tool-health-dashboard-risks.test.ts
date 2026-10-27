/**
 * tool.health_dashboard.get_summary reads the risks the Risk Register
 * lists, on both transports: the old register page's rows still waiting for
 * its one-time move count (localStorage in the tab, user_state rows over
 * MCP), a row the move already handled doesn't come back, examples never
 * count, and "high" is the register's band (probability × impact 10 or
 * more), as the description says.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Risk, RiskScale } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
const blobs = vi.hoisted(() => new Map<string, unknown>());
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
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { RISK_REGISTER_KEY, RISK_REGISTER_MOVED_KEY } from "@/lib/risks/legacy-register";
import "@/lib/actions/tools/health-dashboard";

const tab = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const mcpCtx = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };

type Summary = { risks: { total: number; open: number; high: number }; flags: string[] };

function summary(transport: "tab" | "mcp"): Promise<Summary> {
  const action = registry.get("tool.health_dashboard.get_summary")!;
  return (
    transport === "tab" ? action.handler({}, tab) : action.mcpHandler!({}, mcpCtx)
  ) as Promise<Summary>;
}

const risk = (
  id: string,
  probability: RiskScale,
  impact: RiskScale,
  over: Partial<Risk> = {}
): Risk => ({
  id,
  title: `Risk ${id}`,
  probability,
  impact,
  status: "open",
  raisedAt: "2026-09-01",
  ...over,
});

function seed(transport: "tab" | "mcp", s: { risks?: Risk[]; blob?: Risk[]; moved?: string[] }) {
  if (transport === "tab") {
    useWorkspaceStore.setState({ risks: s.risks ?? [] });
    if (s.blob) localStorage.setItem(RISK_REGISTER_KEY, JSON.stringify(s.blob));
    if (s.moved) localStorage.setItem(RISK_REGISTER_MOVED_KEY, JSON.stringify(s.moved));
    return;
  }
  for (const r of s.risks ?? []) rows.set(`workspace:risk/${r.id}`, r);
  if (s.blob) blobs.set(RISK_REGISTER_KEY, s.blob);
  if (s.moved) blobs.set(RISK_REGISTER_MOVED_KEY, s.moved);
}

beforeEach(() => {
  rows.clear();
  blobs.clear();
  localStorage.clear();
  useWorkspaceStore.setState({
    risks: [],
    sprints: [],
    stories: [],
    impediments: [],
    okrs: [],
    healthChecks: [],
    kanbanBoards: [],
    standupEntries: [],
    asyncUpdates: [],
    healthDashboards: [],
  });
});

describe.each(["tab", "mcp"] as const)("get_summary's risks (%s)", (transport) => {
  it("counts the old register page's rows not moved in yet, as the register lists them", async () => {
    seed(transport, {
      risks: [risk("r1", 1, 2)],
      // A 2 × 5 risk only the old page holds, its copy of r1, and an example.
      blob: [risk("old", 2, 5), risk("r1", 1, 2), risk("example-x", 5, 5)],
    });
    const s = await summary(transport);
    expect(s.risks).toEqual({ total: 2, open: 2, high: 1 });
    expect(s.flags).toContain("high_risks_open");
  });

  it("leaves out a blob row the move already handled", async () => {
    seed(transport, { blob: [risk("gone", 4, 4)], moved: ["gone"] });
    const s = await summary(transport);
    expect(s.risks).toEqual({ total: 0, open: 0, high: 0 });
    expect(s.flags).not.toContain("high_risks_open");
  });
});

describe("get_summary's description", () => {
  it("states the register's band for a high risk", () => {
    const d = registry.get("tool.health_dashboard.get_summary")!.description;
    expect(d).not.toContain(">= 15");
    expect(d).toContain("probability × impact >= 10");
  });
});

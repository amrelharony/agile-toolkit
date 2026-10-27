/**
 * intent.summarize_workspace reads the risks the Risk Register lists, on
 * both transports: the old register page's rows still waiting for its
 * one-time move are counted and can be top risks (as
 * tool.risk_register.list_state lists them), a row the move already
 * handled doesn't come back, and example rows are never the team's top
 * risks.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Risk } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
    serverGetWorkspaceBlob: vi.fn(async () => ({})),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { RISK_REGISTER_KEY, RISK_REGISTER_MOVED_KEY } from "@/lib/risks/legacy-register";
import "@/lib/actions/intents/summarize-workspace";

const tab = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const mcpCtx = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };

type Snapshot = {
  counts: Record<string, number>;
  topOpenRisks: { id: string; score: number }[];
};

function snapshot(transport: "tab" | "mcp"): Promise<Snapshot> {
  const action = registry.get("intent.summarize_workspace")!;
  return (
    transport === "tab" ? action.handler({}, tab) : action.mcpHandler!({}, mcpCtx)
  ) as Promise<Snapshot>;
}

const risk = (id: string, probability: number, impact: number, over: Partial<Risk> = {}): Risk => ({
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
    teamMembers: [],
    sprints: [],
    stories: [],
    impediments: [],
    risks: [],
    okrs: [],
    decisions: [],
    techDebt: [],
    whiteboards: [],
    whiteboardObjects: [],
  });
});

describe.each(["tab", "mcp"] as const)("summarize_workspace's risks (%s)", (transport) => {
  it("counts and ranks the old page's rows not moved in yet; examples are never top risks", async () => {
    seed(transport, {
      risks: [
        risk("r1", 3, 3),
        risk("example-big", 5, 5),
        risk("done", 5, 5, { status: "closed" }),
      ],
      blob: [risk("old", 4, 5), risk("gone", 5, 4)],
      moved: ["gone"],
    });
    const s = await snapshot(transport);
    // r1, the example, the closed one and the pending "old"; "gone" was handled by the move.
    expect(s.counts.risks).toBe(4);
    expect(s.topOpenRisks.map((r) => [r.id, r.score])).toEqual([
      ["old", 20],
      ["r1", 9],
    ]);
  });

  it("lists no top risk while only the example is there", async () => {
    seed(transport, { risks: [risk("example-a", 4, 4), risk("example-b", 2, 5)] });
    expect((await snapshot(transport)).topOpenRisks).toEqual([]);
  });
});

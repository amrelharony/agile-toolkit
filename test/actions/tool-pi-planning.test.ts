/**
 * tool.pi_planning.* — Amr's verbs for PI Planning (reads only this phase).
 *
 *   1. registration: list_state and predictability, both reads with an MCP
 *      handler, offered to visitors (they read the visitor's own tab).
 *   2. list_state: the teams, items by kind, objectives with planned and
 *      actual value, the risks by ROAM status and the ones to sort, and the
 *      latest confidence vote, totals only; from this tab's copy, or the
 *      user's saved row over MCP, both through the page's normaliser.
 *   3. predictability: per team, the train's total, the band and history.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  value: null as unknown,
  keys: [] as string[],
  users: [] as string[],
  /** The user's risk rows on the server (kind "workspace:risk"). */
  risks: [] as unknown[],
}));
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    // The board under its key; the Risk Register's old blobs hold nothing.
    serverGetUserStateBlob: async (user: string, key: string) => {
      blob.users.push(user);
      blob.keys.push(key);
      return key === "agile-toolkit:pi-planning" ? blob.value : null;
    },
    serverListEntities: async (_user: string, kind: string) =>
      kind === "workspace:risk" ? blob.risks : [],
  };
});

import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/pi-planning";
import { PI_STORAGE_KEY } from "@/lib/pi-planning/model";
import { RISK_REGISTER_KEY, RISK_REGISTER_MOVED_KEY } from "@/lib/risks/legacy-register";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";

/** The risk r1 was sent as, as the Risk Register holds it. */
const RISK_9: Risk = {
  id: "risk-9",
  title: "PCI audit could slip",
  probability: 3,
  impact: 4,
  status: "open",
  raisedAt: "2026-11-20",
};

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u1",
  source,
  squadProfileIds: [] as string[],
});
const action = (name: string) => registry.get(`tool.pi_planning.${name}`)!;
const run = (name: string) =>
  action(name).handler(action(name).paramsSchema.parse({}), ctx()) as Promise<
    Record<string, unknown>
  >;
const runMcp = (name: string) =>
  action(name).mcpHandler!(action(name).paramsSchema.parse({}), ctx("mcp")) as Promise<
    Record<string, unknown>
  >;

const BOARD = {
  name: "PI 2026.4",
  teams: [
    { id: "t1", name: "Checkout", velocity: 30 },
    { id: "t2", name: "Payments" },
  ],
  iterations: 3,
  items: [
    { id: "f1", title: "Guest checkout", teamId: "t1", iteration: 0, kind: "feature", points: 8 },
    {
      id: "d1",
      title: "Refund API",
      teamId: "t1",
      iteration: 1,
      kind: "dependency",
      dependsOn: "Payments",
    },
    {
      id: "r1",
      title: "PCI audit could slip",
      teamId: "t1",
      iteration: 2,
      kind: "risk",
      roam: "owned",
      roamOwner: "Sam",
      sentTo: [{ route: "risk", targetId: "risk-9", at: "2026-11-20T00:00:00Z" }],
    },
    { id: "r2", title: "Vendor contract", teamId: "t2", iteration: 0, kind: "risk" },
    { id: "r3", title: "Hidden", teamId: "t2", iteration: 7, kind: "risk" },
  ],
  objectives: [
    {
      id: "o1",
      teamId: "t1",
      title: "Guests check out",
      committed: true,
      businessValue: 9,
      actualBusinessValue: 8,
    },
    { id: "o2", teamId: "t2", title: "Refunds", committed: true, businessValue: 8 },
  ],
  confidence: [
    {
      id: "v1",
      at: "2026-11-19T10:00:00Z",
      scope: "train",
      scopeName: "Whole train",
      counts: [0, 0, 2, 2, 0],
      ballots: 4,
      source: "live",
    },
    {
      id: "v2",
      at: "2026-11-20T10:00:00Z",
      scope: "t2",
      scopeName: "Payments",
      counts: [0, 1, 3, 5, 2],
      ballots: 11,
      source: "facilitator",
    },
  ],
  history: [
    {
      id: "h1",
      name: "PI 2026.3",
      closedAt: "2026-09-01",
      teams: [{ teamId: "t1", name: "Checkout", plannedBv: 20, actualBv: 17 }],
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  blob.value = null;
  blob.keys = [];
  blob.users = [];
  blob.risks = [];
  useWorkspaceStore.setState({ risks: [] });
});

describe("registration", () => {
  it("registers two reads, each with an MCP handler, open to visitors", () => {
    for (const name of ["list_state", "predictability"]) {
      expect(action(name)).toMatchObject({ category: "read", toolId: "tool.pi_planning" });
      expect(action(name).mcpHandler).toBeDefined();
      expect(action(name).visitor).not.toBe(false);
    }
    // No write verbs this phase.
    expect(
      registry
        .list({ toolId: "tool.pi_planning" })
        .map((a) => a.name)
        .sort()
    ).toEqual(["list_state", "predictability"]);
  });
});

describe("list_state", () => {
  it("reads this tab's board", async () => {
    localStorage.setItem(PI_STORAGE_KEY, JSON.stringify(BOARD));
    useWorkspaceStore.setState({ risks: [RISK_9] });
    const out = await run("list_state");
    expect(blob.keys).toEqual([]);
    expect(out).toMatchObject({ name: "PI 2026.4", example: false, iterations: 3 });
    expect(out.teams).toEqual([
      { id: "t1", name: "Checkout", velocity: 30 },
      { id: "t2", name: "Payments", velocity: null },
    ]);
    const items = out.items as Record<string, { id: string }[]>;
    expect(items.feature).toEqual([
      { id: "f1", title: "Guest checkout", team: "Checkout", iteration: 1, points: 8 },
    ]);
    expect(items.dependency[0]).toMatchObject({ id: "d1", waitsOn: "Payments", iteration: 2 });
    // A risk past the last iteration isn't on the board.
    expect(items.risk.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(out.objectives).toEqual([
      {
        id: "o1",
        team: "Checkout",
        title: "Guests check out",
        committed: true,
        businessValue: 9,
        actualBusinessValue: 8,
      },
      {
        id: "o2",
        team: "Payments",
        title: "Refunds",
        committed: true,
        businessValue: 8,
        actualBusinessValue: null,
      },
    ]);
    expect(out.roam).toEqual({
      resolved: [],
      owned: [
        {
          id: "r1",
          title: "PCI audit could slip",
          team: "Checkout",
          owner: "Sam",
          sentToRiskRegister: true,
        },
      ],
      accepted: [],
      mitigated: [],
    });
    expect(out.toSort).toEqual([
      { id: "r2", title: "Vendor contract", team: "Payments", sentToRiskRegister: false },
    ]);
    expect(out.roamVerdict).toBe("2 risks: 1 owned; 1 still to sort.");
    expect(out.latestConfidence).toEqual({
      scope: "t2",
      scopeName: "Payments",
      average: 3.7,
      counts: [0, 1, 3, 5, 2],
      ballots: 11,
      at: "2026-11-20T10:00:00Z",
    });
  });

  it("reads the user's saved row over MCP, through the same normaliser", async () => {
    blob.value = { ...BOARD, confidence: [{ id: "bad", counts: "lots" }] };
    blob.risks = [RISK_9];
    const out = await runMcp("list_state");
    // The board, then the Risk Register as it lists (r1 was sent there).
    expect(blob.keys).toEqual([PI_STORAGE_KEY, RISK_REGISTER_KEY, RISK_REGISTER_MOVED_KEY]);
    expect(blob.users).toEqual(["u1", "u1", "u1"]);
    expect(out.latestConfidence).toBeNull();
    expect((out.toSort as unknown[]).length).toBe(1);
    expect((out.roam as Record<string, unknown[]>).owned).toEqual([
      expect.objectContaining({ id: "r1", sentToRiskRegister: true }),
    ]);
  });

  it("reads the Risk Register only when a risk on the board was sent there", async () => {
    blob.value = { ...BOARD, items: BOARD.items.filter((i) => i.id !== "r1") };
    await runMcp("list_state");
    expect(blob.keys).toEqual([PI_STORAGE_KEY]);
  });

  it("counts a risk as sent only while the register still has it, as the page's liveLink", async () => {
    // r1 went to the register as risk-9, which was deleted there since:
    // the page offers to send it again, so Amr doesn't call it sent.
    localStorage.setItem(PI_STORAGE_KEY, JSON.stringify(BOARD));
    const tab = await run("list_state");
    expect((tab.roam as Record<string, unknown[]>).owned).toEqual([
      expect.objectContaining({ id: "r1", sentToRiskRegister: false }),
    ]);
    blob.value = BOARD;
    blob.risks = [{ ...RISK_9, id: "risk-other" }];
    const mcp = await runMcp("list_state");
    expect((mcp.roam as Record<string, unknown[]>).owned).toEqual([
      expect.objectContaining({ id: "r1", sentToRiskRegister: false }),
    ]);
  });

  it("reads an empty board when nothing is saved, or what's saved is garbage", async () => {
    const out = await run("list_state");
    expect(out).toMatchObject({ teams: [], toSort: [], latestConfidence: null });
    expect(out.roamVerdict).toBe("No risks on the board yet.");
    localStorage.setItem(PI_STORAGE_KEY, "not json");
    await expect(run("list_state")).resolves.toMatchObject({ teams: [] });
    blob.value = 42;
    await expect(runMcp("list_state")).resolves.toMatchObject({ teams: [] });
  });

  it("says when the board holds the example", async () => {
    localStorage.setItem(
      PI_STORAGE_KEY,
      JSON.stringify({
        teams: [{ id: "example-pi-checkout", name: "Checkout" }],
        items: [],
        iterations: 5,
      })
    );
    expect(await run("list_state")).toMatchObject({ example: true });
  });
});

describe("predictability", () => {
  it("gives each team, the train's total, the band, and the closed PIs", async () => {
    blob.value = BOARD;
    const out = await runMcp("predictability");
    expect(out.band).toEqual({ low: 80, high: 100 });
    expect(out.teams).toEqual([
      {
        teamId: "t1",
        name: "Checkout",
        plannedBv: 9,
        actualBv: 8,
        toScore: 0,
        pct: 89,
        status: "within",
      },
      {
        teamId: "t2",
        name: "Payments",
        plannedBv: 8,
        actualBv: 0,
        toScore: 1,
        pct: null,
        status: "to-score",
      },
    ]);
    expect(out.total).toEqual({ plannedBv: 9, actualBv: 8, pct: 89, status: "within", teams: 1 });
    expect(out.verdict).toBe(
      "Checkout 89% against an aim of 80–100%. Payments has 1 objective to score."
    );
    expect(out.history).toEqual([
      {
        id: "h1",
        name: "PI 2026.3",
        closedAt: "2026-09-01",
        predictability: 85,
        teams: [{ teamId: "t1", name: "Checkout", plannedBv: 20, actualBv: 17 }],
      },
    ]);
    // One closed PI: too few for an average.
    expect(out.historyAverage).toBeNull();
  });

  it("uses the train's own band in the tab", async () => {
    localStorage.setItem(
      PI_STORAGE_KEY,
      JSON.stringify({ ...BOARD, band: { low: 90, high: 110 } })
    );
    const out = await run("predictability");
    expect(out.band).toEqual({ low: 90, high: 110 });
    expect((out.teams as { status: string }[])[0].status).toBe("below");
  });
});

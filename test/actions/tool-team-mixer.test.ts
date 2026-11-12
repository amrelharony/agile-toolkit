/**
 * tool.team_mixer.* coverage.
 *
 *   1. list_state (read); make_groups and next_round (write, mcpHandler,
 *      open to visitors: nothing reaches anyone else)
 *   2. make_groups sets who and how, takes the roster for an empty mix,
 *      saves a round (or a café plan) to the tool store, and refuses in
 *      plain words what can't be mixed
 *   3. next_round avoids the pairings so far; in a café it steps the plan
 *   4. over MCP the cloud copy and the roster are read, and nothing is
 *      saved (saved: false, with a note)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetUserStateBlob: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
  };
});

import { registry } from "@/lib/actions/registry";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { pairKey } from "@/lib/team-mixer/model";
import { MIXER_INITIAL } from "@/lib/team-mixer/state";
import { TEAM_MIXER_STORE_KEY, readMixer, useTeamMixerStore } from "@/lib/team-mixer/store";
import { NOT_SAVED_NOTE } from "@/lib/actions/tools/team-mixer";

import "@/lib/actions/tools/team-mixer";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});

const ROSTER = [
  { id: "m1", name: "Ana", role: "Developer" },
  { id: "m2", name: "Bo", role: "Developer" },
  { id: "m3", name: "Cy", role: "Tester" },
  { id: "m4", name: "Dee", role: "Tester" },
  { id: "example-m5", name: "Example Person" },
];

const run = <T>(verb: string, params: unknown, source: "agent" | "mcp" = "agent"): Promise<T> => {
  const a = registry.get(`tool.team_mixer.${verb}`)!;
  const parsed = a.paramsSchema.parse(params);
  return (source === "mcp" ? a.mcpHandler! : a.handler)(parsed, ctx(source)) as Promise<T>;
};

interface RoundResult {
  mixed: boolean;
  saved?: boolean;
  note?: string;
  reason?: string;
  kind?: "round" | "cafe";
  round?: { number: number; groups: { label: string; people: string[] }[]; issues: string[] };
  cafe?: {
    current: number;
    rounds: number;
    onScreen: { tables: { host: string; guests: string[] }[] };
  };
}

beforeEach(() => {
  useTeamMixerStore.setState({ ...MIXER_INITIAL });
  useWorkspaceStore.setState({ teamMembers: ROSTER });
  vi.mocked(serverStore.serverGetUserStateBlob).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
});

describe("tool.team_mixer — registration", () => {
  it("has a read and two writes, each with an MCP handler, all open to visitors", () => {
    expect(registry.get("tool.team_mixer.list_state")?.category).toBe("read");
    for (const verb of ["make_groups", "next_round"]) {
      const a = registry.get(`tool.team_mixer.${verb}`)!;
      expect(a.category).toBe("write");
      expect(a.mcpHandler).toBeTypeOf("function");
      expect(a.visitor).not.toBe(false);
    }
    // Starting over can drop history, so it asks; the next round doesn't.
    expect(registry.get("tool.team_mixer.make_groups")?.requiresConfirmation).toBeUndefined();
    expect(registry.get("tool.team_mixer.next_round")?.requiresConfirmation).toBe(false);
  });

  it("refuses a size and a count together", () => {
    expect(() =>
      registry
        .get("tool.team_mixer.make_groups")!
        .paramsSchema.parse({ groupSize: 3, groupCount: 2 })
    ).toThrow(/groupSize or groupCount/);
  });
});

describe("make_groups", () => {
  it("takes the roster for an empty mix, leaving example rows out, and saves the round", async () => {
    const r = await run<RoundResult>("make_groups", { mode: "pairs", seed: 1 });
    expect(r.mixed).toBe(true);
    expect(r.saved).toBe(true);
    expect(r.kind).toBe("round");
    expect(r.round!.number).toBe(1);
    expect(r.round!.groups.map((g) => g.label)).toEqual(["Pair 1", "Pair 2"]);
    const s = readMixer();
    expect(s.people.map((p) => p.name)).toEqual(["Ana", "Bo", "Cy", "Dee"]);
    expect(s.mode).toBe("pairs");
    expect(s.rounds).toHaveLength(1);
  });

  it("balances by role from the roster", async () => {
    const r = await run<RoundResult>("make_groups", { mode: "pairs", balance: "role", seed: 3 });
    for (const g of r.round!.groups) {
      const roles = g.people.map((n) => ROSTER.find((m) => m.name === n)!.role);
      expect(new Set(roles).size).toBe(2);
    }
  });

  it("uses the names given and the size asked, keeping a saved rule", async () => {
    useTeamMixerStore.setState({
      rules: [{ id: "r1", kind: "apart", a: "Eve", b: "Fay" }],
    });
    const r = await run<RoundResult>("make_groups", {
      people: ["Eve", "Fay", "Gus", "Hal", "Ivy", "Jo"],
      groupSize: 3,
      title: "Retro breakouts",
      seed: 2,
    });
    expect(r.round!.groups).toHaveLength(2);
    const groupOf = (n: string) => r.round!.groups.findIndex((g) => g.people.includes(n));
    expect(groupOf("Eve")).not.toBe(groupOf("Fay"));
    expect(readMixer().title).toBe("Retro breakouts");
    expect(readMixer().split).toBe("size");
  });

  it("forgets earlier rounds with fresh", async () => {
    await run("make_groups", { mode: "pairs", seed: 1 });
    await run("next_round", { seed: 2 });
    expect(readMixer().rounds).toHaveLength(2);
    const r = await run<RoundResult>("make_groups", { fresh: true, seed: 3 });
    expect(r.round!.number).toBe(1);
    expect(readMixer().rounds).toHaveLength(1);
  });

  it("plans a World Café", async () => {
    const r = await run<RoundResult>("make_groups", {
      people: ["A", "B", "C", "D", "E", "F", "G", "H"],
      mode: "cafe",
      tables: 2,
      rounds: 2,
      hosts: ["A"],
      seed: 4,
    });
    expect(r.kind).toBe("cafe");
    expect(r.cafe!.current).toBe(1);
    expect(r.cafe!.rounds).toBe(2);
    expect(r.cafe!.onScreen.tables[0].host).toBe("A");
    expect(readMixer().cafe?.rounds).toHaveLength(2);
  });

  it("says plainly what can't be mixed, and changes nothing else", async () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    const r = await run<RoundResult>("make_groups", { people: ["Ana"] });
    expect(r).toMatchObject({ mixed: false, reason: "Add at least 2 people to mix." });
    expect(readMixer().rounds).toEqual([]);
    const cafe = await run<RoundResult>("make_groups", {
      people: ["A", "B", "C"],
      mode: "cafe",
      tables: 2,
    });
    expect(cafe.reason).toBe("2 tables need at least 4 people: a host and a guest at each.");
  });
});

describe("next_round", () => {
  it("avoids the pairs so far", async () => {
    const first = await run<RoundResult>("make_groups", { mode: "pairs", seed: 1 });
    const second = await run<RoundResult>("next_round", { seed: 2 });
    expect(second.round!.number).toBe(2);
    const before = new Set(first.round!.groups.map((g) => pairKey(g.people[0], g.people[1])));
    for (const g of second.round!.groups) {
      expect(before.has(pairKey(g.people[0], g.people[1]))).toBe(false);
    }
  });

  it("steps a café plan and says who moves, then stops at the last round", async () => {
    await run("make_groups", {
      people: ["A", "B", "C", "D", "E", "F", "G", "H"],
      mode: "cafe",
      tables: 2,
      rounds: 2,
      seed: 5,
    });
    const r = await run<{
      moved: boolean;
      onScreen: { round: number };
      moves: { name: string; from: number | null; to: number }[];
    }>("next_round", {});
    expect(r.moved).toBe(true);
    expect(r.onScreen.round).toBe(2);
    expect(r.moves).toHaveLength(6);
    expect(readMixer().cafe?.current).toBe(1);
    const last = await run<{ moved: boolean; reason: string }>("next_round", {});
    expect(last.moved).toBe(false);
    expect(last.reason).toMatch(/that was the last/);
    const back = await run<{ moved: boolean }>("next_round", { round: 1 });
    expect(back.moved).toBe(true);
    expect(readMixer().cafe?.current).toBe(0);
  });

  it("says when there's no café plan yet", async () => {
    useTeamMixerStore.setState({ mode: "cafe" });
    const r = await run<{ moved: boolean; reason: string }>("next_round", {});
    expect(r.reason).toMatch(/no World Café plan yet/);
  });
});

describe("list_state", () => {
  it("reads the mix as the page shows it", async () => {
    await run("make_groups", { mode: "pairs", seed: 1, title: "Coffee chats" });
    const s = await run<{
      people: string[];
      settings: { mode: string; title: string | null };
      preview: string | null;
      problem: string | null;
      roundCount: number;
      rounds: { number: number; groups: unknown[] }[];
      cafe: unknown;
      hasExample: boolean;
    }>("list_state", {});
    expect(s.people).toEqual(["Ana", "Bo", "Cy", "Dee"]);
    expect(s.settings).toMatchObject({ mode: "pairs", title: "Coffee chats" });
    expect(s.preview).toBe("2 pairs.");
    expect(s.problem).toBeNull();
    expect(s.roundCount).toBe(1);
    expect(s.rounds[0].number).toBe(1);
    expect(s.cafe).toBeNull();
    expect(s.hasExample).toBe(false);
  });
});

describe("over MCP", () => {
  it("reads the cloud copy and the roster, and saves nothing", async () => {
    vi.mocked(serverStore.serverGetUserStateBlob).mockResolvedValue({
      ...MIXER_INITIAL,
      mode: "pairs",
      people: [
        { id: "p1", name: "Ana" },
        { id: "p2", name: "Bo" },
      ],
    });
    vi.mocked(serverStore.serverListEntities).mockResolvedValue(ROSTER);
    const s = await run<{ people: string[] }>("list_state", {}, "mcp");
    expect(serverStore.serverGetUserStateBlob).toHaveBeenCalledWith("u", TEAM_MIXER_STORE_KEY);
    expect(s.people).toEqual(["Ana", "Bo"]);

    const r = await run<RoundResult>("make_groups", { fromRoster: true, seed: 1 }, "mcp");
    expect(r).toMatchObject({ mixed: true, saved: false, note: NOT_SAVED_NOTE, kind: "round" });
    expect(r.round!.groups.flatMap((g) => g.people).sort()).toEqual(["Ana", "Bo", "Cy", "Dee"]);
    // The browser's store was never touched.
    expect(readMixer().rounds).toEqual([]);
    const next = await run<RoundResult>("next_round", {}, "mcp");
    expect(next.saved).toBe(false);
  });
});

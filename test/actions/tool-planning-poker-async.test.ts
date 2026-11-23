/**
 * tool.planning_poker's rounds without a meeting: list_async,
 * create_async_round and reveal_async_round, in the browser (the workspace
 * store) and over MCP (the synced pokerAsyncRound rows). Replies hold other
 * people's names, cards and notes, so no result carries any of them, and no
 * verb adds a reply.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  serverGetEntity: vi.fn(),
  serverUpsertEntity: vi.fn(),
  serverListEntities: vi.fn(),
  serverGetUserStateBlob: vi.fn(),
}));
vi.mock("@/lib/actions/server-store", () => server);

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  POKER_ASYNC_ROUND_KIND,
  type PokerAsyncReply,
  type PokerAsyncRound,
} from "@/lib/stores/workspace-types";
import { readPack } from "@/lib/estimation/async-pack";
import "@/lib/actions/tools/planning-poker";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const action = (name: string) => registry.get(`tool.planning_poker.${name}`)!;
const run = (name: string, params: unknown, source: "agent" | "mcp" = "agent") => {
  const a = action(name);
  const parsed = a.paramsSchema.parse(params);
  return (source === "mcp" ? a.mcpHandler! : a.handler)(parsed, ctx(source)) as Promise<
    Record<string, unknown>
  >;
};

const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];
const SECRETS = ["Ana", "Bo", "Secret note"];

const reply = (
  id: string,
  name: string,
  cards: [string, string],
  note?: string
): PokerAsyncReply => ({
  id,
  name,
  votes: [
    { storyId: "s1", card: cards[0] },
    { storyId: "s2", card: cards[1] },
  ],
  ...(note ? { notes: [{ storyId: "s1", text: note }] } : {}),
  at: "2099-01-02T00:00:00.000Z",
});

function round(over: Partial<PokerAsyncRound> = {}): PokerAsyncRound {
  return {
    id: "async_round000001",
    title: "Checkout stories",
    scaleType: "fibonacci",
    deck: [...FIB],
    stories: [
      { id: "s1", title: "Pay by phone" },
      { id: "s2", title: "Refund a payment" },
    ],
    expected: ["Ana", "Bo", "Cy"],
    dueDate: "2099-01-10",
    replies: [reply("a", "Ana", ["13", "5"], "Secret note"), reply("b", "Bo", ["3", "5"])],
    status: "open",
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
    ...over,
  };
}

/** No name, note or per-person card anywhere in a result. */
function expectNothingPersonal(result: unknown) {
  const text = JSON.stringify(result);
  for (const s of SECRETS) expect(text, `${text} holds ${s}`).not.toContain(s);
  expect(text).not.toMatch(/"(name|votes|notes|replies|expected)"/);
}

beforeEach(() => {
  useWorkspaceStore.setState({ pokerAsyncRounds: [] });
  for (const fn of Object.values(server)) fn.mockReset();
});

describe("registration", () => {
  it("lists, creates and reveals, with server handlers, and never adds a reply", () => {
    expect(action("list_async").category).toBe("read");
    expect(action("create_async_round").category).toBe("write");
    expect(action("reveal_async_round").category).toBe("write");
    for (const name of ["list_async", "create_async_round", "reveal_async_round"]) {
      expect(action(name).mcpHandler, name).toBeTypeOf("function");
    }
    expect(registry.get("tool.planning_poker.add_async_reply")).toBeUndefined();
  });

  it("caps what it's asked", () => {
    const schema = action("create_async_round").paramsSchema;
    const ok = { title: "Checkout", stories: ["Pay by phone"] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, title: "x".repeat(81) }).success).toBe(false);
    expect(schema.safeParse({ ...ok, stories: [] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, stories: Array(21).fill("A") }).success).toBe(false);
    expect(schema.safeParse({ ...ok, stories: ["x".repeat(121)] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, deck: Array.from({ length: 17 }, String) }).success).toBe(
      false
    );
    expect(schema.safeParse({ ...ok, dueDate: "next week" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, expected: Array(21).fill("A") }).success).toBe(false);
  });
});

describe("list_async", () => {
  it("gives counts before Reveal and verdicts after, without names, notes or cards", async () => {
    useWorkspaceStore.setState({
      pokerAsyncRounds: [
        round(),
        round({ id: "async_round000002", status: "revealed", createdAt: "2099-01-02T00:00:00Z" }),
      ],
    });
    const result = (await run("list_async", {})) as {
      total: number;
      rounds: { id: string; replyCount: number; stories: unknown }[];
    };
    expect(result.total).toBe(2);
    expect(result.rounds.map((r) => r.id)).toEqual(["async_round000002", "async_round000001"]);
    expect(result.rounds[1]).toMatchObject({ replyCount: 2, expectedCount: 3, stories: null });
    expect(result.rounds[0].stories).toEqual([
      expect.objectContaining({ title: "Pay by phone", label: "Discussion needed", voteCount: 2 }),
      expect.objectContaining({ title: "Refund a payment", label: "Full consensus", agreed: null }),
    ]);
    expectNothingPersonal(result);
  });

  it("reads the synced rows over MCP, the same way", async () => {
    server.serverListEntities.mockResolvedValue([round({ status: "revealed" })]);
    const result = await run("list_async", {}, "mcp");
    expect(server.serverListEntities).toHaveBeenCalledWith("u", POKER_ASYNC_ROUND_KIND);
    expect(result.total).toBe(1);
    expectNothingPersonal(result);
  });

  it("shows a round past its 14 days as closed", async () => {
    useWorkspaceStore.setState({
      pokerAsyncRounds: [round({ dueDate: "2020-01-01", createdAt: "2020-01-01T00:00:00Z" })],
    });
    const result = (await run("list_async", {})) as { rounds: { status: string }[] };
    expect(result.rounds[0].status).toBe("closed");
  });
});

describe("create_async_round", () => {
  it("makes an open round of typed titles and returns the link for the person to send", async () => {
    const result = (await run("create_async_round", {
      title: "Checkout",
      stories: ["Pay by phone", "Refund a payment"],
      host: "Priya",
      expected: ["Ana"],
      dueDate: "2099-12-01",
    })) as { created: boolean; id: string; path: string; chars: number };
    expect(result.created).toBe(true);
    expect(result.path.startsWith("/planning-poker/estimate#estimate=")).toBe(true);
    expect(result.chars).toBe(result.path.length - "/planning-poker/estimate#estimate=".length);
    const [made] = useWorkspaceStore.getState().pokerAsyncRounds ?? [];
    expect(made).toMatchObject({
      id: result.id,
      title: "Checkout",
      status: "open",
      deck: FIB,
      expected: ["Ana"],
      dueDate: "2099-12-01",
      replies: [],
    });
    const pack = readPack(result.path.slice(result.path.indexOf("#")));
    expect(pack).toMatchObject({ r: result.id, t: "Checkout", h: "Priya" });
    expect(pack?.s).toEqual(["Pay by phone", "Refund a payment"]);
    expect(Object.keys(result).sort()).toEqual(["chars", "created", "id", "path"]);
  });

  it("writes the synced row over MCP", async () => {
    const result = await run(
      "create_async_round",
      { title: "Sizes", scale: "tshirt", stories: ["A"] },
      "mcp"
    );
    expect(result.created).toBe(true);
    expect(server.serverUpsertEntity).toHaveBeenCalledWith(
      "u",
      POKER_ASYNC_ROUND_KIND,
      expect.objectContaining({ id: result.id, scaleType: "tshirt", status: "open" })
    );
    expect(useWorkspaceStore.getState().pokerAsyncRounds).toEqual([]);
  });

  it("says why a round can't be made, and writes nothing", async () => {
    expect(
      await run("create_async_round", { title: "X", scale: "custom", stories: ["A"] })
    ).toEqual({ created: false, problem: "Enter at least two values, separated by commas." });
    expect(
      await run("create_async_round", { title: "X", stories: ["A"], dueDate: "2000-01-01" })
    ).toEqual({ created: false, problem: "Pick today or a later day." });
    const huge = await run("create_async_round", {
      title: "X",
      stories: Array.from({ length: 20 }, () => "估".repeat(120)),
    });
    expect(huge).toEqual({ created: false, problem: expect.stringMatching(/Split/) });
    expect(useWorkspaceStore.getState().pokerAsyncRounds).toEqual([]);
  });
});

describe("reveal_async_round", () => {
  it("reveals an open round with replies and returns counts and verdicts only", async () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [round()] });
    const result = await run("reveal_async_round", { id: "async_round000001" });
    expect(result).toMatchObject({ revealed: true, status: "revealed", replyCount: 2 });
    expectNothingPersonal(result);
    const [saved] = useWorkspaceStore.getState().pokerAsyncRounds ?? [];
    expect(saved.status).toBe("revealed");
    // The far-apart story is ticked to talk about live.
    expect(saved.stories.map((s) => Boolean(s.discuss))).toEqual([true, false]);
  });

  it("refuses an unknown round, one not open, and one nobody replied to", async () => {
    useWorkspaceStore.setState({
      pokerAsyncRounds: [
        round({ id: "async_shown00001", status: "revealed" }),
        round({ id: "async_empty00001", replies: [] }),
      ],
    });
    expect(await run("reveal_async_round", { id: "async_nope000001" })).toEqual({
      revealed: false,
      reason: "not_found",
    });
    expect(await run("reveal_async_round", { id: "async_shown00001" })).toEqual({
      revealed: false,
      reason: "not_open",
    });
    expect(await run("reveal_async_round", { id: "async_empty00001" })).toEqual({
      revealed: false,
      reason: "no_replies",
    });
  });

  it("reveals the synced row over MCP", async () => {
    server.serverGetEntity.mockResolvedValue(round());
    const result = await run("reveal_async_round", { id: "async_round000001" }, "mcp");
    expect(server.serverGetEntity).toHaveBeenCalledWith(
      "u",
      POKER_ASYNC_ROUND_KIND,
      "async_round000001"
    );
    expect(result.revealed).toBe(true);
    expect(server.serverUpsertEntity).toHaveBeenCalledWith(
      "u",
      POKER_ASYNC_ROUND_KIND,
      expect.objectContaining({ status: "revealed" })
    );
    expectNothingPersonal(result);
  });
});

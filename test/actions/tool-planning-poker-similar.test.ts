/**
 * tool.planning_poker.similar_stories: finished stories like a story being
 * sized, with their points and the words both mention, and the Estimation
 * Guide's pinned reference stories to fall back on. In the browser it reads
 * the workspace and the guide's store; over MCP the synced stories and the
 * guide's synced blob. Read only, open to a visitor's own tab.
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
import type { Story } from "@/lib/stores/workspace-types";
import { initialState, useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import "@/lib/actions/tools/planning-poker";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});

interface Result {
  matches: {
    id: string;
    title: string;
    points: number | null;
    shared: string[];
    score: number;
    doneAt: string | null;
  }[];
  medianPoints: number | null;
  references: {
    scale: string;
    stories: { card: string; id: string; title: string; points: number | null }[];
  };
}

const done = (id: string, title: string, points: number, extra: Partial<Story> = {}): Story => ({
  id,
  title,
  points,
  status: "done",
  ...extra,
});

const STORIES: Story[] = [
  done("s1", "Card refunds for marketplace orders", 5, { doneAt: "2026-10-01T10:00:00Z" }),
  done("s2", "Refund a voucher payment", 3, { doneAt: "2026-10-20T10:00:00Z" }),
  done("s3", "Login page", 3),
  done("example-s4", "Refund a card", 8),
];

const action = () => registry.get("tool.planning_poker.similar_stories")!;

beforeEach(() => {
  useWorkspaceStore.setState({ stories: STORIES });
  useEstimationGuideStore.setState({ ...initialState, referenceStoryIds: {} });
  for (const fn of Object.values(server)) fn.mockReset();
});

describe("registration", () => {
  it("is a read, open to a visitor's own tab, with a server handler", () => {
    expect(action().category).toBe("read");
    expect(action().visitor).not.toBe(false);
    expect(action().mcpHandler).toBeTypeOf("function");
  });

  it("caps what it's asked", () => {
    const schema = action().paramsSchema;
    expect(schema.safeParse({ title: "" }).success).toBe(false);
    expect(schema.safeParse({ title: "x".repeat(501) }).success).toBe(false);
    expect(schema.safeParse({ title: "x", notes: "x".repeat(1001) }).success).toBe(false);
    expect(schema.safeParse({ title: "x", limit: 6 }).success).toBe(false);
  });
});

describe("in the browser", () => {
  it("finds the finished stories that read alike, never the example's", async () => {
    const r = (await action().handler(
      { title: "Refund a card payment from the order page" },
      ctx()
    )) as Result;
    expect(r.matches.map((m) => m.id)).toEqual(["s1", "s2"]);
    expect(r.matches[0]).toMatchObject({
      title: "Card refunds for marketplace orders",
      points: 5,
      shared: ["card", "order", "refund"],
      score: 0.5,
      doneAt: "2026-10-01T10:00:00Z",
    });
    expect(r.medianPoints).toBe(4);
    expect(server.serverListEntities).not.toHaveBeenCalled();
  });

  it("keeps to the limit, and has no median with no match", async () => {
    const one = (await action().handler(
      { title: "Refund a card payment", limit: 1 },
      ctx()
    )) as Result;
    expect(one.matches).toHaveLength(1);
    const none = (await action().handler({ title: "Dark mode toggle" }, ctx())) as Result;
    expect(none.matches).toEqual([]);
    expect(none.medianPoints).toBeNull();
  });

  it("lists the guide's pinned reference stories on its scale, the team's only", async () => {
    useEstimationGuideStore.setState({
      selectedScale: "Fibonacci",
      referenceStoryIds: { "Fibonacci:3": ["s3", "gone", "example-ref-3"], "Fibonacci:5": ["s1"] },
    });
    const r = (await action().handler({ title: "Dark mode toggle" }, ctx())) as Result;
    expect(r.references).toEqual({
      scale: "Fibonacci",
      stories: [
        { card: "3", id: "s3", title: "Login page", points: 3 },
        { card: "5", id: "s1", title: "Card refunds for marketplace orders", points: 5 },
      ],
    });
  });
});

describe("over MCP", () => {
  it("reads the synced stories and the guide's synced blob", async () => {
    server.serverListEntities.mockResolvedValue(STORIES);
    server.serverGetUserStateBlob.mockResolvedValue({
      selectedScale: "Powers of 2",
      referenceStoryIds: { "Powers of 2:8": ["s1"] },
    });
    const r = (await action().mcpHandler!(
      { title: "Refund a card payment" },
      ctx("mcp")
    )) as Result;
    expect(server.serverListEntities).toHaveBeenCalledWith("u", "workspace:story");
    expect(server.serverGetUserStateBlob).toHaveBeenCalledWith(
      "u",
      "agile-toolkit:estimation-guide"
    );
    // Without "order" and "page", the voucher refund reads closer.
    expect(r.matches.map((m) => m.id)).toEqual(["s2", "s1"]);
    expect(r.references).toEqual({
      scale: "Powers of 2",
      stories: [{ card: "8", id: "s1", title: "Card refunds for marketplace orders", points: 5 }],
    });
  });

  it("reads Fibonacci's pins when the guide has none saved or is on T-shirt sizes", async () => {
    server.serverListEntities.mockResolvedValue([]);
    server.serverGetUserStateBlob.mockResolvedValue(null);
    const empty = (await action().mcpHandler!({ title: "Refund" }, ctx("mcp"))) as Result;
    expect(empty).toEqual({
      matches: [],
      medianPoints: null,
      references: { scale: "Fibonacci", stories: [] },
    });
    server.serverListEntities.mockResolvedValue(STORIES);
    server.serverGetUserStateBlob.mockResolvedValue({
      selectedScale: "T-Shirt",
      referenceStoryIds: { "Fibonacci:3": ["s3"], "T-Shirt:M": ["s3"] },
    });
    const tshirt = (await action().mcpHandler!({ title: "Refund" }, ctx("mcp"))) as Result;
    expect(tshirt.references).toEqual({
      scale: "Fibonacci",
      stories: [{ card: "3", id: "s3", title: "Login page", points: 3 }],
    });
  });
});

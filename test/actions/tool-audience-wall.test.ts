/**
 * tool.audience_wall.* action coverage: the saved walls read and exported
 * from the tool store (and from the user_state row over MCP), a wall typed
 * in, and the room verbs, which reach the live wall on the page through
 * its registry, hand out counts only, are closed to visitors, and answer
 * "browser_only" over MCP.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/actions/server-store", () => ({
  serverGetUserStateBlob: vi.fn(async () => blob.value),
}));

import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/audience-wall";
import { registerLiveWall, type LiveWallControl } from "@/lib/audience-wall/live";
import { useAudienceWallStore } from "@/lib/audience-wall/store";
import type { WallSession } from "@/lib/audience-wall/model";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "user-1",
  source,
  squadProfileIds: [] as string[],
});

const run = (name: string, params: unknown = {}, source: "agent" | "mcp" = "agent") => {
  const action = registry.get(`tool.audience_wall.${name}`)!;
  const handler = source === "mcp" && action.mcpHandler ? action.mcpHandler : action.handler;
  return handler(action.paramsSchema.parse(params), ctx(source)) as Promise<
    Record<string, unknown>
  >;
};

const WALL: WallSession = {
  id: "wall_abc",
  kind: "questions",
  prompt: "What should we ask?",
  savedAt: "2026-11-12T10:00:00.000Z",
  source: "room",
  posts: [
    { id: "p1", text: "Who owns onboarding?", votes: 3, merged: [] },
    { id: "p2", text: "When is the release?", votes: 5, merged: [], answered: true },
  ],
  themes: [],
  sent: [],
};

type Status = ReturnType<LiveWallControl["status"]>;

/** A live wall that follows the kit's rules: scored rounds stay closed, scoring only moves on. */
function fakeRoom(
  over: Partial<LiveWallControl> = {},
  start: Partial<Status> = {},
  { crowd = false } = {}
): LiveWallControl & { state: Status } {
  const state: Status = {
    prompt: "Questions?",
    open: true,
    mode: "live",
    posts: 4,
    shown: true,
    hands: 2,
    people: 6,
    scoring: null,
    kind: crowd ? "crowd" : "questions",
    unsaved: false,
    ...start,
  };
  return {
    state,
    status: () => ({ ...state }),
    openRound: vi.fn((prompt: string, mode: "live" | "hidden") => {
      Object.assign(state, { prompt, mode, open: true, posts: 0, shown: mode === "live" });
      Object.assign(state, { scoring: null, unsaved: false });
      return true;
    }),
    setOpen: vi.fn((open: boolean) => {
      if (open && state.scoring) return;
      state.open = open;
    }),
    reveal: vi.fn(() => {
      state.shown = true;
    }),
    lowerAllHands: vi.fn(() => {
      state.hands = 0;
    }),
    ...(crowd
      ? {
          setScoring: vi.fn((phase: "open" | "shown") => {
            if (phase === "open" && state.scoring === null) {
              Object.assign(state, { scoring: "open", open: false, shown: true });
            } else if (phase === "shown" && state.scoring === "open") state.scoring = "shown";
          }),
        }
      : {}),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  useAudienceWallStore.setState({ sessions: [WALL] });
  blob.value = null;
});

describe("registration", () => {
  it("registers the reads, the wall write and the room verbs, room verbs closed to visitors", () => {
    const names = registry
      .list()
      .filter((a) => a.toolId === "tool.audience_wall")
      .map((a) => [a.name, a.category, a.visitor ?? true] as const);
    expect(names).toEqual(
      expect.arrayContaining([
        ["list_state", "read", true],
        ["list_sessions", "read", true],
        ["export_session", "read", true],
        ["add_wall", "write", true],
        ["room_status", "read", false],
        ["open_round", "write", false],
        ["set_open", "write", false],
        ["reveal", "write", false],
        ["lower_hands", "write", false],
        ["scoring", "write", false],
      ])
    );
    for (const a of registry.list().filter((x) => x.toolId === "tool.audience_wall")) {
      expect(a.mcpHandler, a.name).toBeDefined();
    }
  });
});

describe("saved walls", () => {
  it("lists them in short, and the live wall's counts when one is open", async () => {
    let state = await run("list_state");
    expect(state).toMatchObject({ total: 1, live: null });
    expect((state.walls as unknown[])[0]).toMatchObject({
      id: "wall_abc",
      kind: "questions",
      posts: 2,
      votes: 8,
      answered: 1,
    });
    const off = registerLiveWall(fakeRoom());
    state = await run("list_state");
    expect(state.live).toMatchObject({ prompt: "Questions?", posts: 4, hands: 2 });
    off();
  });

  it("gives a wall's posts best first, and refuses an unknown wall", async () => {
    const out = await run("list_sessions", { sessionId: "wall_abc" });
    const posts = (out.sessions as { posts: { text: string }[] }[])[0].posts;
    // Answered questions go after the rest.
    expect(posts.map((p) => p.text)).toEqual(["Who owns onboarding?", "When is the release?"]);
    expect(await run("list_sessions", { sessionId: "nope" })).toEqual({
      error: "unknown_session",
    });
  });

  it("exports one wall or every wall as Markdown", async () => {
    const one = await run("export_session", { sessionId: "wall_abc" });
    expect(one.markdown).toContain("## What should we ask?");
    expect(one.markdown).toContain("- Who owns onboarding? — 3 votes");
    expect((await run("export_session")).markdown).toContain("# Audience Wall");
    expect(await run("export_session", { sessionId: "gone" })).toMatchObject({
      error: "unknown_session",
    });
  });

  it("saves a wall typed in, with no votes and no names", async () => {
    const res = await run("add_wall", {
      prompt: "What would make retros a ten?",
      posts: ["Shorter", "  Owners for actions "],
    });
    expect(res).toMatchObject({ ok: true, posts: 2 });
    const saved = useAudienceWallStore.getState().sessions.find((s) => s.id === res.id)!;
    expect(saved).toMatchObject({ kind: "answers", source: "manual" });
    expect(saved.posts.map((p) => [p.text, p.votes])).toEqual([
      ["Shorter", 0],
      ["Owners for actions", 0],
    ]);
    expect(() =>
      registry.get("tool.audience_wall.add_wall")!.paramsSchema.parse({ prompt: "Q", posts: [] })
    ).toThrow();
  });

  it("reads the user_state row over MCP, and keeps writes in the browser", async () => {
    blob.value = { sessions: [{ ...WALL, id: "wall_server", prompt: "From the cloud" }] };
    const state = await run("list_state", {}, "mcp");
    expect(state).toMatchObject({ total: 1, live: null });
    expect((state.walls as { prompt: string }[])[0].prompt).toBe("From the cloud");
    expect((await run("export_session", {}, "mcp")).markdown).toContain("From the cloud");
    expect(await run("add_wall", { prompt: "Q", posts: ["a"] }, "mcp")).toEqual({
      ok: false,
      error: "browser_only",
    });
  });
});

describe("the live wall", () => {
  it("says there's none until the page registers one", async () => {
    expect(await run("room_status")).toMatchObject({ ok: false, error: "no_live_wall" });
    expect(await run("reveal")).toMatchObject({ ok: false, error: "no_live_wall" });
  });

  it("runs the room through the page's controls, counts only", async () => {
    const room = fakeRoom();
    const off = registerLiveWall(room);
    expect(await run("room_status")).toMatchObject({ ok: true, posts: 4, people: 6 });
    expect(JSON.stringify(await run("room_status"))).not.toContain("text");
    await run("open_round", { prompt: "What next?" });
    expect(room.openRound).toHaveBeenCalledWith("What next?", "hidden");
    await run("set_open", { open: false });
    expect(room.setOpen).toHaveBeenCalledWith(false);
    await run("reveal");
    expect(room.reveal).toHaveBeenCalled();
    await run("lower_hands");
    expect(room.lowerAllHands).toHaveBeenCalled();
    // Not a 25/10 wall: no scoring.
    expect(await run("scoring", { phase: "open" })).toMatchObject({
      ok: false,
      error: "not_a_25_10_wall",
    });
    off();
    expect(await run("room_status")).toMatchObject({ error: "no_live_wall" });
  });

  it("starts and shows a 25/10 scoring", async () => {
    const room = fakeRoom({}, {}, { crowd: true });
    const off = registerLiveWall(room);
    expect(await run("scoring", { phase: "open" })).toMatchObject({ ok: true, scoring: "open" });
    expect(await run("scoring", { phase: "shown" })).toMatchObject({ ok: true, scoring: "shown" });
    expect((room.setScoring as ReturnType<typeof vi.fn>).mock.calls).toEqual([["open"], ["shown"]]);
    // Forward only, and said so.
    expect(await run("scoring", { phase: "open" })).toMatchObject({
      ok: false,
      error: "already_shown",
    });
    off();
  });

  it("won't start the scoring on fewer than two posts, or show totals before it", async () => {
    const room = fakeRoom({}, { posts: 1 }, { crowd: true });
    const off = registerLiveWall(room);
    expect(await run("scoring", { phase: "shown" })).toMatchObject({
      ok: false,
      error: "scoring_not_started",
    });
    expect(await run("scoring", { phase: "open" })).toMatchObject({
      ok: false,
      error: "needs_two_posts",
    });
    expect(room.setScoring).not.toHaveBeenCalled();
    // The round still takes posts.
    expect(room.state).toMatchObject({ open: true, scoring: null });
    off();
  });

  it("says when the room didn't take a move: no taking posts again while scoring", async () => {
    const room = fakeRoom({}, { scoring: "open", open: false }, { crowd: true });
    const off = registerLiveWall(room);
    expect(await run("set_open", { open: true })).toMatchObject({
      ok: false,
      error: "scoring",
      open: false,
    });
    expect(await run("set_open", { open: false })).toMatchObject({ ok: true, open: false });
    off();
  });

  it("won't clear a round whose posts aren't saved, unless told to discard them", async () => {
    const room = fakeRoom({}, { unsaved: true, posts: 7 });
    const off = registerLiveWall(room);
    expect(await run("open_round", { prompt: "Next question?" })).toMatchObject({
      ok: false,
      error: "unsaved_round",
      posts: 7,
    });
    expect(room.openRound).not.toHaveBeenCalled();
    expect(room.state.prompt).toBe("Questions?");
    expect(await run("open_round", { prompt: "Next question?", discard: true })).toMatchObject({
      ok: true,
      prompt: "Next question?",
    });
    expect(room.openRound).toHaveBeenCalledWith("Next question?", "hidden");
    off();
  });

  it("answers browser_only over MCP", async () => {
    const off = registerLiveWall(fakeRoom());
    for (const name of ["room_status", "reveal", "lower_hands"]) {
      expect(await run(name, {}, "mcp"), name).toMatchObject({ error: "browser_only" });
    }
    off();
  });
});

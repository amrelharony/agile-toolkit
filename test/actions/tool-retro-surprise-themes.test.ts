/**
 * The Retro add-ons' verbs for Amr:
 *
 *   tool.retro.surprise_me          a plan for the next retro: a format none
 *                                   of the last three retros used, an
 *                                   opening and a closing, the same for the
 *                                   same seed; reads only
 *   tool.retro_actions.list_themes  what came up in three or more past
 *                                   retros, and what came back after its
 *                                   action was done; "not enough" below 3
 *
 * Both read the browser's boards, or the user's rows on the MCP path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import { blankRetroBoard } from "@/lib/retro/board";
import { CLOSING_ACTIVITY_IDS, OPENING_ACTIVITY_IDS } from "@/lib/retro/surprise";

import "@/lib/actions/tools/retro";
import "@/lib/actions/tools/retro-actions";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const run = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.handler(params, ctx())) as T;
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.mcpHandler!(params, ctx())) as T;

const fmt = (id: string) => retroFormats.find((f) => f.id === id)!;
const card = (id: string, text: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});
const archived = (
  id: string,
  day: string,
  cards: RetroCard[] = [],
  format: RetroFormat = retroFormats[0]
): RetroBoard => ({
  ...blankRetroBoard(format),
  id,
  cards,
  archivedAt: `${day}T10:00:00.000Z`,
});

beforeEach(() => {
  useWorkspaceStore.setState({ retroBoards: [] });
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
});

type Plan = {
  picked: boolean;
  format: { id: string; name: string; builtIn: boolean; columns: { key: string }[] };
  opening: { id: string; name: string; minutes: number };
  closing: { id: string };
  avoided: string[];
  candidates: number;
};

describe("tool.retro.surprise_me", () => {
  it("is a read, open to visitors", () => {
    const action = registry.get("tool.retro.surprise_me")!;
    expect(action.category).toBe("read");
    expect(action.mcpHandler).toBeTypeOf("function");
    expect(action.visitor).not.toBe(false);
  });

  it("never picks one of the last three retros' formats, and saves nothing", async () => {
    const recent = ["start-stop-continue", "mad-sad-glad", "4ls"].filter((id) => fmt(id));
    useWorkspaceStore.setState({
      retroBoards: recent.map((id, i) => archived(`retro:${i}`, `2026-11-0${5 - i}`, [], fmt(id))),
    });
    const before = JSON.stringify(useWorkspaceStore.getState().retroBoards);
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const plan = await run<Plan>("tool.retro.surprise_me", { seed });
      expect(plan.picked).toBe(true);
      expect(recent).not.toContain(plan.format.id);
      expect(plan.avoided).toEqual(recent);
      expect(plan.candidates).toBe(retroFormats.length - recent.length);
      expect(plan.format.builtIn).toBe(true);
      expect(OPENING_ACTIVITY_IDS as readonly string[]).toContain(plan.opening.id);
      expect(CLOSING_ACTIVITY_IDS as readonly string[]).toContain(plan.closing.id);
      expect(plan.closing.id).not.toBe(plan.opening.id);
    }
    expect(JSON.stringify(useWorkspaceStore.getState().retroBoards)).toBe(before);
  });

  it("gives the same plan for the same seed", async () => {
    const a = await run<Plan>("tool.retro.surprise_me", { seed: "sprint-14" });
    const b = await run<Plan>("tool.retro.surprise_me", { seed: "sprint-14" });
    expect(a).toEqual(b);
  });

  it("offers a custom format a past retro kept, with its columns", async () => {
    const custom: RetroFormat = {
      ...retroFormats[0],
      id: "custom-weather",
      name: "Team weather",
      columns: [
        { ...retroFormats[0].columns[0], key: "sun", label: "Sunny" },
        { ...retroFormats[0].columns[0], key: "rain", label: "Rainy" },
      ],
    };
    useWorkspaceStore.setState({
      retroBoards: [archived("retro:old", "2026-09-01", [], custom)],
    });
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const plan = await run<Plan>("tool.retro.surprise_me", { seed: `s${i}` });
      seen.add(plan.format.id);
      if (plan.format.id === "custom-weather") {
        expect(plan.format).toMatchObject({ builtIn: false, name: "Team weather" });
        expect(plan.format.columns.map((c) => c.key)).toEqual(["sun", "rain"]);
      }
    }
    // The custom one was the last retro's, so it's avoided like any other.
    expect(seen.has("custom-weather")).toBe(false);
  });

  it("reads the user's boards on the MCP path", async () => {
    vi.mocked(serverStore.serverListEntities).mockResolvedValue([
      archived("retro:1", "2026-11-01", [], fmt("start-stop-continue")),
    ] as never);
    const plan = await runMcp<Plan>("tool.retro.surprise_me", { seed: "x" });
    expect(plan.avoided).toEqual(["start-stop-continue"]);
    expect(plan.format.id).not.toBe("start-stop-continue");
    expect(serverStore.serverListEntities).toHaveBeenCalledWith(
      "test-user",
      "workspace:retroBoard"
    );
  });
});

type Themes = {
  pastRetros: number;
  enough: boolean;
  minRetros: number;
  themes: {
    name: string;
    retros: { boardId: string; archivedAt: string | null }[];
    cardCount: number;
    cards: { id: string; boardId: string; text: string }[];
    cameBackAfterDone: { actionId: string; doneAt: string; boardId: string } | null;
  }[];
};

describe("tool.retro_actions.list_themes", () => {
  const three = () => [
    archived("retro:1", "2026-09-01", [
      card("a1", "Staging was down for a day"),
      card("a2", "Fix staging data", {
        isActionItem: true,
        done: true,
        doneAt: "2026-09-10T09:00:00.000Z",
      }),
    ]),
    archived("retro:2", "2026-09-15", [card("b1", "Staging data out of date")]),
    archived("retro:3", "2026-09-29", [
      card("c1", "Waited two days for staging"),
      card("c2", "Lunch was great"),
    ]),
  ];

  it("is a read, open to visitors", () => {
    const action = registry.get("tool.retro_actions.list_themes")!;
    expect(action.category).toBe("read");
    expect(action.visitor).not.toBe(false);
  });

  it("says there isn't enough below three past retros", async () => {
    useWorkspaceStore.setState({ retroBoards: three().slice(0, 2) });
    expect(await run<Themes>("tool.retro_actions.list_themes")).toEqual({
      pastRetros: 2,
      enough: false,
      minRetros: 3,
      themes: [],
    });
  });

  it("lists a theme across three retros, flagged when it came back after done", async () => {
    useWorkspaceStore.setState({ retroBoards: three() });
    const r = await run<Themes>("tool.retro_actions.list_themes");
    expect(r).toMatchObject({ pastRetros: 3, enough: true });
    const staging = r.themes.find((t) => t.name.toLowerCase() === "staging")!;
    expect(staging.retros.map((x) => x.boardId)).toEqual(["retro:1", "retro:2", "retro:3"]);
    expect(staging.cardCount).toBe(4);
    expect(staging.cards.map((c) => c.id)).toEqual(["a1", "a2", "b1", "c1"]);
    expect(staging.cameBackAfterDone).toMatchObject({
      actionId: "a2",
      doneAt: "2026-09-10T09:00:00.000Z",
      boardId: "retro:2",
    });
    expect(r.themes.some((t) => t.name.toLowerCase().startsWith("lunch"))).toBe(false);
  });

  it("reads the user's boards on the MCP path", async () => {
    vi.mocked(serverStore.serverListEntities).mockResolvedValue(three() as never);
    const r = await runMcp<Themes>("tool.retro_actions.list_themes");
    expect(r.enough).toBe(true);
    expect(r.themes.length).toBeGreaterThan(0);
  });
});

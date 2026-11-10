/**
 * The Retrospect & improve agent actions on the Phase 4 data:
 *
 *   - tool.retro.start / set_sprint / add_card and list_state's sprint and facts;
 *   - tool.retro_actions.add and list's follow-through, reading hand-off
 *     targets as the page does;
 *   - tool.six_hats sessions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import { blankRetroBoard } from "@/lib/retro/board";
import { retroFormats } from "@/lib/constants/retro-formats";

import "@/lib/actions/tools/retro";
import "@/lib/actions/tools/retro-actions";
import "@/lib/actions/tools/six-hats";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const call = <T>(id: string, params: Record<string, unknown> = {}) =>
  registry.get(id)!.handler(params, ctx) as Promise<T>;
const ws = () => useWorkspaceStore.getState();
const current = () => ws().retroBoards?.find((b) => b.id === "retro:current");

const S1: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  pointsPlanned: 8,
  status: "active",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T10:00:00"));
  useWorkspaceStore.setState({
    retroBoards: [],
    sprints: [S1],
    stories: [],
    sprintGoals: [],
    impediments: [],
    moodEntries: [],
    kudos: [],
    kanbanBoards: [],
    sixHatsThoughts: [],
    sixHatsSessions: [],
  });
  return () => vi.useRealTimers();
});

describe("tool.retro", () => {
  it("start makes the current board for the sprint whose retro window holds today", async () => {
    expect(await call("tool.retro.start")).toEqual({
      started: true,
      id: "retro:current",
      sprintId: "s1",
    });
    expect(current()).toMatchObject({
      format: { id: retroFormats[0].id },
      sprintId: "s1",
      phase: "write",
    });
    expect(await call("tool.retro.start")).toEqual({
      started: false,
      reason: "already_started",
      id: "retro:current",
    });
  });

  it("start refuses an unknown format or sprint", async () => {
    expect(await call("tool.retro.start", { formatId: "nope" })).toMatchObject({
      started: false,
      reason: "unknown_format",
    });
    expect(await call("tool.retro.start", { sprintId: "nope" })).toEqual({
      started: false,
      reason: "unknown_sprint",
    });
  });

  it("set_sprint tags the board; add_card checks the column and trims", async () => {
    expect(await call("tool.retro.set_sprint", { sprintId: "s1" })).toEqual({
      updated: false,
      reason: "no_retro",
    });
    useWorkspaceStore.setState({ retroBoards: [blankRetroBoard(retroFormats[0])] });
    expect(await call("tool.retro.set_sprint", { sprintId: "s1" })).toEqual({ updated: true });
    expect(current()?.sprintId).toBe("s1");

    const column = retroFormats[0].columns[0].key;
    expect(await call("tool.retro.add_card", { columnKey: "nope", text: "x" })).toMatchObject({
      added: false,
      reason: "unknown_column",
    });
    const added = await call<{ added: boolean; id: string }>("tool.retro.add_card", {
      columnKey: column,
      text: `  ${"y".repeat(600)}  `,
    });
    expect(added.added).toBe(true);
    expect(current()?.cards[0].text).toHaveLength(500);
  });

  it("list_state reports the board's sprint and its facts", async () => {
    useWorkspaceStore.setState({
      retroBoards: [{ ...blankRetroBoard(retroFormats[0]), sprintId: "s1" }],
      stories: [
        { id: "a", title: "A", points: 5, status: "done", sprintId: "s1", doneAt: "2026-10-22" },
      ],
      impediments: [{ id: "i", title: "VPN", severity: "high", raisedAt: "2026-10-14" }],
    });
    const r = await call<{ sprintId: string; facts: Record<string, unknown> }>(
      "tool.retro.list_state"
    );
    expect(r.sprintId).toBe("s1");
    expect(r.facts).toMatchObject({
      sprintName: "Sprint 1",
      completed: 5,
      impediments: { raised: 1, stillOpen: 1 },
      burndown: { shape: "late" },
    });
  });
});

describe("tool.retro_actions", () => {
  const archived = (cards: RetroBoard["cards"]): RetroBoard => ({
    ...blankRetroBoard(retroFormats[0]),
    id: "retro:2026-10-09",
    archivedAt: "2026-10-09T15:00:00Z",
    cards,
  });

  it("add quick-adds onto the newest archive without a current retro", async () => {
    expect(await call("tool.retro_actions.add", { text: "x" })).toEqual({
      added: false,
      reason: "no_retro",
    });
    useWorkspaceStore.setState({ retroBoards: [archived([])] });
    const r = await call<{ added: boolean; id: string; boardId: string }>(
      "tool.retro_actions.add",
      {
        text: "  Pair on deploys ",
        assignee: "Sam",
        dueDate: "2026-10-30",
      }
    );
    expect(r).toMatchObject({ added: true, boardId: "retro:2026-10-09" });
    expect(ws().retroBoards?.[0].cards[0]).toMatchObject({
      id: r.id,
      text: "Pair on deploys",
      assignee: "Sam",
      dueDate: "2026-10-30",
      isActionItem: true,
    });
  });

  it("list counts an action done when its impediment is resolved, with follow-through per retro", async () => {
    useWorkspaceStore.setState({
      retroBoards: [
        archived([
          {
            id: "a1",
            columnKey: "start",
            text: "Fix the VPN",
            votes: 0,
            groupedWith: null,
            isActionItem: true,
            assignee: "",
            discussing: false,
            sentTo: [{ route: "impediment", targetId: "imp1", at: "2026-10-09" }],
          },
          {
            id: "a2",
            columnKey: "start",
            text: "Write docs",
            votes: 0,
            groupedWith: null,
            isActionItem: true,
            assignee: "",
            discussing: false,
          },
        ]),
      ],
      impediments: [
        {
          id: "imp1",
          title: "VPN",
          severity: "high",
          raisedAt: "2026-10-09",
          resolvedAt: "2026-10-12",
        },
      ],
    });
    const r = await call<{
      done: number;
      open: number;
      followThrough: { agreed: number; done: number; rate: number }[];
    }>("tool.retro_actions.list");
    expect(r).toMatchObject({ done: 1, open: 1 });
    expect(r.followThrough).toEqual([expect.objectContaining({ agreed: 2, done: 1, rate: 0.5 })]);
  });

  it("list counts an action done when the story it became is done, and open again once that story is deleted", async () => {
    const action = {
      id: "a1",
      columnKey: "start",
      text: "Pair on deploys",
      votes: 0,
      groupedWith: null,
      isActionItem: true,
      assignee: "",
      discussing: false,
      sentTo: [{ route: "backlog-story" as const, targetId: "st1", at: "2026-10-09" }],
    };
    useWorkspaceStore.setState({
      retroBoards: [archived([action])],
      stories: [{ id: "st1", title: "Pair on deploys", status: "in_progress", sprintId: "s1" }],
    });
    type Listing = {
      done: number;
      open: number;
      actions: { id: string; done: boolean; closedByTarget: boolean }[];
    };
    const open = await call<Listing>("tool.retro_actions.list");
    expect(open).toMatchObject({ done: 0, open: 1 });

    useWorkspaceStore.setState({
      stories: [{ id: "st1", title: "Pair on deploys", status: "done", sprintId: "s1" }],
    });
    const done = await call<Listing>("tool.retro_actions.list");
    expect(done).toMatchObject({ done: 1, open: 0 });
    expect(done.actions[0]).toMatchObject({ id: "a1", done: true, closedByTarget: true });

    // The story is deleted: its link stops counting.
    useWorkspaceStore.setState({ stories: [] });
    const reopened = await call<Listing>("tool.retro_actions.list");
    expect(reopened).toMatchObject({ done: 0, open: 1 });
    expect(reopened.actions[0]).toMatchObject({ done: false, closedByTarget: false });
  });
});

describe("tool.six_hats sessions", () => {
  it("starts a session, files thoughts in it, and exports it with its summary", async () => {
    const before = await call<{ id: string; sessionId: null }>("tool.six_hats.log_thought", {
      hat: "white",
      text: "Before any session",
    });
    expect(before.sessionId).toBeNull();

    const { id } = await call<{ id: string }>("tool.six_hats.start_session", {
      topic: "Move to monorepo",
    });
    expect(ws().sixHatsSessions?.[0]).toMatchObject({
      id,
      topic: "Move to monorepo",
      roundMinutes: 5,
    });
    expect(ws().sixHatsSessions?.[0].order[0]).toBe("blue");

    const t = await call<{ sessionId: string }>("tool.six_hats.log_thought", {
      hat: "black",
      text: "Build times",
    });
    expect(t.sessionId).toBe(id);
    expect(
      await call("tool.six_hats.log_thought", { hat: "red", text: "x", sessionId: "nope" })
    ).toEqual({
      error: "unknown_session",
    });

    expect(
      await call("tool.six_hats.set_summary", { sessionId: id, summary: "Do it next quarter." })
    ).toEqual({
      updated: true,
    });
    const md = await call<{ markdown: string }>("tool.six_hats.export_session", { sessionId: id });
    expect(md.markdown).toContain("# Six Thinking Hats — Move to monorepo");
    expect(md.markdown).toContain("- Build times");
    expect(md.markdown).not.toContain("Before any session");
    expect(md.markdown).toContain("Do it next quarter.");

    const state = await call<{
      total: number;
      sessions: { id: string; thoughtCount: number; hasSummary: boolean }[];
    }>("tool.six_hats.list_state", { sessionId: id });
    expect(state.total).toBe(1);
    expect(state.sessions).toEqual([
      expect.objectContaining({ id, thoughtCount: 1, hasSummary: true }),
    ]);

    expect(await call("tool.six_hats.close_session", { sessionId: id })).toEqual({ updated: true });
    const after = await call<{ sessionId: null }>("tool.six_hats.log_thought", {
      hat: "green",
      text: "Later",
    });
    expect(after.sessionId).toBeNull();
  });

  it("keeps sessions through a workspace export and import", () => {
    ws().upsertSixHatsSession({
      id: "sh1",
      topic: "T",
      order: ["white"],
      roundMinutes: 3,
      startedAt: "2026-10-24T10:00:00Z",
    });
    const json = ws().exportJSON();
    useWorkspaceStore.setState({ sixHatsSessions: [] });
    ws().importJSON(json);
    expect(ws().sixHatsSessions?.map((x) => x.id)).toEqual(["sh1"]);
    ws().removeSixHatsSession("sh1");
    expect(ws().sixHatsSessions).toEqual([]);
  });
});

describe("parity with the rebuilt pages", () => {
  it("set_sprint unlinks with null", async () => {
    useWorkspaceStore.setState({
      retroBoards: [{ ...blankRetroBoard(retroFormats[0]), sprintId: "s1" }],
    });
    expect(await call("tool.retro.set_sprint", { sprintId: null })).toEqual({ updated: true });
    expect("sprintId" in (current() ?? {})).toBe(false);
  });

  it("retro_actions.update edits text, owner and due date, and clears them", async () => {
    useWorkspaceStore.setState({
      retroBoards: [
        {
          ...blankRetroBoard(retroFormats[0]),
          cards: [
            {
              id: "a1",
              columnKey: "start",
              text: "Old",
              votes: 0,
              groupedWith: null,
              isActionItem: true,
              assignee: "Sam",
              discussing: false,
              dueDate: "2026-10-30",
            },
          ],
        },
      ],
    });
    expect(
      await call("tool.retro_actions.update", { cardId: "a1", text: " New ", assignee: "Bo" })
    ).toEqual({ updated: true, boardId: "retro:current" });
    expect(current()?.cards[0]).toMatchObject({
      text: "New",
      assignee: "Bo",
      dueDate: "2026-10-30",
    });
    await call("tool.retro_actions.update", { cardId: "a1", assignee: null, dueDate: null });
    expect(current()?.cards[0].assignee).toBe("");
    expect("dueDate" in (current()?.cards[0] ?? {})).toBe(false);
    expect(await call("tool.retro_actions.update", { cardId: "nope", text: "x" })).toEqual({
      updated: false,
    });
  });

  it("six_hats closes only with a summary, and reopens on the last round", async () => {
    const { id } = await call<{ id: string }>("tool.six_hats.start_session", { topic: "T" });
    expect(await call("tool.six_hats.close_session", { sessionId: id })).toEqual({
      updated: false,
      reason: "summary_required",
    });
    await call("tool.six_hats.set_summary", { sessionId: id, summary: "Done" });
    expect(await call("tool.six_hats.close_session", { sessionId: id })).toEqual({ updated: true });
    expect(await call("tool.six_hats.reopen_session", { sessionId: id })).toEqual({
      updated: true,
    });
    const session = ws().sixHatsSessions?.find((x) => x.id === id);
    expect(session?.closedAt).toBeUndefined();
    expect(session?.currentRound).toBe((session?.order.length ?? 1) - 1);
  });
});

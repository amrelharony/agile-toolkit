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
import { RETRO_COLUMN_PALETTE, retroFormats } from "@/lib/constants/retro-formats";
import { goalDocId } from "@/lib/sprints/goal-doc";

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
      formatId: retroFormats[0].id,
      columns: retroFormats[0].columns.map(({ key, label }) => ({ key, label })),
      votesPerPerson: 3,
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

  it("start makes a board in the agent's own columns, with the votes each asked for", async () => {
    const r = await call<Record<string, unknown>>("tool.retro.start", {
      name: "Team pulse",
      columns: [" Wins ", "Worries", "Glad"],
      votesPerPerson: 5,
    });
    expect(r).toMatchObject({
      started: true,
      id: "retro:current",
      sprintId: "s1",
      columns: [
        { key: "wins", label: "Wins" },
        { key: "worries", label: "Worries" },
        { key: "glad", label: "Glad" },
      ],
      votesPerPerson: 5,
    });
    expect(r.formatId).toMatch(/^custom-/);
    expect(current()).toMatchObject({
      format: { id: r.formatId, name: "Team pulse" },
      votesPerPerson: 5,
    });
    expect(current()!.format.columns.map((c) => c.color)).toEqual(RETRO_COLUMN_PALETTE.slice(0, 3));

    // Its columns take cards, and list_state reads them back.
    expect(
      await call("tool.retro.add_card", { columnKey: "worries", text: "Flaky CI" })
    ).toMatchObject({ added: true });
    expect(await call("tool.retro.list_state")).toMatchObject({
      formatId: r.formatId,
      formatName: "Team pulse",
      columns: [
        { key: "wins", label: "Wins" },
        { key: "worries", label: "Worries" },
        { key: "glad", label: "Glad" },
      ],
      votesPerPerson: 5,
      byColumn: [{ columnKey: "worries", count: 1 }],
    });
  });

  it("start names a custom format Custom by default, and refuses bad columns or both kinds", async () => {
    expect(await call("tool.retro.start", { formatId: "sailboat", columns: ["A", "B"] })).toEqual({
      started: false,
      reason: "format_or_columns",
    });
    expect(await call("tool.retro.start", { columns: ["Only"] })).toEqual({
      started: false,
      reason: "invalid_columns",
      errors: { columns: "Give it 2 to 6 columns." },
    });
    expect(await call("tool.retro.start", { columns: ["A", "a"] })).toMatchObject({
      reason: "invalid_columns",
      errors: { column1: "Give each column its own name." },
    });
    expect(current()).toBeUndefined();
    expect(await call("tool.retro.start", { columns: ["A", "B"] })).toMatchObject({
      started: true,
      votesPerPerson: 3,
    });
    expect(current()?.format.name).toBe("Custom");
    expect(current()).not.toHaveProperty("votesPerPerson");
  });

  it("set_votes changes the current board's votes each", async () => {
    expect(await call("tool.retro.set_votes", { votesPerPerson: 8 })).toEqual({
      updated: false,
      reason: "no_retro",
    });
    useWorkspaceStore.setState({ retroBoards: [blankRetroBoard(retroFormats[0])] });
    expect(await call("tool.retro.list_state")).toMatchObject({ votesPerPerson: 3 });
    expect(await call("tool.retro.set_votes", { votesPerPerson: 8 })).toEqual({
      updated: true,
      votesPerPerson: 8,
    });
    expect(current()?.votesPerPerson).toBe(8);
    expect(
      registry.get("tool.retro.set_votes")!.paramsSchema.safeParse({ votesPerPerson: 4 }).success
    ).toBe(false);
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
    // Every committed point done, no goal answer, no mood: nothing to suggest.
    expect(r).toMatchObject({ suggestedFormat: null });
  });

  it("list_state suggests the format the sprint's facts call for, as the picker does", async () => {
    useWorkspaceStore.setState({
      retroBoards: [{ ...blankRetroBoard(retroFormats[0]), sprintId: "s1" }],
      sprintGoals: [
        {
          id: goalDocId("s1"),
          businessObjective: "",
          goal: "Ship sign-in",
          criteria: [],
          keyResults: [],
          sprintId: "s1",
          outcome: { met: "partly", decidedAt: "2026-10-23" },
        },
      ],
    });
    const r = await call<{ suggestedFormat: unknown }>("tool.retro.list_state");
    expect(r.suggestedFormat).toEqual({
      formatId: "sailboat",
      reason: "Sprint 1 partly met its goal: look at what held it back and what lies ahead.",
    });
    // No sprint to read: no suggestion.
    useWorkspaceStore.setState({ retroBoards: [blankRetroBoard(retroFormats[0])] });
    expect(await call("tool.retro.list_state")).toMatchObject({
      facts: null,
      suggestedFormat: null,
    });
  });

  it("list_state calls no running sprint's open work unfinished", async () => {
    // Started two days ago: nothing done yet.
    const S2: Sprint = {
      id: "s2",
      name: "Sprint 2",
      startDate: "2026-10-22",
      endDate: "2026-11-04",
      pointsPlanned: 0,
      status: "active",
    };
    useWorkspaceStore.setState({
      sprints: [S1, S2],
      stories: [
        { id: "a", title: "A", points: 8, status: "todo", sprintId: "s2" },
        { id: "b", title: "B", points: 12, status: "in_progress", sprintId: "s2" },
      ],
    });
    const early = await call<{ facts: Record<string, unknown>; suggestedFormat: unknown }>(
      "tool.retro.list_state",
      { sprintId: "s2" }
    );
    expect(early.facts).toMatchObject({ committed: 20, completed: 0 });
    expect(early.suggestedFormat).toBeNull();
    // On its last day the open work is unfinished.
    vi.setSystemTime(new Date("2026-11-04T16:00:00"));
    const last = await call<{ suggestedFormat: unknown }>("tool.retro.list_state", {
      sprintId: "s2",
    });
    expect(last.suggestedFormat).toMatchObject({ formatId: "daki" });
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

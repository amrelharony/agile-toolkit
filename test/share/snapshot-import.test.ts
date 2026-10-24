import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { SNAPSHOT_IMPORTERS, snapshotValidators } from "@/lib/share/snapshot-import";
import type { StoryMap } from "@/lib/stores/workspace-types";

beforeEach(() => {
  useWorkspaceStore.setState({ retroBoards: [], prioritizations: [], okrs: [], storyMaps: [] });
});

const retroState = {
  format: {
    id: "start-stop-continue",
    name: "Start / Stop / Continue",
    description: "",
    columns: [{ key: "start", label: "Start", color: "green", icon: "▶" }],
  },
  cards: [
    {
      id: "c1",
      columnKey: "start",
      text: "Pair on CI",
      votes: 3,
      groupedWith: null,
      isActionItem: true,
      assignee: "Sam",
    },
  ],
};

describe("snapshot import", () => {
  it("adds a shared retro as a past retro, never touching the current board, and undoes cleanly", () => {
    useWorkspaceStore.setState({
      retroBoards: [
        {
          ...retroState,
          id: "retro:current",
          phase: "write",
          userVotes: 0,
          timerSeconds: 300,
          timerRunning: false,
          discussingIndex: 0,
        } as never,
      ],
    });
    const undo = SNAPSHOT_IMPORTERS.retro.importState(retroState);
    expect(undo).toBeTypeOf("function");
    const boards = useWorkspaceStore.getState().retroBoards!;
    expect(boards.find((b) => b.id === "retro:current")).toBeDefined();
    const archived = boards.find((b) => b.archivedAt);
    expect(archived?.cards[0]).toMatchObject({
      text: "Pair on CI",
      isActionItem: true,
      assignee: "Sam",
      discussing: false,
    });
    undo!();
    expect(useWorkspaceStore.getState().retroBoards!.map((b) => b.id)).toEqual(["retro:current"]);
  });

  it("makes room among full past retros, and Undo puts the oldest back", () => {
    const past = Array.from({ length: 20 }, (_, i) => ({
      ...retroState,
      id: `retro:${i}`,
      archivedAt: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
    }));
    useWorkspaceStore.setState({ retroBoards: past as never });
    const undo = SNAPSHOT_IMPORTERS.retro.importState(retroState);
    const ids = useWorkspaceStore.getState().retroBoards!.map((b) => b.id);
    expect(ids).toHaveLength(20);
    expect(ids).not.toContain("retro:0");
    undo!();
    expect(
      useWorkspaceStore
        .getState()
        .retroBoards!.map((b) => b.id)
        .sort()
    ).toEqual(past.map((b) => b.id).sort());
  });

  it("adds WSJF rows with new ids and only known fields", () => {
    const undo = SNAPSHOT_IMPORTERS.wsjf.importState([
      {
        id: "x",
        framework: "wsjf",
        title: "Apple Pay",
        fields: { bv: 8, size: 3, evil: { nested: 1 } },
        backlogItemId: "b-9",
        __proto__: { polluted: true },
      },
    ]);
    const rows = useWorkspaceStore.getState().prioritizations!;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe("x");
    expect(rows[0].fields).toEqual({ bv: 8, size: 3 });
    expect(rows[0].backlogItemId).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    undo!();
    expect(useWorkspaceStore.getState().prioritizations).toHaveLength(0);
  });

  it("rejects state that doesn't match the tool", () => {
    expect(SNAPSHOT_IMPORTERS.wsjf.importState([{ framework: "rice", title: "x" }])).toBeNull();
    expect(SNAPSHOT_IMPORTERS.okrs.importState([{ objective: 5 }])).toBeNull();
    expect(SNAPSHOT_IMPORTERS.retro.importState({ format: {}, cards: "nope" })).toBeNull();
    expect(
      snapshotValidators.readStoryMap({
        steps: [{ id: "a", name: "A" }],
        slices: [{ id: "s", name: "S", cards: { ghost: [] } }],
      })
    ).toBeNull();
    expect(useWorkspaceStore.getState().prioritizations).toHaveLength(0);
  });

  it("replaces the story map and restores the previous one on undo", () => {
    const mine: StoryMap = {
      id: "story-mapper:current",
      steps: [{ id: "a", name: "Mine" }],
      slices: [],
    };
    useWorkspaceStore.setState({ storyMaps: [mine] });
    const undo = SNAPSHOT_IMPORTERS["story-mapper"].importState({
      steps: [{ id: "s1", name: "Browse" }],
      slices: [
        { id: "sl", name: "MVP", cards: { s1: [{ id: "c", title: "Search", color: "blue" }] } },
      ],
    });
    expect(useWorkspaceStore.getState().storyMaps![0].steps[0].name).toBe("Browse");
    undo!();
    expect(useWorkspaceStore.getState().storyMaps![0]).toEqual(mine);
  });
});

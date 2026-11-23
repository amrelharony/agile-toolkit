import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { SNAPSHOT_IMPORTERS, snapshotValidators } from "@/lib/share/snapshot-import";
import { KR_CHECK_IN_CAP, type StoryMap } from "@/lib/stores/workspace-types";
import { RETRO_ARCHIVE_LIMIT } from "@/app/(tools)/retro/archive";

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
    // Past retros are full: one a day, the oldest first.
    const past = Array.from({ length: RETRO_ARCHIVE_LIMIT }, (_, i) => ({
      ...retroState,
      id: `retro:${i}`,
      archivedAt: new Date(Date.UTC(2026, 0, 1 + i, 10)).toISOString(),
    }));
    useWorkspaceStore.setState({ retroBoards: past as never });
    const undo = SNAPSHOT_IMPORTERS.retro.importState(retroState);
    const ids = useWorkspaceStore.getState().retroBoards!.map((b) => b.id);
    expect(ids).toHaveLength(RETRO_ARCHIVE_LIMIT);
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

  it("keeps a key result's baseline, direction and dated check-ins, validated, with new ids", () => {
    const undo = SNAPSHOT_IMPORTERS.okrs.importState([
      {
        id: "okr_shared",
        objective: "Customers stay with us",
        quarter: "2026 Q4",
        keyResults: [
          {
            id: "kr_churn",
            title: "Monthly churn",
            target: 15,
            current: 18,
            unit: "%",
            confidence: 6,
            baseline: 22,
            direction: "decrease",
            checkIns: [
              { id: "c2", date: "2026-10-08", value: 19, confidence: 6, note: "Price fix shipped" },
              { id: "c1", date: "2026-10-01", value: 22 },
              { id: "bad-date", date: "1 Oct", value: 20 },
              { id: "bad-value", date: "2026-10-02", value: "20" },
              { id: "c3", date: "2026-10-15", value: 18, confidence: 42, note: 7 },
            ],
          },
          // A legacy key result: none of the three, and a confidence off the scale.
          { title: "Win-backs", target: 10, current: 2, confidence: 70, direction: "up" },
        ],
      },
    ]);
    const [okr] = useWorkspaceStore.getState().okrs;
    const [churn, winBacks] = okr.keyResults;
    expect(churn).toMatchObject({ baseline: 22, direction: "decrease", confidence: 6 });
    expect(churn.id).not.toBe("kr_churn");
    expect(churn.checkIns?.map((c) => [c.date, c.value, c.confidence, c.note])).toEqual([
      ["2026-10-01", 22, undefined, undefined],
      ["2026-10-08", 19, 6, "Price fix shipped"],
      ["2026-10-15", 18, undefined, undefined],
    ]);
    expect(churn.checkIns?.map((c) => c.id)).not.toContain("c1");
    expect(winBacks).not.toHaveProperty("baseline");
    expect(winBacks).not.toHaveProperty("direction");
    expect(winBacks).not.toHaveProperty("checkIns");
    expect(winBacks).not.toHaveProperty("confidence");
    undo!();
    expect(useWorkspaceStore.getState().okrs).toHaveLength(0);
  });

  it("records check-ins as the OKR page does: nothing after tomorrow, current and confidence mirrored", () => {
    // 20 Oct 2026, noon local: only Date is faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    try {
      SNAPSHOT_IMPORTERS.okrs.importState([
        {
          objective: "Customers stay with us",
          quarter: "2026 Q4",
          keyResults: [
            {
              title: "Monthly churn",
              // Stale against its own history: the newest check-in says 17, scored 4.
              target: 15,
              current: 21,
              confidence: 8,
              baseline: 22,
              direction: "decrease",
              checkIns: [
                { date: "2026-10-13", value: 17, confidence: 4 },
                { date: "2026-10-06", value: 19, confidence: 7 },
                { date: "2026-10-22", value: 16, confidence: 9 }, // the day after tomorrow
                { date: "2026-02-30", value: 18 }, // no such day
              ],
            },
            // Checked in on the sharer's today, a zone ahead of the visitor's:
            // tomorrow here, kept, and the key result reads it.
            {
              title: "Win-backs",
              target: 10,
              current: 2,
              confidence: 5,
              checkIns: [
                { date: "2026-10-14", value: 3 },
                { date: "2026-10-21", value: 4, confidence: 6 },
              ],
            },
            // Every check-in in the future: none kept, the key result as sent.
            {
              title: "Referrals",
              target: 8,
              current: 1,
              confidence: 5,
              checkIns: [{ date: "2026-11-01", value: 9 }],
            },
          ],
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
    const [churn, winBacks, referrals] = useWorkspaceStore.getState().okrs[0].keyResults;
    expect(churn.checkIns?.map((c) => [c.date, c.value])).toEqual([
      ["2026-10-06", 19],
      ["2026-10-13", 17],
    ]);
    expect(churn).toMatchObject({ current: 17, confidence: 4 });
    expect(winBacks.checkIns?.map((c) => [c.date, c.value])).toEqual([
      ["2026-10-14", 3],
      ["2026-10-21", 4],
    ]);
    expect(winBacks).toMatchObject({ current: 4, confidence: 6 });
    expect(referrals).not.toHaveProperty("checkIns");
    expect(referrals).toMatchObject({ current: 1, confidence: 5 });
  });

  it("keeps at most KR_CHECK_IN_CAP check-ins on a key result, the newest", () => {
    const checkIns = Array.from({ length: KR_CHECK_IN_CAP + 3 }, (_, i) => ({
      id: `c${i}`,
      date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      value: i,
    }));
    SNAPSHOT_IMPORTERS.okrs.importState([
      {
        objective: "Grow",
        quarter: "2026 Q1",
        keyResults: [{ title: "Sign-ups", target: 100, current: 54, checkIns }],
      },
    ]);
    const kept = useWorkspaceStore.getState().okrs[0].keyResults[0].checkIns ?? [];
    expect(kept).toHaveLength(KR_CHECK_IN_CAP);
    expect(kept[0].value).toBe(3);
    expect(kept[kept.length - 1].value).toBe(KR_CHECK_IN_CAP + 2);
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

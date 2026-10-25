import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  AsyncUpdate,
  Impediment,
  RetroBoard,
  RetroCard,
  Sprint,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
} from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { blankReview } from "@/lib/sprints/review-doc";
import { storyProgress } from "@/lib/sprints/progress";
import { retroFormats } from "@/lib/constants/retro-formats";
import { isExampleId } from "@/components/tool-frame/example-data";

/**
 * The Sprint Cockpit's Phase 3 upgrade: done and remaining read off the
 * sprint board (the typed log only as the fallback, and labelled), the close
 * dialog's carry-over with one Undo, review and retro state per sprint,
 * impediments filtered to the sprint's window, a verdict, a Markdown export,
 * an in-memory example, and removing a team member with Undo.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown> = {}) => logs.push({ action, payload }),
    toolRunId: "test",
  }),
}));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/app/(tools)/burndown/charts", () => ({
  BurndownChart: ({ data }: { data: { day: number }[] }) => (
    <div data-testid="burndown-chart">{data.length} rows</div>
  ),
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE: d } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [d, () => {}] };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import {
  blockersTile,
  boardBurndownRows,
  cockpitBurndown,
  cockpitChartText,
  cockpitTiles,
  flowCards,
  gatherCockpitData,
  localDay,
  loggableDays,
  openImpediments,
  openUnpointed,
  resolvedDuring,
  retroFor,
  retroWindow,
  reviewFor,
  sprintImpediments,
  validateDayLog,
  type CockpitData,
  type CockpitSources,
} from "@/app/(tools)/sprint/view";
import { cockpitVerdict } from "@/app/(tools)/sprint/verdict";
import { cockpitMarkdown } from "@/app/(tools)/sprint/markdown";
import { buildExample } from "@/app/(tools)/sprint/example";
import { carryOverLine, closeSprint } from "@/app/(tools)/sprint/close";
import { validateMemberName } from "@/app/(tools)/sprint/components/start-flow";
import { timeboxLabel } from "@/app/(tools)/sprint/components/next-ceremony";
import {
  CloseSprintDialog,
  newSprintAfter,
  nextSprintAfter,
  type CarryOverPlan,
} from "@/components/sprints/close-sprint-dialog";
import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const TODAY = "2026-10-22"; // day 7 of S2

const S1: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-09-21",
  endDate: "2026-10-01",
  pointsPlanned: 30,
  pointsCompleted: 26,
  status: "completed",
};
const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};
const S3: Sprint = {
  id: "s3",
  name: "Sprint 3",
  startDate: "2026-10-26",
  endDate: "2026-11-05",
  pointsPlanned: 0,
  status: "planned",
};
/** A story as it was before it was estimated. */
const unpointed = (s: Story): Story => {
  const copy = { ...s };
  delete copy.points;
  return copy;
};

/** The old Velocity tool's placeholder dates: can't be placed on a calendar. */
const UNDATED: Sprint = {
  id: "u",
  name: "Sprint 9",
  startDate: "2020-01-01",
  endDate: "2020-01-02",
  pointsPlanned: 20,
  status: "active",
};

const at = (day: string) => `${day}T12:00:00.000Z`;

/** 30 points: 13 done on days 2 and 5, 17 left; one blocked, one unsized. */
const BOARD: Story[] = [
  {
    id: "a",
    title: "Save a card",
    points: 8,
    status: "done",
    sprintId: "s2",
    doneAt: at("2026-10-17"),
  },
  {
    id: "b",
    title: "Pay with it",
    points: 5,
    status: "done",
    sprintId: "s2",
    doneAt: at("2026-10-20"),
  },
  {
    id: "c",
    title: "Refund flow",
    points: 10,
    status: "in_progress",
    sprintId: "s2",
    blocked: true,
    owner: "Dev",
  },
  { id: "d", title: "Expiry reminders", points: 7, status: "todo", sprintId: "s2" },
  { id: "e", title: "Fraud checks", status: "todo", sprintId: "s2" },
  { id: "x", title: "Other sprint", points: 3, status: "todo", sprintId: "s1" },
];

const IMPS: Impediment[] = [
  {
    id: "before",
    title: "Gone before",
    severity: "high",
    raisedAt: "2026-10-01",
    resolvedAt: "2026-10-10",
  },
  { id: "old-open", title: "Still open", severity: "medium", raisedAt: "2026-10-01" },
  {
    id: "during-resolved",
    title: "Fixed mid-sprint",
    severity: "low",
    raisedAt: "2026-10-16",
    resolvedAt: "2026-10-18",
  },
  { id: "after", title: "After the sprint", severity: "critical", raisedAt: "2026-10-27" },
  {
    id: "esc",
    title: "Escalated one",
    severity: "low",
    raisedAt: "2026-10-20",
    escalatedAt: "2026-10-21",
  },
  {
    id: "late",
    title: "Overdue one",
    severity: "medium",
    raisedAt: "2026-10-16",
    dueDate: "2026-10-20",
  },
  { id: "crit", title: "Critical one", severity: "critical", raisedAt: "2026-10-21" },
];

const card = (id: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text: id,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...extra,
});
const board = (id: string, cards: RetroCard[], archivedAt?: string): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "write",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...(archivedAt ? { archivedAt } : {}),
});
const review = (id: string, extra: Partial<SprintReview> = {}): SprintReview => ({
  ...blankReview(null),
  id,
  ...extra,
});
const feature = {
  id: "f",
  name: "Demo it",
  description: "",
  acceptanceCriteria: "",
  timeMinutes: 5,
};

const sources = (over: Partial<CockpitSources> = {}): CockpitSources => ({
  sprint: S2,
  series: undefined,
  stories: BOARD,
  impediments: IMPS,
  standupEntries: [],
  teamMembers: [],
  retroBoards: [],
  reviews: [],
  sprints: [S1, S2, S3],
  today: TODAY,
  ...over,
});

/* ── Impediments in the sprint's window ────────────────────────────────── */

describe("impediments filtered to the sprint", () => {
  it("keeps what was in the way between the first and last day, escalated and overdue first", () => {
    expect(sprintImpediments(IMPS, S2, TODAY).map((i) => i.id)).toEqual([
      "esc",
      "late",
      "crit",
      "old-open",
      "during-resolved",
    ]);
  });

  it("an earlier sprint doesn't see today's blockers", () => {
    expect(sprintImpediments(IMPS, S1, TODAY).map((i) => i.id)).toEqual(["old-open", "before"]);
  });

  it("a sprint without real dates gets every unresolved one, as before", () => {
    expect(sprintImpediments(IMPS, UNDATED, TODAY).map((i) => i.id)).toEqual(
      openImpediments(IMPS, TODAY).map((i) => i.id)
    );
    expect(openImpediments(IMPS, TODAY).every((i) => !i.resolvedAt)).toBe(true);
  });

  it("counts as resolved during the sprint only what was resolved by its last day", () => {
    // "Gone before" was in Sprint 1's way but resolved nine days after it ended.
    const s1 = gatherCockpitData(sources({ sprint: S1, stories: [] }));
    expect(s1.sprintImpediments.map((i) => i.id)).toEqual(["old-open", "before"]);
    expect(s1.resolvedImpediments).toBe(0);
    // Sprint 2: "Fixed mid-sprint" only.
    expect(gatherCockpitData(sources()).resolvedImpediments).toBe(1);
    // Resolved on the last day still counts; a sprint without dates has none.
    expect(resolvedDuring([{ ...IMPS[0], resolvedAt: "2026-10-01T18:00:00.000Z" }], S1)).toBe(1);
    expect(resolvedDuring(IMPS, UNDATED)).toBe(0);
    expect(resolvedDuring([], S2)).toBe(0);
  });

  it("handles none and a full ISO raised time from an agent", () => {
    expect(sprintImpediments([], S2, TODAY)).toEqual([]);
    const agent: Impediment = {
      id: "iso",
      title: "Agent",
      severity: "low",
      raisedAt: "2026-10-18T09:30:00.000Z",
    };
    expect(sprintImpediments([agent], S2, TODAY).map((i) => i.id)).toEqual(["iso"]);
  });

  it("tiles the open ones and the blocked stories with their flags", () => {
    const open = sprintImpediments(IMPS, S2, TODAY).filter((i) => !i.resolvedAt);
    expect(blockersTile(open, { blockedStories: 1, today: TODAY })).toMatchObject({
      value: "5",
      unit: "blockers",
      hint: "1 escalated · 1 overdue · 1 high or critical · 1 blocked story",
      tone: "warning",
    });
    expect(blockersTile([], { blockedStories: 2 })).toMatchObject({
      value: "2",
      unit: "blockers",
      hint: "2 blocked stories",
      tone: "warning",
    });
    expect(blockersTile([], { blockedStories: 1 })).toMatchObject({ unit: "blocker" });
    // Without today nothing counts as overdue; resolved ones never count.
    expect(blockersTile(IMPS.filter((i) => i.id === "late" || i.id === "before"))).toMatchObject({
      value: "1",
      hint: "None high or critical",
      tone: "default",
    });
  });
});

/* ── Review and retro, per sprint ─────────────────────────────────────── */

describe("the review is this sprint's", () => {
  const draft = review("sprint-review:current", { features: [feature] });

  it("reads the sprint's own document, even an empty one", () => {
    const own = review("sprint-review:sprint:s2", { sprintId: "s2" });
    expect(reviewFor([draft, own], S2)).toEqual({ doc: own, fromDraft: false });
  });

  it("falls back to the draft only when it has content and isn't another sprint's", () => {
    expect(reviewFor([draft], S2)).toEqual({ doc: draft, fromDraft: true });
    expect(reviewFor([review("sprint-review:current")], S2).doc).toBeUndefined();
    expect(reviewFor([{ ...draft, sprintId: "s1" }], S2).doc).toBeUndefined();
    expect(reviewFor([], S2)).toEqual({ doc: undefined, fromDraft: false });
  });

  it("another sprint's review no longer counts as this one's", () => {
    const s1Review = review("sprint-review:sprint:s1", { sprintId: "s1", features: [feature] });
    const data = gatherCockpitData(sources({ reviews: [s1Review] }));
    expect(data.review).toMatchObject({ demoItems: 0, started: false });
    expect(flowCards(data).find((c) => c.kind === "review")).toMatchObject({
      state: "todo",
      line: "No demo script yet",
      href: "/sprint-review?sprint=s2",
    });
  });

  it("a started review without demo items is in progress; the draft says it's the draft", () => {
    const started = review("sprint-review:sprint:s2", {
      sprintId: "s2",
      feedbackItems: [{ id: "fb", stakeholder: "Ann", feedback: "Nice", category: "positive" }],
    });
    const cards = flowCards(gatherCockpitData(sources({ reviews: [started] })));
    expect(cards.find((c) => c.kind === "review")).toMatchObject({
      state: "doing",
      line: "Review started · no demo items yet",
    });
    const fromDraft = flowCards(gatherCockpitData(sources({ reviews: [draft] })));
    expect(fromDraft.find((c) => c.kind === "review")?.line).toBe(
      "1 demo item · in the draft review"
    );
  });
});

describe("the retro is this sprint's", () => {
  const current = board("retro:current", [card("c1"), card("c2"), card("c3")]);

  it("has a window from the first day to a week after the last", () => {
    expect(retroWindow(S2)).toEqual({ start: "2026-10-15", end: "2026-11-01" });
    expect(retroWindow(UNDATED)).toBeNull();
  });

  it("the current board with cards is in progress only while today is in the window", () => {
    expect(retroFor([current], S2, [S1, S2, S3], TODAY).current).toBe(current);
    expect(retroFor([current], S1, [S1, S2, S3], TODAY).current).toBeUndefined();
    expect(retroFor([current], UNDATED, [UNDATED], TODAY).current).toBe(current);
    const empty = board("retro:current", []);
    expect(retroFor([empty], S2, [S2], TODAY).current).toBeUndefined();
  });

  it("an archived board belongs to the sprint whose window holds it, the nearest end winning", () => {
    const after = board("retro:a", [card("a")], "2026-10-26T15:00:00.000Z");
    expect(retroFor([after], S2, [S1, S2, S3], TODAY).archived).toBe(after);
    // Sprint 3's window holds it too, but Sprint 2 ended nearer.
    expect(retroFor([after], S3, [S1, S2, S3], TODAY).archived).toBeUndefined();
    const before = board("retro:b", [card("b")], "2026-10-10T10:00:00.000Z");
    expect(retroFor([before], S1, [S1, S2, S3], TODAY).archived).toBeUndefined();
    expect(retroFor([before], S2, [S1, S2, S3], TODAY).archived).toBeUndefined();
    const s1Retro = board("retro:c", [card("c")], "2026-10-04T10:00:00.000Z");
    expect(retroFor([s1Retro], S1, [S1, S2, S3], TODAY).archived).toBe(s1Retro);
  });

  it("a tie goes to the sprint that had already ended", () => {
    const a: Sprint = { ...S1, id: "ta", startDate: "2026-09-30", endDate: "2026-10-10" };
    const b: Sprint = { ...S1, id: "tb", startDate: "2026-10-01", endDate: "2026-10-14" };
    const mid = board("retro:t", [card("t")], "2026-10-12");
    expect(retroFor([mid], a, [a, b], TODAY).archived).toBe(mid);
    expect(retroFor([mid], b, [a, b], TODAY).archived).toBeUndefined();
  });

  it("the latest of several archived boards wins", () => {
    const first = board("retro:1", [card("1")], "2026-10-24T09:00:00.000Z");
    const second = board("retro:2", [card("2")], "2026-10-25T09:00:00.000Z");
    expect(retroFor([second, first], S2, [S2], TODAY).archived).toBe(second);
  });

  it("reads RetroBoard.sprintId when a board carries one (Phase 4)", () => {
    const tagged = { ...board("retro:x", [card("x")], "2026-10-24T10:00:00.000Z"), sprintId: "s3" };
    expect(retroFor([tagged as RetroBoard], S2, [S2, S3], TODAY).archived).toBeUndefined();
    expect(retroFor([tagged as RetroBoard], S3, [S2, S3], TODAY).archived).toBe(tagged);
    const taggedCurrent = { ...current, sprintId: "s1" } as RetroBoard;
    expect(retroFor([taggedCurrent], S1, [S1, S2], TODAY).current).toBe(taggedCurrent);
    expect(retroFor([taggedCurrent], S2, [S1, S2], TODAY).current).toBeUndefined();
  });

  it("says when there's no retro for the sprint yet, with the open actions", () => {
    const old = board(
      "retro:old",
      [card("a1", { isActionItem: true }), card("a2", { isActionItem: true, done: true })],
      "2026-10-10T10:00:00.000Z"
    );
    const data = gatherCockpitData(sources({ retroBoards: [old] }));
    expect(data.retro).toEqual({ hasRetro: false, openActions: 1, overdue: 0, currentCards: 0 });
    expect(flowCards(data).find((c) => c.kind === "retro")).toMatchObject({
      state: "todo",
      line: "No retro for this sprint yet · 1 open action",
    });
    const held = board("retro:held", [card("h")], "2026-10-25T16:00:00.000Z");
    const withRetro = gatherCockpitData(sources({ retroBoards: [held] }));
    expect(withRetro.retro).toMatchObject({ hasRetro: true, archivedAt: held.archivedAt });
    expect(withRetro.retroBoard).toBe(held);
  });

  it("reads timestamps by their local day", () => {
    expect(localDay("2026-10-12")).toBe("2026-10-12");
    expect(localDay(undefined)).toBeNull();
    expect(localDay("not a date")).toBeNull();
    const local = new Date(2026, 9, 12, 23, 30);
    expect(localDay(local.toISOString())).toBe("2026-10-12");
  });
});

/* ── Numbers from the board ────────────────────────────────────────────── */

describe("done and remaining come from the board", () => {
  it("burns down by the days stories were done, the last point matching the tiles", () => {
    const rows = boardBurndownRows(S2, BOARD, TODAY);
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.actual)).toEqual([30, 30, 22, 22, 22, 17, 17, 17, null, null, null]);
    expect(rows.map((r) => r.ideal)).toEqual([30, 27, 24, 21, 18, 15, 12, 9, 6, 3, 0]);
    expect(storyProgress(BOARD, "s2").remaining).toBe(17);
  });

  it("an unstamped done story counts from day 0; the history stands in for doneAt", () => {
    const stories: Story[] = [
      { id: "old", title: "Old", points: 4, status: "done", sprintId: "s2" },
      {
        id: "hist",
        title: "History",
        points: 6,
        status: "done",
        sprintId: "s2",
        statusHistory: [
          { status: "in_progress", from: "todo", at: at("2026-10-16") },
          { status: "done", from: "in_progress", at: at("2026-10-19") },
        ],
      },
      { id: "open", title: "Open", points: 10, status: "todo", sprintId: "s2" },
    ];
    expect(
      boardBurndownRows(S2, stories, TODAY)
        .map((r) => r.actual)
        .slice(0, 8)
    ).toEqual([16, 16, 16, 16, 10, 10, 10, 10]);
  });

  it("stories done before the start count on day 0, after the end on the last day", () => {
    const stories: Story[] = [
      {
        id: "early",
        title: "Early",
        points: 2,
        status: "done",
        sprintId: "s2",
        doneAt: at("2026-10-01"),
      },
      {
        id: "late",
        title: "Late",
        points: 3,
        status: "done",
        sprintId: "s2",
        doneAt: at("2026-10-28"),
      },
      { id: "open", title: "Open", points: 5, status: "todo", sprintId: "s2" },
    ];
    const rows = boardBurndownRows(S2, stories, "2026-10-30");
    expect(rows[0].actual).toBe(8);
    expect(rows[10].actual).toBe(5);
  });

  it("before the start there is only the ideal line, and the summary says so", () => {
    const burndown = cockpitBurndown(
      S3,
      undefined,
      [{ id: "n", title: "Next", points: 5, status: "todo", sprintId: "s3" }],
      TODAY
    );
    expect(burndown.source).toBe("stories");
    expect(burndown.rows.every((r) => r.actual === null)).toBe(true);
    // No commitment yet: the ideal line starts from the board's scope.
    expect(burndown.rows[0].ideal).toBe(5);
    expect(cockpitChartText(burndown).summary).toBe(
      "Nothing has burned down yet; the ideal line falls from 5 points to 0 by day 10."
    );
  });

  it("falls back to the typed log without pointed stories, and says which", () => {
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 2, remaining: 27 },
      ],
    };
    const unsized = BOARD.map(unpointed);
    const log = cockpitBurndown(S2, series, unsized, TODAY);
    expect(log.source).toBe("log");
    expect(log.remaining).toEqual({ remaining: 27, source: "log", day: 2 });
    // Burndown's own rows: the logged days, the rest of the sprint blank.
    expect(log.rows.map((r) => r.actual)).toEqual([30, null, 27, ...Array(8).fill(null)]);
    expect(cockpitBurndown(S2, undefined, [], TODAY).source).toBe("none");
  });

  it("handles a huge board and zero points", () => {
    const many: Story[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `m${i}`,
      title: `M${i}`,
      points: 1,
      status: i % 2 === 0 ? "done" : "todo",
      sprintId: "s2",
      doneAt: at("2026-10-16"),
    }));
    const rows = boardBurndownRows(S2, many, TODAY);
    expect(rows[0].actual).toBe(2000);
    expect(rows[1].actual).toBe(1000);
    const zero: Story[] = [{ id: "z", title: "Z", points: 0, status: "done", sprintId: "s2" }];
    expect(cockpitBurndown(S2, undefined, zero, TODAY).source).toBe("none");
  });

  it("puts the board's numbers in the tiles", () => {
    const data = gatherCockpitData(sources());
    const tiles = Object.fromEntries(cockpitTiles(data, [S1, S2], TODAY).map((t) => [t.id, t]));
    expect(tiles.committed).toMatchObject({ value: "30" });
    // "Fraud checks" has no points: the board's numbers say they leave it out.
    expect(tiles.scope).toMatchObject({
      value: "30",
      hint: "No change since the plan · 1 story without points",
    });
    expect(tiles.done).toMatchObject({ value: "13", hint: "43% of the scope · from the board" });
    expect(tiles.remaining).toMatchObject({
      value: "17",
      hint: "3 stories to go · from the board",
    });
    expect(tiles.gap).toMatchObject({
      value: "Behind by 8 points",
      hint: "Ideal: 9 left on day 7 · 1 story without points",
      tone: "warning",
    });
    expect(tiles.finish).toMatchObject({
      value: "Day 15",
      hint: "Trend of the pointed stories · last day is day 10",
      tone: "warning",
    });
    expect(tiles.blockers).toMatchObject({ value: "5", unit: "blockers" });

    // Every story pointed: the hints are the plain ones.
    const sized = BOARD.map((s) => (s.id === "e" ? { ...s, points: 0.5 } : s));
    const plain = Object.fromEntries(
      cockpitTiles(gatherCockpitData(sources({ stories: sized })), [S2], TODAY).map((t) => [
        t.id,
        t,
      ])
    );
    expect(plain.scope).toMatchObject({ hint: "+0.5 since the plan" });
    expect(plain.gap).toMatchObject({ hint: "Ideal: 9 left on day 7" });
    expect(plain.finish).toMatchObject({ hint: "Trend of the board · last day is day 10" });
  });

  it("a partly pointed sprint never reads as finished, ahead or on time", () => {
    // Committed 30; the only pointed story (8) is done, "Refund flow" has no
    // points. The typed log said 27 left; the board can't say what's left.
    const stories: Story[] = [
      { id: "a", title: "Save a card", points: 8, status: "done", sprintId: "s2" },
      { id: "b", title: "Refund flow", status: "todo", sprintId: "s2" },
    ];
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 2, remaining: 27 },
      ],
    };
    const data = gatherCockpitData(sources({ stories, series, impediments: [] }));
    expect(data.burndown).toMatchObject({ source: "stories", unpointedOpen: 1 });
    const tiles = Object.fromEntries(cockpitTiles(data, [S2], TODAY).map((t) => [t.id, t]));
    for (const id of ["gap", "finish"] as const) {
      expect(tiles[id]).toMatchObject({
        value: "Can't tell yet",
        hint: "1 open story has no points",
        tone: "default",
        empty: true,
      });
    }
    expect(tiles.scope).toMatchObject({ hint: "−22 since the plan · 1 story without points" });
    expect(tiles.remaining).toMatchObject({ value: "0", hint: "1 story to go · from the board" });
    expect(cockpitVerdict(data, TODAY)).toBe(
      "Day 7 of 10: every pointed story is done, but 1 open story has no points yet, and nothing is blocking the team."
    );
    expect(cockpitChartText(data.burndown).summary).toBe(
      "No pointed work left on day 7. 1 open story has no points, so the board can't show all that's left."
    );

    // Ahead with an unpointed story: said with the caveat, never in a success tone.
    const ahead = gatherCockpitData(
      sources({
        stories: [
          { id: "a", title: "A", points: 20, status: "done", sprintId: "s2", doneAt: at(TODAY) },
          { id: "c", title: "C", points: 5, status: "todo", sprintId: "s2" },
          { id: "b", title: "B", status: "todo", sprintId: "s2" },
        ],
        impediments: [],
      })
    );
    const aheadTiles = Object.fromEntries(cockpitTiles(ahead, [S2], TODAY).map((t) => [t.id, t]));
    expect(aheadTiles.gap).toMatchObject({
      value: "Ahead by 4 points",
      hint: "Ideal: 9 left on day 7 · 1 story without points",
      tone: "default",
    });
    expect(aheadTiles.finish.tone).not.toBe("success");
    expect(cockpitVerdict(ahead, TODAY)).toBe(
      "Day 7 of 10: 20 of 25 points done, ahead by 4 points (not counting 1 story without points), and nothing is blocking the team."
    );
    expect(cockpitChartText(ahead.burndown).summary).toMatch(
      /1 open story has no points, so the board can't show all that's left\.$/
    );
    // Ended with nothing left on the board but a story still open: not "everything done".
    expect(
      cockpitVerdict(gatherCockpitData(sources({ stories, today: "2026-10-28" })), "2026-10-28")
    ).toBe(
      "Sprint 2 ended 3 days ago with 1 unfinished story: close it and decide where the unfinished stories go."
    );
  });

  it("an all-done board is finished; a future sprint hasn't started", () => {
    const done = BOARD.filter((s) => s.sprintId === "s2").map((s) => ({
      ...s,
      status: "done" as const,
      doneAt: s.doneAt ?? at("2026-10-21"),
    }));
    const finished = gatherCockpitData(sources({ stories: done }));
    const tiles = Object.fromEntries(cockpitTiles(finished, [S2], TODAY).map((t) => [t.id, t]));
    expect(tiles.finish).toMatchObject({ value: "Finished", tone: "success" });
    expect(tiles.remaining).toMatchObject({
      value: "0",
      hint: "Every story done · from the board",
    });

    const next = gatherCockpitData(
      sources({
        sprint: S3,
        stories: [{ id: "n", title: "N", points: 3, status: "todo", sprintId: "s3" }],
      })
    );
    const future = Object.fromEntries(cockpitTiles(next, [S3], TODAY).map((t) => [t.id, t]));
    expect(future.gap).toMatchObject({ value: "Not started yet", empty: true });
    expect(future.scope).toMatchObject({ hint: "From the sprint board" });
  });

  it("keeps the hub's tiles when the numbers are typed", () => {
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 2, remaining: 27 },
      ],
    };
    const data = gatherCockpitData(sources({ series, stories: [] }));
    const tiles = Object.fromEntries(cockpitTiles(data, [S2], TODAY).map((t) => [t.id, t]));
    expect(tiles.remaining).toMatchObject({ value: "27", hint: "On day 2" });
  });

  it("counts blocked stories, today's async updates and unresolved blockers", () => {
    const entries: StandupEntry[] = [
      {
        id: "1",
        member: "Ann",
        date: TODAY,
        yesterday: "",
        today: "",
        blockers: "API",
        timestamp: 0,
      },
      {
        id: "2",
        member: "Bob",
        date: TODAY,
        yesterday: "",
        today: "",
        blockers: "Fixed",
        blockerResolved: true,
        timestamp: 0,
      },
    ];
    // An async update from before both modes wrote standup entries.
    const asyncUpdates: AsyncUpdate[] = [
      { id: "old-async", member: "Cy", date: TODAY, yesterday: "", today: "" },
    ];
    const data = gatherCockpitData(
      sources({ standupEntries: entries, asyncUpdates, teamMembers: [] })
    );
    expect(data.standup).toEqual({ posted: 3, members: 0, blockers: 1 });
    expect(data.blockedStories.map((s) => s.id)).toEqual(["c"]);
  });
});

describe("the chart in words, off the board", () => {
  it("on the first day reads the board's start, not 'No days logged'", () => {
    const stories: Story[] = [
      { id: "p1", title: "P1", points: 5, status: "todo", sprintId: "s2" },
      { id: "p2", title: "P2", points: 3, status: "in_progress", sprintId: "s2" },
    ];
    const burndown = cockpitBurndown({ ...S2, pointsPlanned: 8 }, undefined, stories, "2026-10-15");
    expect(burndown.rows.filter((r) => typeof r.actual === "number")).toHaveLength(1);
    const { summary } = cockpitChartText(burndown);
    expect(summary).toBe(
      "8 points left on day 0; the ideal line falls from 8 points to 0 by day 10."
    );
    expect(summary).not.toContain("No days logged");
  });

  it("without dates says what's done, not that nothing burned down", () => {
    const stories: Story[] = [
      { id: "u1", title: "U1", points: 5, status: "done", sprintId: "u" },
      { id: "u2", title: "U2", points: 15, status: "todo", sprintId: "u" },
    ];
    const burndown = cockpitBurndown(UNDATED, undefined, stories, TODAY);
    expect(burndown).toMatchObject({ source: "stories", dated: false });
    expect(burndown.rows.every((r) => r.actual === null)).toBe(true);
    expect(cockpitChartText(burndown).summary).toBe(
      "5 of 20 points done; set the sprint's dates to see the burndown by day."
    );
  });

  it("counts open stories without points the way the Refinement card does", () => {
    expect(openUnpointed(BOARD, "s2")).toBe(1);
    const zero: Story[] = [
      { id: "z", title: "Z", points: 0, status: "todo", sprintId: "s2" },
      { id: "n", title: "N", status: "done", sprintId: "s2" },
      { id: "o", title: "O", status: "todo", sprintId: "s1" },
    ];
    expect(openUnpointed(zero, "s2")).toBe(1);
    expect(openUnpointed([], "s2")).toBe(0);
    // Only the board's numbers carry it; a typed log is the whole picture.
    expect(cockpitBurndown(S2, SERIES2, BOARD.map(unpointed), TODAY).unpointedOpen).toBe(0);
  });

  it("keeps Burndown's summary when behind, with what the board leaves out", () => {
    expect(cockpitChartText(cockpitBurndown(S2, undefined, BOARD, TODAY)).summary).toBe(
      "Remaining points fell from 30 to 17 over 7 days; 8 points behind the ideal line. 1 open story has no points, so the board can't show all that's left."
    );
    const sized = BOARD.map((s) => (s.id === "e" ? { ...s, points: 1 } : s));
    expect(cockpitChartText(cockpitBurndown(S2, undefined, sized, TODAY)).summary).toBe(
      "Remaining points fell from 31 to 18 over 7 days; 9 points behind the ideal line."
    );
  });
});

/* ── A closed sprint ───────────────────────────────────────────────────── */

describe("a closed sprint keeps what was recorded", () => {
  // Closed on day 7 with 13 of 30 done; the 17 unfinished points went into Sprint 3.
  const closed: Sprint = { ...S2, status: "completed", pointsCompleted: 13 };
  const carried = BOARD.map((s) =>
    s.sprintId === "s2" && s.status !== "done" ? { ...s, sprintId: "s3" } : s
  );
  const tilesOf = (data: CockpitData) =>
    Object.fromEntries(cockpitTiles(data, [S1, data.sprint, S3], TODAY).map((t) => [t.id, t]));

  it("reads the points confirmed at close, not the board its stories left", () => {
    const data = gatherCockpitData(
      sources({ sprint: closed, stories: carried, sprints: [S1, closed, S3] })
    );
    expect(data.burndown.source).toBe("none");
    const tiles = tilesOf(data);
    expect(tiles.done).toMatchObject({ value: "13", hint: "When the sprint closed" });
    expect(tiles.scope).toMatchObject({ value: "30", hint: "No change since the plan" });
    for (const id of ["remaining", "gap", "finish"]) {
      expect(tiles[id]).toMatchObject({ empty: true });
    }
    expect(JSON.stringify(tiles)).not.toMatch(/Every story done|Finished|−17|from the board/);
    expect(cockpitVerdict(data, TODAY)).toBe(
      "Sprint 2 is closed: 13 of 30 points done (43%, missed the commitment)."
    );
    // The chart is the daily log's (none typed), not the board's 13 burning to 0.
    expect(data.burndown.rows.filter((r) => typeof r.actual === "number")).toEqual([
      { day: 0, ideal: 30, actual: 30 },
    ]);
    expect(cockpitChartText(data.burndown).summary).toBe(
      "No days logged yet; the ideal line falls from 30 points to 0 by day 10."
    );
    const out = cockpitMarkdown({ data, series: undefined, sprints: [S1, closed], today: TODAY });
    expect(out).toContain(
      "Done is what was confirmed when the sprint closed; no daily log was typed for it."
    );
    expect(out).not.toContain("## Burndown from the board");
  });

  it("an old closed sprint with a leftover pointed story keeps its recorded points", () => {
    // Sprint 1 closed with 26; "Other sprint" (3 points, to do) still names it.
    const data = gatherCockpitData(sources({ sprint: S1 }));
    expect(data.progress).toMatchObject({ scope: 3, done: 0 });
    expect(tilesOf(data).done).toMatchObject({ value: "26", hint: "When the sprint closed" });
    expect(cockpitVerdict(data, TODAY)).toBe(
      "Sprint 1 is closed: 26 of 30 points done (87%, close to the commitment)."
    );
  });

  it("with a typed log, the chart and the rest are the log's; Done is what was confirmed", () => {
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 10, remaining: 5 },
      ],
    };
    const data = gatherCockpitData(sources({ sprint: closed, series, stories: carried }));
    expect(data.burndown.source).toBe("log");
    const tiles = tilesOf(data);
    expect(tiles.done).toMatchObject({ value: "13", hint: "When the sprint closed" });
    expect(tiles.remaining).toMatchObject({ value: "5", hint: "On day 10" });
    expect(cockpitMarkdown({ data, series, sprints: [S1, closed], today: TODAY })).toContain(
      "Done is what was confirmed when the sprint closed; the rest is typed in the daily log."
    );
  });
});

/* ── The verdict ───────────────────────────────────────────────────────── */

describe("the verdict", () => {
  const verdict = (over: Partial<CockpitSources> = {}, today = TODAY) =>
    cockpitVerdict(gatherCockpitData(sources({ ...over, today })), today);

  it("reads the board mid-sprint", () => {
    expect(verdict()).toBe(
      "Day 7 of 10: 13 of 30 points done, behind by 8 points (not counting 1 story without points), and 5 blockers are open."
    );
    expect(
      verdict({
        impediments: [],
        stories: BOARD.map((s) => ({ ...s, blocked: false, points: s.points ?? 2 })),
      })
    ).toBe(
      "Day 7 of 10: 13 of 32 points done, behind by 10 points, and nothing is blocking the team."
    );
  });

  it("reads the typed log, or says nothing is recorded", () => {
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 2, remaining: 27 },
      ],
    };
    expect(verdict({ series, stories: [], impediments: [] })).toBe(
      "Day 7 of 10: 3 of 30 points done, behind by 3 points, and nothing is blocking the team."
    );
    expect(verdict({ stories: [], impediments: [IMPS[1]] })).toBe(
      "Day 7 of 10: no progress recorded yet (move stories on the sprint board or log the points left), and 1 blocker is open."
    );
  });

  it("before the start, after the end, closed, cancelled and undated", () => {
    expect(cockpitVerdict(gatherCockpitData(sources({ sprint: S3, stories: [] })), TODAY)).toBe(
      "Sprint 3 starts in 4 days with 0 points planned."
    );
    expect(verdict({}, "2026-10-28")).toBe(
      "Sprint 2 ended 3 days ago with 17 points left (not counting 1 story without points): close it and decide where the unfinished stories go."
    );
    const allDone = BOARD.map((s) => ({ ...s, status: "done" as const }));
    expect(verdict({ stories: allDone }, "2026-10-28")).toBe(
      "Sprint 2 ended with everything done: close it to record its velocity."
    );
    // Closed: the points confirmed at close against the commitment, never the board.
    expect(verdict({ sprint: { ...S2, status: "completed", pointsCompleted: 13 } })).toBe(
      "Sprint 2 is closed: 13 of 30 points done (43%, missed the commitment)."
    );
    expect(verdict({ sprint: { ...S2, status: "completed" } })).toBe(
      "Sprint 2 is closed, but its completed points aren't recorded yet."
    );
    expect(verdict({ sprint: S1, stories: [] })).toBe(
      "Sprint 1 is closed: 26 of 30 points done (87%, close to the commitment)."
    );
    // Sprint 1 still holds a leftover pointed story ("Other sprint", 3 points, to do).
    expect(verdict({ sprint: S1 })).toBe(
      "Sprint 1 is closed: 26 of 30 points done (87%, close to the commitment)."
    );
    expect(verdict({ sprint: { ...S1, pointsPlanned: 0 } })).toBe(
      "Sprint 1 is closed with 26 points done."
    );
    expect(verdict({ sprint: { ...S1, pointsCompleted: undefined }, stories: [] })).toBe(
      "Sprint 1 is closed, but its completed points aren't recorded yet."
    );
    expect(verdict({ sprint: { ...S2, status: "cancelled" } })).toBe("Sprint 2 was cancelled.");
    expect(verdict({ sprint: UNDATED, stories: [] })).toBe(
      "Sprint 9 has no dates yet, so its pace can't be read."
    );
  });
});

/* ── Logging a day ─────────────────────────────────────────────────────── */

describe("logging points left", () => {
  it("offers every day so far, the last day once the sprint is over, none before it", () => {
    expect(loggableDays(S2, TODAY)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(loggableDays(S2, "2026-11-20")).toHaveLength(11);
    expect(loggableDays(S3, TODAY)).toEqual([]);
    expect(loggableDays(UNDATED, TODAY)).toEqual([]);
  });

  it("needs a sprint day and 0 or more points, never a blank as 0", () => {
    const days = [0, 1, 2];
    expect(validateDayLog({ day: "2", remaining: "0" }, days)).toEqual({
      ok: true,
      values: { day: 2, remaining: 0 },
    });
    expect(validateDayLog({ day: "2", remaining: "" }, days)).toMatchObject({
      ok: false,
      errors: { remaining: "Enter 0 or more points." },
    });
    expect(validateDayLog({ day: "9", remaining: "-1" }, days)).toMatchObject({
      ok: false,
      errors: { day: "Pick a day of the sprint.", remaining: "Enter 0 or more points." },
    });
    expect(validateDayLog({ day: "1", remaining: "1e6" }, days)).toMatchObject({ ok: true });
  });
});

/* ── Markdown ──────────────────────────────────────────────────────────── */

describe("the Markdown export", () => {
  const md = (data: CockpitData, series?: SprintSeries) =>
    cockpitMarkdown({ data, series, sprints: [S1, S2], today: TODAY });

  it("leads with the verdict and the board's numbers", () => {
    const data = gatherCockpitData(
      sources({
        retroBoards: [board("retro:current", [card("c1")])],
        reviews: [review("sprint-review:current", { features: [feature] })],
      })
    );
    const out = md(data);
    expect(out).toContain("# Sprint 2");
    expect(out).toContain(
      "Day 7 of 10: 13 of 30 points done, behind by 8 points (not counting 1 story without points), and 5 blockers are open."
    );
    expect(out).toContain("| Done | 13 points | 43% of the scope · from the board |");
    expect(out).toContain("Done and remaining are read from the sprint board's stories.");
    expect(out).toContain("## Burndown from the board");
    expect(out).toContain("| 7 | 22 Oct | 9 | 17 |");
    expect(out).toContain("| Refund flow | 10 | In progress · blocked | Dev |");
    expect(out).toContain("| Escalated one | Low | 2026-10-20 |  | Escalated |");
    expect(out).toContain("| Overdue one | Medium | 2026-10-16 |  | Open · 2 days overdue |");
    expect(out).toContain("| Fixed mid-sprint | Low | 2026-10-16 |  | Resolved |");
    expect(out).not.toContain("After the sprint");
    expect(out).toContain("**Blocked stories:**\n- Refund flow (Dev)");
    expect(out).toContain("In progress: 1 card on the board.");
    expect(out).toContain("From the draft review: this sprint has no review of its own yet.");
    expect(out).toContain("- Demo it (5 min)");
  });

  it("shows the daily log when the numbers are typed, and empty sections plainly", () => {
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 2, remaining: 27 },
      ],
    };
    const out = md(gatherCockpitData(sources({ series, stories: [], impediments: [] })), series);
    expect(out).toContain("Done and remaining are typed in the daily log.");
    expect(out).toContain("## Daily log");
    expect(out).not.toContain("## Burndown from the board");
    expect(out).toContain("No stories planned into this sprint.");
    expect(out).toContain("Nothing got in the way.");
    expect(out).toContain("No retro for this sprint yet.");
    expect(out).toContain("No demo script or feedback recorded yet.");
  });

  it("escapes pipes and newlines in typed text", () => {
    const stories: Story[] = [
      { id: "p", title: "A | B\nC", points: 2, status: "todo", sprintId: "s2" },
    ];
    expect(md(gatherCockpitData(sources({ stories, impediments: [] })))).toContain(
      "| A \\| B C | 2 | To do |  |"
    );
  });
});

/* ── The example ───────────────────────────────────────────────────────── */

describe("the example", () => {
  it("uses example ids only, all in the example's current sprint", () => {
    const ex = buildExample(TODAY);
    for (const row of [...ex.stories, ...ex.impediments, ...ex.standupEntries, ...ex.teamMembers]) {
      expect(isExampleId(row.id), row.id).toBe(true);
    }
    expect(ex.sprints.every((s) => isExampleId(s.id))).toBe(true);
    expect(ex.stories.every((s) => s.sprintId === ex.current.id)).toBe(true);
  });

  it("tells the story it promises", () => {
    const ex = buildExample(TODAY);
    const data = gatherCockpitData({
      sprint: ex.current,
      series: ex.series.find((s) => s.id === ex.current.id),
      stories: ex.stories,
      impediments: ex.impediments,
      standupEntries: ex.standupEntries,
      teamMembers: ex.teamMembers,
      retroBoards: ex.retroBoards,
      reviews: ex.reviews,
      sprints: ex.sprints,
      today: TODAY,
    });
    expect(cockpitVerdict(data, TODAY)).toBe(
      "Day 5 of 14: 13 of 32 points done, ahead by 3.5 points (not counting 1 story without points), and 3 blockers are open."
    );
    expect(data.burndown.source).toBe("stories");
    expect(data.standup).toEqual({ posted: 3, members: 5, blockers: 1 });
    expect(data.retro).toMatchObject({ hasRetro: false, openActions: 2, overdue: 1 });
    expect(data.sprintImpediments).toHaveLength(3);
    expect(flowCards(data).find((c) => c.kind === "review")?.href).toBe("/sprint-review");
  });
});

/* ── The close dialog's carry-over ─────────────────────────────────────── */

describe("finding the next sprint", () => {
  it("is the earliest planned or active sprint starting after this one", () => {
    const later: Sprint = { ...S3, id: "s4", name: "Sprint 4", startDate: "2026-11-06" };
    expect(nextSprintAfter(S2, [S1, S2, later, S3])?.id).toBe("s3");
    expect(nextSprintAfter(S2, [S1, S2])).toBeUndefined();
    expect(nextSprintAfter(S2, [S2, { ...S3, status: "cancelled" }])).toBeUndefined();
    expect(nextSprintAfter(S2, [S2, { ...S3, id: "example-preview-sprint-9" }])).toBeUndefined();
  });

  it("creates one named on, starting the day after the end", () => {
    expect(newSprintAfter(S2, [S1, S2], 14)).toEqual({
      name: "Sprint 3",
      startDate: "2026-10-26",
      endDate: "2026-11-09",
      pointsPlanned: 0,
      status: "planned",
    });
    expect(newSprintAfter(UNDATED, [UNDATED], 10, TODAY)).toMatchObject({
      startDate: TODAY,
      endDate: "2026-11-01",
      name: "Sprint 10",
    });
  });
});

describe("CloseSprintDialog", () => {
  const open = BOARD.filter((s) => s.sprintId === "s2" && s.status !== "done");

  function dialog(props: Partial<Parameters<typeof CloseSprintDialog>[0]> = {}) {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CloseSprintDialog
        open
        onOpenChange={onOpenChange}
        sprint={S2}
        series={undefined}
        mode="close"
        stories={BOARD}
        sprints={[S1, S2, S3]}
        onConfirm={onConfirm}
        {...props}
      />
    );
    return { onConfirm, onOpenChange, dlg: screen.getByRole("dialog") };
  }

  it("suggests the board's done points and lists the unfinished stories", () => {
    const { dlg } = dialog();
    expect(within(dlg).getByLabelText(/Completed points/)).toHaveValue(13);
    expect(within(dlg).getByText(/the done stories add up to 13 points/)).toBeInTheDocument();
    const list = within(dlg).getByRole("list", { name: "Unfinished stories" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(list).toHaveTextContent("Refund flow10 points · In progress");
    expect(list).toHaveTextContent("Fraud checksNo points · To do");
    expect(
      within(dlg).getByText("17 points unfinished. Nothing moves until you choose.")
    ).toBeInTheDocument();
  });

  it("applies no default: closing asks first and focuses the choice", () => {
    const { dlg, onConfirm } = dialog();
    for (const radio of within(dlg).getAllByRole("radio")) expect(radio).not.toBeChecked();
    fireEvent.click(within(dlg).getByRole("button", { name: "Close sprint" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(within(dlg).getByRole("alert")).toHaveTextContent(
      "Choose where the unfinished stories go."
    );
    expect(document.activeElement).toBe(within(dlg).getByRole("radio", { name: "Into Sprint 3" }));
  });

  it("hands the plan over: into the next sprint, back to the backlog, or later", () => {
    const { dlg, onConfirm, onOpenChange } = dialog();
    fireEvent.click(within(dlg).getByRole("radio", { name: "Into Sprint 3" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Close sprint" }));
    expect(onConfirm).toHaveBeenCalledWith(13, {
      target: "next",
      stories: open,
      nextSprint: S3,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers to create the next sprint when there is none", () => {
    const { dlg, onConfirm } = dialog({ sprints: [S1, S2], nextLengthDays: 14 });
    const radio = within(dlg).getByRole("radio", { name: "Into a new sprint, Sprint 3" });
    expect(radio).toHaveAccessibleDescription(
      "There's no next sprint yet: this creates Sprint 3 (26 Oct – 9 Nov 2026) and moves them there."
    );
    fireEvent.click(radio);
    fireEvent.change(within(dlg).getByLabelText(/Completed points/), { target: { value: "12" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Close sprint" }));
    const plan = onConfirm.mock.calls[0][1] as CarryOverPlan;
    expect(onConfirm.mock.calls[0][0]).toBe(12);
    expect(plan).toMatchObject({ target: "next", newSprint: { name: "Sprint 3" } });
    expect(plan.nextSprint).toBeUndefined();
  });

  it("still validates the points", () => {
    const { dlg, onConfirm } = dialog();
    fireEvent.change(within(dlg).getByLabelText(/Completed points/), { target: { value: "" } });
    fireEvent.click(within(dlg).getByRole("radio", { name: "Back to the backlog" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Close sprint" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(within(dlg).getByText("Enter 0 or more points.")).toBeInTheDocument();
  });

  it("keeps Sprint Metrics' use unchanged: no stories, no carry-over step", () => {
    const { dlg, onConfirm } = dialog({ stories: undefined, sprints: undefined });
    expect(within(dlg).queryByRole("radio")).toBeNull();
    expect(
      within(dlg).getByText("Nothing is logged yet, so enter what the team finished.")
    ).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(/Completed points/), { target: { value: "5" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Close sprint" }));
    expect(onConfirm).toHaveBeenCalledWith(5, undefined);
  });

  it("asks nothing in points mode or when every story is done", () => {
    const pointsMode = dialog({ mode: "points" });
    expect(within(pointsMode.dlg).queryByRole("radio")).toBeNull();
    fireEvent.click(within(pointsMode.dlg).getByRole("button", { name: "Save points" }));
    expect(pointsMode.onConfirm).toHaveBeenCalledWith(13, undefined);
  });
});

describe("closeSprint", () => {
  const state = () => useWorkspaceStore.getState();
  const story = (id: string) => state().stories.find((s) => s.id === id);
  const plan = (
    target: CarryOverPlan["target"],
    extra: Partial<CarryOverPlan> = {}
  ): CarryOverPlan => ({
    target,
    stories: BOARD.filter((s) => s.sprintId === "s2" && s.status !== "done"),
    ...extra,
  });

  beforeEach(() => {
    useWorkspaceStore.setState({
      sprints: [S1, S2, S3],
      stories: [...BOARD, { id: "bl", title: "Backlogged", status: "backlog", sprintId: "s2" }],
    });
  });

  it("moves them into the next sprint keeping their status, and reverts", () => {
    const done = closeSprint("s2", 13, plan("next", { nextSprint: S3 }))!;
    expect(done).toMatchObject({ moved: 3, movedTo: { id: "s3" } });
    expect(state().sprints.find((s) => s.id === "s2")).toMatchObject({
      status: "completed",
      pointsCompleted: 13,
    });
    expect(story("c")).toMatchObject({ sprintId: "s3", status: "in_progress", blocked: true });
    expect(story("d")).toMatchObject({ sprintId: "s3", status: "todo" });
    expect(story("a")).toMatchObject({ sprintId: "s2", status: "done" });
    done.revert();
    expect(state().sprints.find((s) => s.id === "s2")).toEqual(S2);
    expect(story("c")).toEqual(BOARD[2]);
    expect(story("d")).toEqual(BOARD[3]);
  });

  it("creates the next sprint when asked, and Undo removes it again", () => {
    const newSprint = newSprintAfter(S2, [S1, S2], 10);
    const done = closeSprint("s2", 13, plan("next", { newSprint }))!;
    expect(done.created).toMatchObject({ name: "Sprint 3", status: "planned" });
    expect(state().sprints).toHaveLength(4);
    expect(story("c")?.sprintId).toBe(done.created?.id);
    done.revert();
    expect(state().sprints.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(story("c")?.sprintId).toBe("s2");
  });

  it("a backlog story carried into the next sprint becomes to do", () => {
    const withBacklog = { ...plan("next", { nextSprint: S3 }) };
    withBacklog.stories = [
      ...withBacklog.stories,
      { id: "bl", title: "Backlogged", status: "backlog", sprintId: "s2" },
    ];
    closeSprint("s2", 13, withBacklog);
    expect(story("bl")).toMatchObject({ sprintId: "s3", status: "todo" });
  });

  it("sends them back to the backlog with their stamps cleared", () => {
    const done = closeSprint("s2", 13, plan("backlog"))!;
    expect(done.moved).toBe(3);
    expect(story("c")?.sprintId).toBeUndefined();
    expect(story("c")?.status).toBe("backlog");
    done.revert();
    expect(story("c")).toEqual(BOARD[2]);
  });

  it("leaves them for Sprint Planning", () => {
    const done = closeSprint("s2", 13, plan("later"))!;
    expect(done.moved).toBe(0);
    expect(story("c")).toEqual(BOARD[2]);
    expect(carryOverLine(plan("later"))).toBe("3 unfinished stories wait in Sprint Planning.");
  });

  it("doesn't move a story finished since the dialog opened, nor close a missing sprint", () => {
    useWorkspaceStore.setState({
      stories: state().stories.map((s) => (s.id === "d" ? { ...s, status: "done" as const } : s)),
    });
    closeSprint("s2", 13, plan("backlog"));
    expect(story("d")).toMatchObject({ sprintId: "s2", status: "done" });
    expect(closeSprint("nope", 1, plan("backlog"))).toBeNull();
  });

  it("says where they went", () => {
    expect(carryOverLine(plan("next", { nextSprint: S3 }))).toBe(
      "3 unfinished stories moved to Sprint 3."
    );
    expect(carryOverLine(plan("next", { newSprint: newSprintAfter(S2, [S2]) }))).toBe(
      "3 unfinished stories moved to a new sprint, Sprint 3."
    );
    expect(carryOverLine(plan("backlog", { stories: [BOARD[2]] }))).toBe(
      "1 unfinished story went back to the backlog."
    );
    expect(carryOverLine(undefined)).toBeUndefined();
  });
});

/* ── Small pieces ──────────────────────────────────────────────────────── */

describe("small pieces", () => {
  it("validates a new team member's name", () => {
    const roster = [{ id: "m1", name: "Ann" }];
    expect(validateMemberName("  Bo   Li ", roster)).toEqual({
      ok: true,
      values: { name: "Bo Li" },
    });
    expect(validateMemberName("   ", roster)).toEqual({
      ok: false,
      errors: { name: "Type a name first." },
    });
    expect(validateMemberName(" ann ", roster)).toEqual({
      ok: false,
      errors: { name: "Ann is already on the team." },
    });
  });

  it("formats timeboxes", () => {
    expect(timeboxLabel(15)).toBe("15 min");
    expect(timeboxLabel(120)).toBe("2 h");
    expect(timeboxLabel(90)).toBe("1 h 30");
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const SERIES2: SprintSeries = {
  id: "s2",
  days: [
    { day: 0, remaining: 30 },
    { day: 2, remaining: 27 },
  ],
};

const lastUndo = () => {
  const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return {
    label: call[0] as string,
    description: call[1]?.description as string | undefined,
    undo: () => act(() => call[1].action.onClick()),
  };
};

function seed(over: Partial<ReturnType<typeof useWorkspaceStore.getState>> = {}) {
  useWorkspaceStore.setState({
    sprints: [S1, S2, S3],
    sprintSeries: [SERIES2],
    stories: BOARD,
    impediments: IMPS,
    teamMembers: [],
    standupEntries: [],
    asyncUpdates: [],
    retroBoards: [],
    sprintReviews: [],
    ...over,
  });
}

describe("the cockpit page", () => {
  const state = () => useWorkspaceStore.getState();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 8, 0, 0));
    logs.length = 0;
    toastSpy.mockReset();
    toastSpy.success.mockReset();
    exported.markdown = "";
    resetSelectedSprint();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/sprint");
  });

  afterEach(() => {
    vi.useRealTimers();
    useWorkspaceStore.setState({ sprints: [], stories: [], impediments: [], teamMembers: [] });
  });

  it("says where the sprint stands and reads the numbers off the board", () => {
    seed();
    const { container } = render(<SprintCockpit />);
    // The page counts the team's working days: 5 of the sprint's 7 are done
    // by day 7, so the ideal is 8.6 left (the pure view's calendar days say 9).
    expect(container.querySelector("[data-cockpit-verdict]")).toHaveTextContent(
      "Day 7 of 10: 13 of 30 points done, behind by 8.4 points (not counting 1 story without points), and 5 blockers are open."
    );
    expect(container.querySelector('[data-tile="done"]')).toHaveTextContent("13");
    expect(container.querySelector('[data-tile="remaining"]')).toHaveTextContent("17");
    const chart = screen.getByRole("figure", { name: /Burndown/ });
    expect(chart).toHaveTextContent("From the sprint board");
    expect(chart).toHaveTextContent("17 points left on the sprint board today.");
    // Pointed stories: nothing to type.
    expect(screen.queryByLabelText(/Points left/)).toBeNull();
    expect(screen.getByRole("link", { name: /Move stories on the board/ })).toHaveAttribute(
      "href",
      "/kanban?sprint=s2"
    );
    expect(exported.markdown).toContain(
      "Done and remaining are read from the sprint board's stories."
    );
  });

  it("lists the sprint's blockers with their flags and the blocked stories", () => {
    seed();
    render(<SprintCockpit />);
    const list = screen.getByRole("list", { name: "Open impediments" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Escalated one"),
      expect.stringContaining("Overdue one"),
      expect.stringContaining("Critical one"),
      expect.stringContaining("Still open"),
    ]);
    expect(items[0]).toHaveTextContent("Escalated");
    expect(items[1]).toHaveTextContent("2 days overdue");
    expect(screen.queryByText("After the sprint")).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Blocked stories" })).getByText(/Refund flow/)
    ).toBeInTheDocument();
    expect(screen.getByText("1 impediment resolved during this sprint.")).toBeInTheDocument();
  });

  it("asks for points left only without pointed stories, and lets a missed day be backdated", () => {
    seed({ stories: BOARD.map(unpointed) });
    render(<SprintCockpit />);
    const chart = screen.getByRole("figure", { name: /Burndown/ });
    expect(chart).toHaveTextContent("Typed in the daily log");
    expect(chart).toHaveTextContent("27 points left on day 2, typed in the daily log.");
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "5" } });
    const input = screen.getByLabelText("Points left on day 5");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByText("Enter 0 or more points.")).toBeInTheDocument();
    expect(state().sprintSeries?.find((s) => s.id === "s2")?.days).toHaveLength(2);
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(
      state()
        .sprintSeries?.find((s) => s.id === "s2")
        ?.days?.find((d) => d.day === 5)
    ).toMatchObject({
      remaining: 25,
    });
    expect(logs.find((l) => l.action === "day_logged")?.payload).toMatchObject({
      day: 5,
      remaining: 25,
    });
  });

  it("labels the burndown's source as nothing yet when neither the board nor the log says", () => {
    seed({ stories: BOARD.map(unpointed), sprintSeries: [] });
    render(<SprintCockpit />);
    const chart = screen.getByRole("figure", { name: /Burndown/ });
    expect(chart).toHaveTextContent("Nothing recorded yet");
    expect(chart).not.toHaveTextContent("Typed in the daily log");
    expect(chart).not.toHaveTextContent("From the sprint board");
    // Typing is still how it gets started.
    expect(screen.getByLabelText("Points left today (day 7)")).toBeInTheDocument();
  });

  it("closes the sprint and carries the unfinished stories over, with one Undo", () => {
    seed();
    const { container } = render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Close sprint" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.click(within(dlg).getByRole("radio", { name: "Into Sprint 3" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Close sprint" }));

    expect(state().sprints.find((s) => s.id === "s2")).toMatchObject({
      status: "completed",
      pointsCompleted: 13,
    });
    expect(
      state()
        .stories.filter((s) => s.sprintId === "s3")
        .map((s) => s.id)
    ).toEqual(["c", "d", "e"]);
    const { label, description, undo } = lastUndo();
    expect(label).toBe("Closed Sprint 2 with 13 points done");
    expect(description).toBe("3 unfinished stories moved to Sprint 3.");
    expect(logs.find((l) => l.action === "sprint_closed")?.payload).toMatchObject({
      sprintId: "s2",
      pointsCompleted: 13,
      carryOver: "next",
      unfinished: 3,
      moved: 3,
      movedTo: "s3",
    });

    // The cockpit stays on the closed sprint and reads what was recorded,
    // not the board its unfinished stories just left (13 of 13 "done").
    expect(container.querySelector("[data-cockpit-verdict]")).toHaveTextContent(
      "Sprint 2 is closed: 13 of 30 points done (43%, missed the commitment)."
    );
    const done = container.querySelector('[data-tile="done"]');
    expect(done).toHaveTextContent("13");
    expect(done).toHaveTextContent("When the sprint closed");
    expect(container.querySelector('[data-tile="remaining"]')).not.toHaveTextContent(
      "Every story done"
    );
    expect(container.querySelector('[data-tile="finish"]')).not.toHaveTextContent("Finished");
    const chart = screen.getByRole("figure", { name: /Burndown/ });
    expect(chart).toHaveTextContent("Typed in the daily log");
    expect(chart).toHaveTextContent("Closed with 13 points done.");
    expect(screen.queryByLabelText(/Points left/)).toBeNull();

    undo();
    expect(state().sprints.find((s) => s.id === "s2")).toEqual(S2);
    expect(
      state()
        .stories.filter((s) => s.sprintId === "s2")
        .map((s) => s.id)
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("shows the example in memory only, with the notice and a way out", () => {
    seed({ sprints: [], stories: [], impediments: [], sprintSeries: [] });
    const { container } = render(<SprintCockpit />);
    expect(screen.getByRole("heading", { name: "Set up your sprint" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See an example first" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    // The shared notice invites editing; this example can't be, and says so.
    expect(screen.getByText(/This example is a read-only preview/)).toBeInTheDocument();
    // On working days: the example started on a Saturday, so by day 5 only
    // 3 of its 10 working days are done (an ideal of 24.5 left, not 22.5).
    expect(container.querySelector("[data-cockpit-verdict]")).toHaveTextContent(
      "Day 5 of 14: 13 of 32 points done, ahead by 5.5 points (not counting 1 story without points), and 3 blockers are open."
    );
    expect(screen.queryByRole("button", { name: "Close sprint" })).toBeNull();
    expect(screen.queryByLabelText(/Points left/)).toBeNull();
    expect(state().sprints).toEqual([]);
    expect(state().stories).toEqual([]);
    expect(state().impediments).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Start your own sprint" }));
    expect(screen.getByRole("dialog", { name: "New sprint" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("heading", { name: "Set up your sprint" })).toBeInTheDocument();
  });

  it("removes a team member from the team with Undo, and says why an add didn't happen", () => {
    seed({ sprints: [], stories: [], teamMembers: [{ id: "m1", name: "Ann" }] });
    render(<SprintCockpit />);
    const input = screen.getByLabelText("Team member name");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Type a name first.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "ANN" } });
    expect(screen.getByText("Ann is already on the team.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(state().teamMembers.map((m) => m.name)).toEqual(["Ann", "Bo"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Ann from the team" }));
    expect(state().teamMembers.map((m) => m.name)).toEqual(["Bo"]);
    // Focus doesn't drop to the page: it moves to the next name's button.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Bo from the team" })
    );
    const { label, undo } = lastUndo();
    expect(label).toBe("Removed Ann from the team");
    undo();
    expect(
      state()
        .teamMembers.map((m) => m.id)
        .sort()
    ).toEqual(["m1", state().teamMembers.find((m) => m.name === "Bo")!.id].sort());

    // The last name's button hands focus back; with nobody left, the name input has it.
    const [first, last] = state().teamMembers.map((m) => m.name);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${last} from the team` }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Remove ${first} from the team` })
    );
    fireEvent.click(screen.getByRole("button", { name: `Remove ${first} from the team` }));
    expect(state().teamMembers).toEqual([]);
    expect(document.activeElement).toBe(screen.getByLabelText("Team member name"));
  });

  it("shows the next ceremony's timebox", () => {
    seed();
    render(<SprintCockpit />);
    expect(screen.getByRole("region", { name: "Next ceremony" })).toHaveTextContent(
      "Daily Scrum · Today 09:30 · 15 min"
    );
  });
});

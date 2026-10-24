import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard, Sprint, TeamMember } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import {
  RETRO_CURRENT_ID,
  collectRetroActions,
  followThroughByRetro,
  summarizeRetroActions,
  type RetroAction,
  type RetroFollowThrough,
} from "@/lib/retro/actions";
import { RETRO_CARD_MAX } from "@/lib/retro/board";
import { NO_VALUE } from "@/lib/charts/chart-text";

/**
 * Retro Actions, upgraded: quick add (draft-then-save onto the current
 * retro, else the latest one), owners from the roster matched by name key,
 * text edits in place, Done that keeps its row and offers Undo, carry over
 * with Undo, the follow-through rate per retro (chart text, verdict,
 * Markdown), and an example that lives in the page's memory only.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/retro-actions/charts", () => ({ FollowThroughChart: () => null }));

import { RetroActionsTracker } from "@/app/(tools)/retro-actions/tracker";
import { buildExample } from "@/app/(tools)/retro-actions/example";
import { actionsToMarkdown } from "@/app/(tools)/retro-actions/markdown";
import { retroActionsVerdict } from "@/app/(tools)/retro-actions/verdict";
import {
  EMPTY_QUICK_ADD,
  OWNER_MAX,
  validateQuickAdd,
} from "@/app/(tools)/retro-actions/quick-add";
import { EVERYONE, NO_OWNER, matchesOwner, ownerOptions } from "@/app/(tools)/retro-actions/owners";
import {
  CHART_MIN_RETROS,
  followThroughPoints,
  followThroughText,
  pct,
  settleRetros,
} from "@/app/(tools)/retro-actions/follow-through";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const card = (id: string, text: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...extra,
});
const board = (id: string, cards: RetroCard[], extra: Partial<RetroBoard> = {}): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...extra,
});
const archived = (day: string, cards: RetroCard[], extra: Partial<RetroBoard> = {}) =>
  board(`retro:${day}T10:00:00.000Z`, cards, { archivedAt: `${day}T10:00:00.000Z`, ...extra });

const SPRINT: Sprint = {
  id: "s-14",
  name: "Sprint 14",
  startDate: "2026-09-21",
  endDate: "2026-10-04",
  status: "completed",
} as Sprint;

const LAST = archived(
  "2026-10-05",
  [
    card("l1", "Pair on the flaky tests", { assignee: "Sam", dueDate: "2026-10-15" }),
    card("l2", "Shorter planning", { done: true, doneAt: "2026-10-10T09:00:00.000Z" }),
    card("l3", "Fix the staging sandbox"),
  ],
  { sprintId: SPRINT.id }
);
const BEFORE = archived("2026-09-21", [
  card("b1", "Book a room for planning", { assignee: "sam", done: true }),
  card("b2", "Retro notes in the wiki"),
]);
const CURRENT = board(
  RETRO_CURRENT_ID,
  [card("c1", "Write the on-call guide", { assignee: "Priya" })],
  {
    previousRetroId: LAST.id,
  }
);

const ws = () => useWorkspaceStore.getState();
const boardOf = (id: string) => ws().retroBoards?.find((b) => b.id === id);
const cardOf = (boardId: string, id: string) => boardOf(boardId)?.cards.find((c) => c.id === id);
const seed = (boards: RetroBoard[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    retroBoards: boards,
    impediments: [],
    kanbanBoards: [],
    sprints: [SPRINT],
    teamMembers: [],
    ...extra,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <RetroActionsTracker />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const toastLabels = () => toastSpy.mock.calls.map((c) => c[0]);
const actionsLogged = () => logs.map((l) => l.action);
/** A "Show" filter button; a done row's "Done <day>" button starts with "Done" too. */
const filterButton = (name: RegExp) =>
  within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name });
/** Open an action's owner for editing; returns the picker's input. */
const editOwner = (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Owner of ${text}:`) }));
  return screen.getByLabelText(`Owner of ${text}`);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  logs.length = 0;
  seed([BEFORE, LAST, CURRENT]);
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    retroBoards: [],
    impediments: [],
    kanbanBoards: [],
    sprints: [],
    teamMembers: [],
  });
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("the quick-add checks", () => {
  it("needs words for the action, never a blank card", () => {
    expect(validateQuickAdd(EMPTY_QUICK_ADD)).toEqual({
      ok: false,
      errors: { text: "Say what the team will do." },
    });
    expect(validateQuickAdd({ ...EMPTY_QUICK_ADD, text: "  \n " }).ok).toBe(false);
  });

  it("keeps owner and due date unset when blank, and trims what is typed", () => {
    expect(validateQuickAdd({ text: "  Pair on tests ", assignee: "  ", dueDate: "" })).toEqual({
      ok: true,
      values: { text: "Pair on tests" },
    });
    expect(
      validateQuickAdd({ text: "Pair\non tests", assignee: " Sam ", dueDate: "2026-10-30" })
    ).toEqual({
      ok: true,
      values: { text: "Pair on tests", assignee: "Sam", dueDate: "2026-10-30" },
    });
  });

  it("allows a due date in the past but not a malformed one", () => {
    expect(validateQuickAdd({ text: "x", assignee: "", dueDate: "2020-01-01" }).ok).toBe(true);
    expect(validateQuickAdd({ text: "x", assignee: "", dueDate: "next week" })).toMatchObject({
      ok: false,
      errors: { dueDate: "Pick a day, or leave it empty." },
    });
  });

  it("caps the action and the owner at the board's and the agent's limits", () => {
    const long = validateQuickAdd({
      text: "a".repeat(RETRO_CARD_MAX + 1),
      assignee: "b".repeat(OWNER_MAX + 1),
      dueDate: "",
    });
    expect(long).toMatchObject({ ok: false });
    expect(Object.keys(long.ok ? {} : long.errors).sort()).toEqual(["assignee", "text"]);
    expect(
      validateQuickAdd({ text: "a".repeat(RETRO_CARD_MAX), assignee: "", dueDate: "" }).ok
    ).toBe(true);
  });
});

describe("owners, matched by name key", () => {
  const action = (assignee: string, done = false) => ({ assignee, done }) as RetroAction;
  const roster: TeamMember[] = [
    { id: "m1", name: "Priya" },
    { id: "m2", name: "SAM" },
  ];

  it("folds spellings of one person into one option, with the roster's spelling first", () => {
    const options = ownerOptions(
      [
        action("sam"),
        action("Sam "),
        action("Dev"),
        action("priya", true),
        action("alex"),
        action(""),
      ],
      roster
    );
    expect(options).toEqual([
      { name: "Priya", open: 0 },
      { name: "SAM", open: 2 },
      { name: "alex", open: 1 },
      { name: "Dev", open: 1 },
    ]);
  });

  it("filters case-insensitively, and finds actions nobody owns", () => {
    expect(matchesOwner({ assignee: " sam" }, "SAM")).toBe(true);
    expect(matchesOwner({ assignee: "Sam" }, "Priya")).toBe(false);
    expect(matchesOwner({ assignee: "  " }, NO_OWNER)).toBe(true);
    expect(matchesOwner({ assignee: "Sam" }, NO_OWNER)).toBe(false);
    expect(matchesOwner({ assignee: "" }, EVERYONE)).toBe(true);
  });

  it("has no options for an empty list", () => {
    expect(ownerOptions([], roster)).toEqual([]);
  });
});

const ft = (
  boardId: string,
  counts: Pick<RetroFollowThrough, "agreed" | "done" | "carried">,
  extra: Partial<RetroFollowThrough> = {}
): RetroFollowThrough => ({
  boardId,
  retroLabel: `Retro ${boardId}`,
  archivedAt: "2026-10-05T10:00:00.000Z",
  ...counts,
  open: counts.agreed - counts.done - counts.carried,
  rate: counts.agreed > 0 ? counts.done / counts.agreed : null,
  ...extra,
});
const noSprint = () => undefined;

describe("follow-through per retro, as text", () => {
  it("tabulates rated retros oldest first and leaves out retros that agreed nothing", () => {
    const rows = [
      ft("a", { agreed: 4, done: 3, carried: 0 }, { sprintId: "s-14" }),
      ft("b", { agreed: 0, done: 0, carried: 0 }),
      ft("c", { agreed: 4, done: 1, carried: 1 }),
    ];
    const text = followThroughText(rows, (id) => (id === "s-14" ? "Sprint 14" : undefined));
    expect(text.table.columns).toEqual([
      "Retro",
      "Sprint",
      "Agreed",
      "Done",
      "Carried over",
      "Open",
      "Follow-through",
    ]);
    expect(text.table.rows).toEqual([
      ["Retro a", "Sprint 14", 4, 3, 0, 1, "75%"],
      ["Retro c", NO_VALUE, 4, 1, 1, 2, "25%"],
    ]);
    expect(text.summary).toBe(
      "Share of each retro's actions done, oldest first: 75% and 25%. 4 of 8 actions done overall."
    );
  });

  it("names a bar by its sprint, else its archive day", () => {
    const points = followThroughPoints(
      [
        ft("a", { agreed: 2, done: 1, carried: 1 }, { sprintId: "s-14" }),
        ft("b", { agreed: 1, done: 1, carried: 0 }),
      ],
      (id) => (id === "s-14" ? "Sprint 14" : undefined)
    );
    expect(points).toEqual([
      { name: "Sprint 14", done: 1, carried: 1, open: 0, rate: "50%" },
      { name: "5 Oct", done: 1, carried: 0, open: 0, rate: "100%" },
    ]);
  });

  it("gives a range instead of a list for many retros, and copes with none", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ft(`r${i}`, { agreed: 1000, done: i === 0 ? 100 : 900, carried: 0 })
    );
    expect(followThroughText(many, noSprint).summary).toBe(
      "Share of each retro's actions done, oldest first: from 10% to 90% across 12 retros. 10000 of 12000 actions done overall."
    );
    // A first-to-last range reads as a trend: below MIN_SAMPLE.trend (6)
    // retros, every rate is listed instead.
    const rates = [1, 2, 3, 4, 5, 6].map((done, i) =>
      ft(`t${i}`, { agreed: 10, done, carried: 0 })
    );
    expect(followThroughText(rates.slice(0, 5), noSprint).summary).toBe(
      "Share of each retro's actions done, oldest first: 10%, 20%, 30%, 40% and 50%. 15 of 50 actions done overall."
    );
    expect(followThroughText(rates, noSprint).summary).toBe(
      "Share of each retro's actions done, oldest first: from 10% to 60% across 6 retros. 21 of 60 actions done overall."
    );
    expect(followThroughText([], noSprint)).toMatchObject({
      summary: "No past retro has agreed an action yet.",
      table: { rows: [] },
    });
    expect(pct(null)).toBe(NO_VALUE);
    expect(pct(2 / 3)).toBe("67%");
  });
});

describe("the retro being followed up", () => {
  const rows = [
    ft("a", { agreed: 4, done: 3, carried: 0 }),
    ft("b", { agreed: 4, done: 1, carried: 0 }),
  ];

  it("isn't rated while it is the newest archive and no retro is in progress", () => {
    const newest = { id: "b", archivedAt: "2026-10-19T10:00:00.000Z" };
    expect(settleRetros(rows, newest)).toEqual({ settled: [rows[0]], pending: rows[1] });
  });

  it("rates every archive once the next retro has started, or when there is none", () => {
    expect(settleRetros(rows, { id: RETRO_CURRENT_ID })).toEqual({ settled: rows });
    expect(settleRetros(rows, undefined)).toEqual({ settled: rows });
    expect(settleRetros([], { id: "b", archivedAt: "2026-10-19T10:00:00.000Z" })).toEqual({
      settled: [],
    });
  });
});

describe("the verdict", () => {
  const summary = (open: number, overdue: number, done: number) => ({ open, overdue, done });

  it("says when there is nothing, or nothing open", () => {
    expect(retroActionsVerdict(summary(0, 0, 0), [])).toBe("No action items yet.");
    expect(retroActionsVerdict(summary(0, 0, 1), [])).toBe("Nothing open: the one action is done.");
    expect(retroActionsVerdict(summary(0, 0, 4), [])).toBe("Nothing open: all 4 actions are done.");
  });

  it("leads with what is open and overdue, without a rate before any retro is archived", () => {
    expect(retroActionsVerdict(summary(1, 0, 0), [])).toBe("1 action open.");
    expect(
      retroActionsVerdict(summary(5, 1, 2), [ft("a", { agreed: 0, done: 0, carried: 0 })])
    ).toBe("5 actions open, 1 overdue.");
  });

  it("sums the last three retros, with a percentage only from three actions", () => {
    const rows = [
      ft("old", { agreed: 9, done: 0, carried: 0 }),
      ft("a", { agreed: 4, done: 3, carried: 0 }),
      ft("b", { agreed: 4, done: 3, carried: 1 }),
      ft("c", { agreed: 4, done: 1, carried: 0 }),
    ];
    expect(retroActionsVerdict(summary(5, 1, 7), rows)).toBe(
      "5 actions open, 1 overdue; the last 3 retros got 7 of 12 actions done (58%)."
    );
    expect(
      retroActionsVerdict(summary(1, 0, 1), [ft("a", { agreed: 2, done: 1, carried: 0 })])
    ).toBe("1 action open; the last retro got 1 of 2 actions done.");
    expect(
      retroActionsVerdict(summary(1, 0, 0), [ft("a", { agreed: 1, done: 0, carried: 1 })])
    ).toBe("1 action open; the last retro got 0 of 1 action done.");
  });

  it("compares with the three retros before only from MIN_SAMPLE.trend rated retros", () => {
    const low = [1, 1, 1].map((_, i) => ft(`p${i}`, { agreed: 5, done: 2, carried: 0 }));
    const high = [1, 1, 1].map((_, i) => ft(`n${i}`, { agreed: 5, done: 4, carried: 0 }));
    expect(retroActionsVerdict(summary(3, 0, 12), [...low, ...high])).toBe(
      "3 actions open; the last 3 retros got 12 of 15 actions done (80%), up from 40% in the 3 before."
    );
    expect(retroActionsVerdict(summary(3, 0, 6), [...high, ...low])).toBe(
      "3 actions open; the last 3 retros got 6 of 15 actions done (40%), down from 80% in the 3 before."
    );
    expect(retroActionsVerdict(summary(3, 0, 6), [...low, ...low])).toBe(
      "3 actions open; the last 3 retros got 6 of 15 actions done (40%), about the same as the 3 before."
    );
    // Five rated retros: no trend wording, however different they look.
    expect(retroActionsVerdict(summary(3, 0, 12), [...low.slice(1), ...high])).toBe(
      "3 actions open; the last 3 retros got 12 of 15 actions done (80%)."
    );
  });
});

describe("the example", () => {
  it("is three archived example boards with a carried chain and a target-closed action", () => {
    const ex = buildExample(new Date(2026, 9, 22, 9));
    expect(ex.boards).toHaveLength(3);
    for (const b of ex.boards) {
      expect(isExampleId(b.id)).toBe(true);
      expect(b.archivedAt).toBeTruthy();
      for (const c of b.cards) expect(isExampleId(c.id)).toBe(true);
    }
    const targetDone = (l: { targetId: string }) => ex.doneTargets.has(l.targetId);
    const rows = followThroughByRetro(ex.boards, { targetDone });
    expect(rows.map((r) => [r.agreed, r.done, r.carried, r.open])).toEqual([
      [4, 3, 0, 1],
      [4, 3, 1, 0],
      [4, 1, 0, 3],
    ]);
    const actions = collectRetroActions(ex.boards, { today: "2026-10-22", targetDone });
    expect(summarizeRetroActions(actions)).toEqual({ open: 4, overdue: 1, done: 6 });
    // The carried originals give way to their copies.
    expect(actions.filter((a) => a.text === "Rotate the release captain each sprint")).toHaveLength(
      1
    );
    expect(ex.boards.every((b) => ex.sprintNames[b.sprintId as string])).toBe(true);
  });
});

describe("the Markdown export", () => {
  it("adds a follow-through table after the counts and keeps the checklist", () => {
    const boards = [BEFORE, LAST, CURRENT];
    const actions = collectRetroActions(boards, { today: "2026-10-22" });
    const rows = followThroughByRetro(boards);
    const md = actionsToMarkdown(actions, summarizeRetroActions(actions), {
      followThrough: rows,
      sprintName: (id) => (id === SPRINT.id ? "Sprint | 14" : undefined),
      verdict: "4 actions open, 1 overdue.",
    });
    expect(md).toContain("> 4 actions open, 1 overdue.");
    expect(md).toContain("## Follow-through by retro");
    expect(md).toContain(
      "| Retro | Sprint | Agreed | Done | Carried over | Open | Follow-through |"
    );
    // The labels' month names come from the runtime's locale data ("Sep" or "Sept").
    expect(md).toContain(`| ${rows[0].retroLabel} | — | 2 | 1 | 0 | 1 | 50% |`);
    expect(md).toContain(`| ${rows[1].retroLabel} | Sprint \\| 14 | 3 | 1 | 0 | 2 | 33% |`);
    expect(md.indexOf("## Follow-through by retro")).toBeLessThan(md.indexOf("## Current retro"));
    expect(md).toContain("- [ ] Write the on-call guide — Owner: Priya");
  });

  it("still works called the old way, with no table when no retro is rated", () => {
    const md = actionsToMarkdown([], { open: 0, overdue: 0, done: 0 });
    expect(md).not.toContain("Follow-through");
    expect(md).toContain("No action items yet.");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("quick add", () => {
  it("saves nothing while the action is blank, and says why", () => {
    renderPage();
    const before = JSON.stringify(ws().retroBoards);
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(screen.getByText("Say what the team will do.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Action/)).toHaveFocus();
    expect(JSON.stringify(ws().retroBoards)).toBe(before);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("adds an action with an owner and a backdated due date to the current retro, with Undo", () => {
    renderPage();
    expect(screen.getByText("Goes in the Start column of the current retro.")).toBeInTheDocument();
    expect(filterButton(/^Overdue/)).toHaveTextContent("1");
    fireEvent.change(screen.getByLabelText(/^Action/), {
      target: { value: "Ask ops for a sandbox" },
    });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-20" } });
    fireEvent.submit(screen.getByLabelText(/^Action/).closest("form") as HTMLFormElement);

    const added = boardOf(RETRO_CURRENT_ID)?.cards.at(-1);
    expect(added).toMatchObject({
      text: "Ask ops for a sandbox",
      assignee: "Dev",
      dueDate: "2026-10-20",
      isActionItem: true,
      columnKey: retroFormats[0].columns[0].key,
    });
    expect(logs.at(-1)).toMatchObject({
      action: "action_added",
      payload: { boardId: RETRO_CURRENT_ID, cardId: added?.id, text: "Ask ops for a sandbox" },
    });
    expect(toastLabels()).toContain("Added “Ask ops for a sandbox”");
    // It's open and already past due: listed, and overdue.
    const current = screen.getByRole("region", { name: "Current retro" });
    const row = within(current).getByText("Ask ops for a sandbox").closest("li") as HTMLElement;
    expect(within(row).getByText(/^Overdue/)).toBeInTheDocument();
    expect(filterButton(/^Overdue/)).toHaveTextContent("2");
    // The form is ready for the next one.
    expect(screen.getByLabelText(/^Action/)).toHaveValue("");

    undoLast();
    expect(boardOf(RETRO_CURRENT_ID)?.cards.some((c) => c.id === added?.id)).toBe(false);
    expect(boardOf(RETRO_CURRENT_ID)?.cards).toHaveLength(1);
  });

  it("goes on the newest archived retro when none is in progress", () => {
    seed([BEFORE, LAST]);
    renderPage();
    expect(
      screen.getByText(
        "No retro is in progress, so it goes in the Start column of the latest one: Start / Stop / Continue · 5 Oct 2026 (Sprint 14)."
      )
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Action/), { target: { value: "Late follow-up" } });
    fireEvent.submit(screen.getByLabelText(/^Action/).closest("form") as HTMLFormElement);
    expect(boardOf(LAST.id)?.cards.map((c) => c.text)).toContain("Late follow-up");
    expect(boardOf(BEFORE.id)?.cards.map((c) => c.text)).not.toContain("Late follow-up");
  });

  it("lands in the first column of a legacy board with no format", () => {
    const legacy = { ...LAST, format: undefined } as unknown as RetroBoard;
    seed([legacy]);
    renderPage();
    // No format, so no column to name.
    expect(
      screen.getByText(
        "No retro is in progress, so it goes on the latest one: Retro · 5 Oct 2026 (Sprint 14)."
      )
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Action/), { target: { value: "Legacy add" } });
    fireEvent.submit(screen.getByLabelText(/^Action/).closest("form") as HTMLFormElement);
    expect(boardOf(LAST.id)?.cards.at(-1)).toMatchObject({
      text: "Legacy add",
      columnKey: "start",
    });
  });

  it("says which column of the board it lands in", () => {
    const sailboat = retroFormats.find((f) => f.id === "sailboat") ?? retroFormats[0];
    seed([LAST, { ...CURRENT, format: sailboat }]);
    renderPage();
    expect(screen.getByText("Goes in the Anchor column of the current retro.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Action/), { target: { value: "Name the anchor" } });
    fireEvent.submit(screen.getByLabelText(/^Action/).closest("form") as HTMLFormElement);
    expect(boardOf(RETRO_CURRENT_ID)?.cards.at(-1)).toMatchObject({
      text: "Name the anchor",
      columnKey: "anchor",
    });
  });
});

describe("first run", () => {
  it("with no retro at all, points at the Retro board and offers the example, but no quick add", () => {
    seed([]);
    renderPage();
    expect(screen.getByText(/No retro yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Retro board" })).toHaveAttribute(
      "href",
      "/retro"
    );
    expect(screen.queryByRole("button", { name: "Add action" })).toBeNull();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("with a retro but no actions, offers quick add above the empty state", () => {
    seed([board(RETRO_CURRENT_ID, [card("x", "Not an action", { isActionItem: false })])]);
    renderPage();
    expect(screen.getByRole("button", { name: "Add action" })).toBeInTheDocument();
    expect(screen.getByText(/No action items yet\. Add one above/)).toBeInTheDocument();
  });

  it("ignores example cards left on a real board", () => {
    seed([
      board(RETRO_CURRENT_ID, [card("example-retro-1", "Example action", { assignee: "Sam" })]),
    ]);
    renderPage();
    expect(screen.queryByText("Example action")).toBeNull();
    expect(screen.getByText(/No action items yet/)).toBeInTheDocument();
  });

  it("shows the example in memory only: edits stay in the page and nothing can be sent", () => {
    seed([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    // Sprint 14's retro is the one being followed up (no retro is in
    // progress), so the verdict and the chart rate the two before it.
    expect(
      screen.getByText(
        "4 actions open, 1 overdue; the last 2 retros got 6 of 8 actions done (75%)."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The latest retro, for Sprint 14 (4 actions), isn't rated until the next retro starts."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Mad \/ Sad \/ Glad/ })).toBeInTheDocument();
    expect(screen.getAllByText(/· Sprint 1[234]/).length).toBeGreaterThan(0);
    for (const b of screen.getAllByRole("button", { name: /^Send to…/ })) expect(b).toBeDisabled();
    for (const b of screen.getAllByRole("button", { name: /^Carry over / })) {
      expect(b).toBeDisabled();
    }
    // The follow-through chart reads the example too.
    expect(
      screen.getByText(
        "Share of each retro's actions done, oldest first: 75% and 75%. 6 of 8 actions done overall."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Done: Write the on-call guide"));
    expect(screen.getByLabelText("Done: Write the on-call guide")).toBeChecked();
    fireEvent.change(screen.getByLabelText(/^Action/), { target: { value: "Try it out" } });
    fireEvent.submit(screen.getByLabelText(/^Action/).closest("form") as HTMLFormElement);
    expect(screen.getByText("Try it out")).toBeInTheDocument();
    // Deleting stays in the page too.
    fireEvent.click(screen.getByRole("button", { name: "Delete Try it out" }));
    expect(screen.queryByText("Try it out")).toBeNull();
    undoLast();
    expect(screen.getByText("Try it out")).toBeInTheDocument();

    // The example's people aren't the team's: no "Add to the team", in a
    // row's owner or in quick add.
    const owner = editOwner("Write the on-call guide");
    expect(owner).toHaveValue("Dev");
    expect(screen.getByText("“Dev” isn’t on the team.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Sam" } });
    expect(screen.getByText("“Sam” isn’t on the team.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to the team" })).toBeNull();
    fireEvent.keyDown(owner, { key: "Escape" });

    expect(ws().retroBoards).toEqual([]);
    expect(ws().teamMembers).toEqual([]);
    expect(logs).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText(/Example data\./)).toBeNull();
    expect(screen.queryByText("Try it out")).toBeNull();
    expect(screen.getByText(/No retro yet/)).toBeInTheDocument();
  });

  it("says where the example's quick add goes, not that the team has no retro in progress", () => {
    const own = board(RETRO_CURRENT_ID, [card("x", "Not an action", { isActionItem: false })]);
    seed([own]);
    renderPage();
    expect(screen.getByText("Goes in the Start column of the current retro.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      screen.getByText(
        /^In the example, it goes in the Mad column of its latest retro: Mad \/ Sad \/ Glad · .+ \(Sprint 14\)\. Nothing is saved\.$/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/No retro is in progress/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Action/), { target: { value: "Try it out" } });
    fireEvent.submit(screen.getByLabelText(/^Action/).closest("form") as HTMLFormElement);
    expect(ws().retroBoards).toEqual([own]);
  });
});

describe("done, without losing the row", () => {
  it("keeps a row ticked under Open on screen with Undo, until the filter changes", async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText("Done: Pair on the flaky tests"));
    expect(cardOf(LAST.id, "l1")).toMatchObject({ done: true });
    expect(screen.getByLabelText("Done: Pair on the flaky tests")).toBeChecked();
    expect(toastLabels()).toContain("Done: “Pair on the flaky tests”");
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Marked “Pair on the flaky tests” done"
      )
    );

    undoLast();
    expect(cardOf(LAST.id, "l1")?.done).toBeUndefined();
    expect(cardOf(LAST.id, "l1")?.doneAt).toBeUndefined();

    fireEvent.click(screen.getByLabelText("Done: Pair on the flaky tests"));
    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Open/ }));
    expect(screen.queryByText("Pair on the flaky tests")).toBeNull();
  });

  it("reopening restores the done day it had on Undo", () => {
    renderPage();
    fireEvent.click(filterButton(/^Done/));
    fireEvent.click(screen.getByLabelText("Done: Shorter planning"));
    expect(cardOf(LAST.id, "l2")?.done).toBeUndefined();
    expect(screen.getByText("Shorter planning")).toBeInTheDocument();
    expect(actionsLogged()).toContain("action_reopened");
    undoLast();
    expect(cardOf(LAST.id, "l2")).toMatchObject({ done: true, doneAt: "2026-10-10T09:00:00.000Z" });
  });

  it("shows the done day as the local calendar day, also east of UTC", () => {
    // Pinned east of UTC so this holds on a UTC runner too: 20:30 UTC on
    // the 20th is early on the 21st in Tokyo, where a UTC slice says the 20th.
    const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Tokyo";
    try {
      const doneAt = "2026-10-20T20:30:00.000Z";
      expect(new Date(doneAt).getDate()).toBe(21);
      seed([
        board(RETRO_CURRENT_ID, [card("d1", "Done early in the morning", { done: true, doneAt })]),
      ]);
      renderPage();
      fireEvent.click(filterButton(/^Done/));
      expect(screen.getByText("Done 2026-10-21")).toBeInTheDocument();
      expect(screen.queryByText(`Done ${doneAt.slice(0, 10)}`)).toBeNull();
    } finally {
      process.env.TZ = zone;
    }
  });

  it("moves the done day back by hand, never past today, and Escape keeps it", () => {
    renderPage();
    fireEvent.click(filterButton(/^Done/));
    const dayButton = screen.getByRole("button", {
      name: "Done 2026-10-10: change the day “Shorter planning” was done",
    });
    fireEvent.click(dayButton);
    const day = screen.getByLabelText("Day “Shorter planning” was done");
    expect(day).toHaveFocus();
    expect(day).toHaveValue("2026-10-10");
    expect(day).toHaveAttribute("max", "2026-10-22");

    // Tomorrow: an error, and nothing saved, by Enter or by leaving the field.
    fireEvent.change(day, { target: { value: "2026-10-23" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Pick today or an earlier day.");
    fireEvent.keyDown(day, { key: "Enter" });
    fireEvent.blur(day);
    expect(cardOf(LAST.id, "l2")?.doneAt).toBe("2026-10-10T09:00:00.000Z");

    fireEvent.keyDown(day, { key: "Escape" });
    expect(cardOf(LAST.id, "l2")?.doneAt).toBe("2026-10-10T09:00:00.000Z");
    expect(screen.getByRole("button", { name: /^Done 2026-10-10:/ })).toHaveFocus();
    expect(logs).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /^Done 2026-10-10:/ }));
    const again = screen.getByLabelText("Day “Shorter planning” was done");
    fireEvent.change(again, { target: { value: "2026-10-08" } });
    fireEvent.keyDown(again, { key: "Enter" });
    const doneAt = cardOf(LAST.id, "l2")?.doneAt as string;
    // Noon on the picked day, local: the day it reads back as.
    expect(doneAt).toBe(new Date(2026, 9, 8, 12).toISOString());
    expect(cardOf(LAST.id, "l2")?.done).toBe(true);
    expect(logs).toEqual([
      { action: "action_edited", payload: { boardId: LAST.id, cardId: "l2", field: "doneAt" } },
    ]);
    expect(screen.getByRole("button", { name: /^Done 2026-10-08:/ })).toHaveFocus();

    // The same day again, or an emptied field, saves nothing.
    fireEvent.click(screen.getByRole("button", { name: /^Done 2026-10-08:/ }));
    fireEvent.keyDown(screen.getByLabelText("Day “Shorter planning” was done"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /^Done 2026-10-08:/ }));
    const emptied = screen.getByLabelText("Day “Shorter planning” was done");
    fireEvent.change(emptied, { target: { value: "" } });
    fireEvent.blur(emptied);
    expect(cardOf(LAST.id, "l2")?.doneAt).toBe(doneAt);
    expect(logs).toHaveLength(1);
  });

  it("keeps a done action without a recorded day as it was", () => {
    renderPage();
    fireEvent.click(filterButton(/^Done/));
    const row = screen.getByText("Book a room for planning").closest("li") as HTMLElement;
    expect(within(row).getByText("Past retro")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^Done / })).toBeNull();
  });
});

describe("edit in place", () => {
  it("edits the action's text on its own board", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Pair on the flaky tests/ }));
    const editor = screen.getByRole("textbox", { name: "Action text" });
    fireEvent.change(editor, { target: { value: "Pair on the flaky UI tests" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(cardOf(LAST.id, "l1")?.text).toBe("Pair on the flaky UI tests");
    expect(logs.at(-1)).toMatchObject({
      action: "action_edited",
      payload: { boardId: LAST.id, cardId: "l1", field: "text" },
    });
  });

  it("edits the owner in place: Enter, Save or clicking away saves; Escape and Cancel don't", () => {
    renderPage();
    const ownerButton = () =>
      screen.getByRole("button", { name: /^Owner of Write the on-call guide:/ });
    expect(ownerButton()).toHaveAccessibleName("Owner of Write the on-call guide: Priya");
    let owner = editOwner("Write the on-call guide");
    expect(owner).toHaveFocus();
    expect(owner).toHaveValue("Priya");
    fireEvent.change(owner, { target: { value: "Dev " } });
    // Enter submits the picker's form (jsdom has no implicit submission).
    fireEvent.submit(owner.closest("form") as HTMLFormElement);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Dev");
    expect(logs.filter((l) => l.action === "action_edited")).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ action: "action_edited", payload: { field: "assignee" } });
    expect(ownerButton()).toHaveFocus();

    owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Someone else" } });
    fireEvent.keyDown(owner, { key: "Escape" });
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Dev");
    expect(ownerButton()).toHaveFocus();

    owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Someone else" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Dev");

    owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Priya");

    // Clicking away saves; an emptied name clears the owner.
    owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "" } });
    fireEvent.blur(owner);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("");
    expect(ownerButton()).toHaveAccessibleName("Owner of Write the on-call guide: No owner");
  });

  it("won't cut a long owner name short: it says so and saves nothing", () => {
    renderPage();
    const owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "n".repeat(OWNER_MAX + 1) } });
    expect(screen.getByText(`Keep the name to ${OWNER_MAX} characters.`)).toBeInTheDocument();
    expect(owner).toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(owner.closest("form") as HTMLFormElement);
    fireEvent.blur(owner);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Priya");
    expect(owner).toBeInTheDocument();
    expect(logs).toEqual([]);

    fireEvent.change(owner, { target: { value: "n".repeat(OWNER_MAX) } });
    expect(screen.queryByText(`Keep the name to ${OWNER_MAX} characters.`)).toBeNull();
    fireEvent.submit(owner.closest("form") as HTMLFormElement);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("n".repeat(OWNER_MAX));
  });

  it("shows the roster notes only while an owner is being changed", () => {
    renderPage();
    // Quick add's Owner is the one picker on screen: no note under each row.
    expect(screen.getAllByText(/to pick names here/)).toHaveLength(1);
    expect(screen.queryByText(/isn’t on the team/)).toBeNull();
    editOwner("Write the on-call guide");
    expect(screen.getByText("“Priya” isn’t on the team.")).toBeInTheDocument();
  });

  it("adds someone to the team only on the explicit click, then hands focus back to the name", () => {
    renderPage();
    const owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Nadia" } });
    expect(ws().teamMembers).toEqual([]);
    const row = owner.closest("li") as HTMLElement;
    const add = within(row).getByRole("button", { name: "Add to the team" });
    // A press keeps focus in the input, so leaving it doesn't save half-way.
    expect(fireEvent.mouseDown(add)).toBe(false);
    add.focus();
    fireEvent.click(add);
    expect(ws().teamMembers.map((m) => m.name)).toEqual(["Nadia"]);
    expect(within(row).queryByRole("button", { name: "Add to the team" })).toBeNull();
    expect(owner).toHaveFocus();
    // Adding to the team isn't choosing the owner: Enter does that.
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Priya");
    fireEvent.submit(owner.closest("form") as HTMLFormElement);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.assignee).toBe("Nadia");
  });

  it("keeps an edited row in view under an owner filter until the filter changes", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Filter by owner"), { target: { value: "Priya" } });
    const owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Dev" } });
    fireEvent.blur(owner);
    expect(screen.getByText("Write the on-call guide")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by owner"), { target: { value: EVERYONE } });
    fireEvent.change(screen.getByLabelText("Filter by owner"), { target: { value: "Priya" } });
    expect(screen.queryByText("Write the on-call guide")).toBeNull();
  });

  it("saves a due date once, when the field is left or on Enter, not on every keystroke", () => {
    renderPage();
    const due = screen.getByLabelText("Due date of Write the on-call guide");
    // Typing the year passes through days long gone: none of them is saved.
    for (const value of ["0002-11-01", "0020-11-01", "0202-11-01", "2026-11-01"]) {
      fireEvent.change(due, { target: { value } });
    }
    expect(cardOf(RETRO_CURRENT_ID, "c1")).not.toHaveProperty("dueDate");
    expect(within(due.closest("li") as HTMLElement).queryByText(/Overdue/)).toBeNull();
    expect(logs).toEqual([]);
    fireEvent.blur(due);
    expect(cardOf(RETRO_CURRENT_ID, "c1")?.dueDate).toBe("2026-11-01");
    expect(logs).toEqual([
      {
        action: "action_edited",
        payload: { boardId: RETRO_CURRENT_ID, cardId: "c1", field: "dueDate" },
      },
    ]);
    // Leaving it again unchanged saves nothing more.
    fireEvent.blur(due);
    expect(logs).toHaveLength(1);

    // Enter saves too; an emptied field clears the due date.
    due.focus();
    fireEvent.change(due, { target: { value: "" } });
    fireEvent.keyDown(due, { key: "Enter" });
    expect(cardOf(RETRO_CURRENT_ID, "c1")).not.toHaveProperty("dueDate");
    expect(logs).toHaveLength(2);
  });
});

describe("the owner filter", () => {
  it("treats Sam and sam as one owner, lists roster names first, and finds unowned actions", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Priya" }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    const select = screen.getByLabelText("Filter by owner") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Everyone",
      "Priya (1 open)",
      "Sam (1 open)",
      "No owner (2 open)",
    ]);
    fireEvent.change(select, { target: { value: "Sam" } });
    expect(screen.getByText("Pair on the flaky tests")).toBeInTheDocument();
    expect(screen.getByText("Book a room for planning")).toBeInTheDocument();
    expect(screen.queryByText("Write the on-call guide")).toBeNull();
    fireEvent.change(select, { target: { value: NO_OWNER } });
    expect(screen.getByText("Fix the staging sandbox")).toBeInTheDocument();
    expect(screen.getByText("Retro notes in the wiki")).toBeInTheDocument();
    expect(screen.queryByText("Pair on the flaky tests")).toBeNull();
  });

  it("keeps showing the chosen owner when the option's spelling changes under it", () => {
    seed([
      BEFORE,
      LAST,
      { ...CURRENT, cards: [card("c1", "Write the on-call guide", { assignee: "sam" })] },
    ]);
    renderPage();
    const select = screen.getByLabelText("Filter by owner") as HTMLSelectElement;
    // The current retro's "sam" is seen first, so it spells the option.
    fireEvent.change(select, { target: { value: "sam" } });
    expect(select.value).toBe("sam");
    const owner = editOwner("Write the on-call guide");
    fireEvent.change(owner, { target: { value: "Sam" } });
    fireEvent.submit(owner.closest("form") as HTMLFormElement);
    // The option is "Sam" now; the select still shows it, not "Everyone".
    expect(select.value).toBe("Sam");
    expect(select.selectedOptions[0]?.textContent).toBe("Sam (2 open)");
    expect(Array.from(select.options).filter((o) => /^Sam/i.test(o.value))).toHaveLength(1);
    expect(screen.getByText("Pair on the flaky tests")).toBeInTheDocument();
    expect(screen.queryByText("Fix the staging sandbox")).toBeNull();
  });
});

describe("carry over", () => {
  it("copies a past action onto the current retro, with Undo", () => {
    renderPage();
    const past = screen.getByRole("region", { name: "Start / Stop / Continue · 5 Oct 2026" });
    fireEvent.click(
      within(past).getByRole("button", {
        name: "Carry over Pair on the flaky tests to the current retro",
      })
    );
    const copy = boardOf(RETRO_CURRENT_ID)?.cards.find((c) => c.carriedFrom === "l1");
    expect(copy).toBeTruthy();
    expect(toastLabels()).toContain("Carried “Pair on the flaky tests” over to the current retro");
    undoLast();
    expect(boardOf(RETRO_CURRENT_ID)?.cards.some((c) => c.carriedFrom === "l1")).toBe(false);
    expect(screen.getAllByText("Pair on the flaky tests")).toHaveLength(1);
  });

  it("names each Carry over button after its action", () => {
    renderPage();
    expect(
      screen
        .getAllByRole("button", { name: /^Carry over / })
        .map((b) => b.getAttribute("aria-label"))
    ).toEqual([
      "Carry over Pair on the flaky tests to the current retro",
      "Carry over Fix the staging sandbox to the current retro",
      "Carry over Retro notes in the wiki to the current retro",
    ]);
  });

  it("moves focus onto the carried copy, since the row it was pressed in goes", () => {
    renderPage();
    const carry = screen.getByRole("button", {
      name: "Carry over Pair on the flaky tests to the current retro",
    });
    carry.focus();
    fireEvent.click(carry);
    expect(carry).not.toBeInTheDocument();
    const current = screen.getByRole("region", { name: "Current retro" });
    const copy = within(current).getByRole("button", { name: /^Pair on the flaky tests/ });
    expect(copy).toHaveFocus();
    expect(within(current).getByText(/Carried over/)).toBeInTheDocument();

    // Undo brings the original row back, and focus with it.
    undoLast();
    const past = screen.getByRole("region", { name: "Start / Stop / Continue · 5 Oct 2026" });
    expect(within(past).getByRole("button", { name: /^Pair on the flaky tests/ })).toHaveFocus();
  });

  it("asks for a current retro first when there is none", () => {
    seed([LAST]);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /^Carry over / })[0]);
    expect(toastSpy.error).toHaveBeenCalledWith("Open the Retro board and pick a format first.");
    expect(ws().retroBoards).toHaveLength(1);
  });
});

describe("delete", () => {
  it("takes a mistaken action off an archived retro, with Undo back in its place", () => {
    renderPage();
    const del = screen.getByRole("button", { name: "Delete Pair on the flaky tests" });
    del.focus();
    fireEvent.click(del);
    expect(boardOf(LAST.id)?.cards.map((c) => c.id)).toEqual(["l2", "l3"]);
    expect(toastLabels()).toContain("Deleted “Pair on the flaky tests”");
    expect(logs.at(-1)).toEqual({
      action: "action_removed",
      payload: { boardId: LAST.id, cardId: "l1", text: "Pair on the flaky tests" },
    });
    expect(screen.queryByText("Pair on the flaky tests")).toBeNull();
    // Focus moves on to the next row rather than dropping to the page.
    expect(screen.getByRole("button", { name: /^Fix the staging sandbox/ })).toHaveFocus();
    // It no longer counts as agreed: that retro got 1 of 2 done, not 1 of 3.
    const md = () => screen.getByTestId("export-markdown").textContent ?? "";
    expect(md()).toContain("| Sprint 14 | 2 | 1 | 0 | 1 | 50% |");
    expect(md()).not.toContain("33%");

    undoLast();
    expect(boardOf(LAST.id)?.cards.map((c) => c.id)).toEqual(["l1", "l2", "l3"]);
    expect(cardOf(LAST.id, "l1")).toEqual(LAST.cards[0]);
    expect(screen.getByRole("button", { name: /^Pair on the flaky tests/ })).toHaveFocus();
    expect(md()).toContain("| Sprint 14 | 3 | 1 | 0 | 2 | 33% |");
  });

  it("leaves the cards grouped under it on the board, and regroups them on Undo", () => {
    const parent = card("g1", "Make the build faster", { isActionItem: true });
    const child = card("g2", "CI takes 40 minutes", { isActionItem: false, groupedWith: "g1" });
    seed([BEFORE, LAST, { ...CURRENT, cards: [...CURRENT.cards, parent, child] }]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Make the build faster" }));
    expect(boardOf(RETRO_CURRENT_ID)?.cards.map((c) => c.id)).toEqual(["c1", "g2"]);
    expect(cardOf(RETRO_CURRENT_ID, "g2")?.groupedWith).toBeNull();
    undoLast();
    expect(boardOf(RETRO_CURRENT_ID)?.cards).toEqual([...CURRENT.cards, parent, child]);
  });
});

describe("follow-through on the page", () => {
  it("asks for more retros below CHART_MIN_RETROS, then shows the chart's summary and table", () => {
    seed([LAST, CURRENT]);
    const { unmount } = renderPage();
    expect(CHART_MIN_RETROS).toBe(2);
    expect(
      screen.getByText("Hold 1 more retro with actions to see the follow-through per retro.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("The current retro (1 action) isn't rated until the next retro starts.")
    ).toBeInTheDocument();
    unmount();

    seed([BEFORE, LAST, CURRENT]);
    renderPage();
    const figure = screen.getByRole("figure", { name: "Follow-through per retro" });
    expect(figure).toHaveAccessibleDescription(
      "Share of each retro's actions done, oldest first: 50% and 33%. 2 of 5 actions done overall."
    );
    fireEvent.click(within(figure).getByRole("button", { name: /table/i }));
    const table = within(figure).getByRole("table");
    expect(within(table).getByText("Sprint 14")).toBeInTheDocument();
    expect(within(table).getByText("33%")).toBeInTheDocument();
  });

  it("counts an action done when the impediment it was sent to is resolved", () => {
    seed(
      [
        BEFORE,
        archived("2026-10-05", [
          card("t1", "Fix the sandbox", {
            sentTo: [{ route: "impediment", targetId: "imp-1", at: "2026-10-06" }],
          }),
        ]),
        // The next retro has started, so the 5 Oct one is rated.
        CURRENT,
      ],
      {
        impediments: [
          {
            id: "imp-1",
            title: "Sandbox",
            severity: "high",
            raisedAt: "2026-10-06",
            resolvedAt: "2026-10-12",
          },
        ],
      }
    );
    renderPage();
    expect(
      screen.getByText(/the last 2 retros got 2 of 3 actions done \(67%\)/, { selector: "p" })
    ).toBeInTheDocument();
  });

  it("doesn't rate the latest retro while it is still being followed up", () => {
    seed([BEFORE, LAST]);
    renderPage();
    // No retro in progress: the 5 Oct retro is the one quick add files to,
    // so only the one before it is rated.
    expect(
      screen.getByText("3 actions open, 1 overdue; the last retro got 1 of 2 actions done.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hold 1 more retro with actions to see the follow-through per retro.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The latest retro, for Sprint 14 (3 actions), isn't rated until the next retro starts."
      )
    ).toBeInTheDocument();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("| 2 | 1 | 0 | 1 | 50% |");
    expect(md).not.toContain("| Sprint 14 |");
  });

  it("names the sprint a past retro looked back on in its heading", () => {
    renderPage();
    const past = screen.getByRole("region", { name: "Start / Stop / Continue · 5 Oct 2026" });
    expect(within(past).getByRole("heading")).toHaveTextContent(
      "Start / Stop / Continue · 5 Oct 2026 · Sprint 14"
    );
  });

  it("exports the verdict and the follow-through table", () => {
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain(
      "> 4 actions open, 1 overdue; the last 2 retros got 2 of 5 actions done (40%)."
    );
    expect(md).toContain("## Follow-through by retro");
  });
});

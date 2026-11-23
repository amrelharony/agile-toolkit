import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  WORKFLOW_DEFINITION_ID,
  type BlockSpell,
  type Impediment,
  type KanbanCard,
  type Sprint,
  type Story,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import { sourceHref } from "@/lib/handoffs/sources";
import { BOARD_VIEW_KEY } from "@/app/(tools)/kanban/board-view";
import { unnotedLog } from "@/app/(tools)/kanban/block-note-dialog";
import { sprintBoardMarkdown, toMarkdown } from "@/app/(tools)/kanban/markdown";
import { buildWorkflowExample } from "@/app/(tools)/kanban/workflow/example";
import {
  applyWorkflowValues,
  changedParts,
  draftFromWorkflow,
  validateCadence,
  validateWorkflowDraft,
} from "@/app/(tools)/kanban/workflow/form";

/**
 * Kanban's Definition of Workflow and STATIK (the "How we work" card under
 * both boards), and the blocked-spell notes on the cards: editing the
 * definition with Undo, the board it describes and the other board's
 * line, column policies and the SLE line, Draft policies without AI, the
 * seven STATIK steps and cadences, versions and their compare, the
 * in-memory example, the block note dialog (cluster, link, log, before
 * tracking, never on examples), the Type select and the Markdown exports.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn(() => "t"),
    {
      dismiss: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      message: vi.fn(),
    }
  )
);
const spies = vi.hoisted(() => ({ log: vi.fn(), sonify: vi.fn(), cheer: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: spies.sonify }));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: spies.cheer }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log, toolRunId: "test" }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";

const LIMITS = { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 };
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const card = (id: string, title: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title,
  column: "in_progress",
  class: "standard",
  createdAt: ago(10),
  startedAt: ago(4),
  ...patch,
});
const finished = (id: string, days: number): KanbanCard =>
  card(id, `Done ${id}`, {
    column: "done",
    startedAt: ago(days + 10),
    completedAt: ago(10),
  });
const sprint: Sprint = {
  id: "s7",
  name: "Sprint 7",
  startDate: "2026-10-12",
  endDate: "2099-10-26",
  pointsPlanned: 10,
  status: "active",
};
const story = (id: string, title: string, patch: Partial<Story> = {}): Story => ({
  id,
  title,
  status: "in_progress",
  sprintId: "s7",
  ...patch,
});

function seed({
  cards = [] as KanbanCard[],
  stories = [] as Story[],
  sprints = [] as Sprint[],
  defs = [] as WorkflowDefinition[],
  impediments = [] as Impediment[],
} = {}) {
  useWorkspaceStore.setState({
    sprints,
    stories,
    teamMembers: [],
    impediments,
    workflowDefinitions: defs,
    kanbanBoards: [{ id: KANBAN_BOARD_ID, cards, wipLimits: LIMITS }],
  });
}

const def = () =>
  (useWorkspaceStore.getState().workflowDefinitions ?? []).find(
    (d) => d.id === WORKFLOW_DEFINITION_ID
  );
const boardCard = (id: string) =>
  (useWorkspaceStore.getState().kanbanBoards ?? [])[0].cards.find((c) => c.id === id)!;
const lastToast = () =>
  toastSpy.mock.calls[toastSpy.mock.calls.length - 1] as unknown as [
    string,
    { action: { onClick: () => void } },
  ];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const logged = (action: string) => spies.log.mock.calls.filter(([a]) => a === action);

function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>
    </TooltipProvider>
  );
}
const renderBoard = () => render(<KanbanClient />, { wrapper: Providers });
/** The card loads with next/dynamic: wait for it. */
const section = () => screen.findByRole("tab", { name: "Definition" });
const openTab = async (name: string) => {
  const tab = await screen.findByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  // Radix Tabs activate on mouse down (automatic activation on focus too).
  fireEvent.focus(tab);
};
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save the workflow" }));
const pickOption = (combobox: string, option: string | RegExp) => {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: combobox }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
};

beforeEach(() => {
  toastSpy.mockClear();
  spies.log.mockClear();
  spies.cheer.mockClear();
  localStorage.clear();
  localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("flow"));
  resetSelectedSprint();
  window.history.replaceState(null, "", "/kanban");
  seed();
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

/* ── The form's checks ──────────────────────────────────────────────── */

describe("the definition's draft", () => {
  it("opens a new definition on the board in view, with the SLE at 85%", () => {
    const d = draftFromWorkflow(null, "sprint");
    expect(d.board).toBe("sprint");
    expect(d.slePct).toBe("85");
    expect(d["enter:todo"]).toBe("");
  });

  it("refuses long text, bad SLE days and a mix that doesn't add up", () => {
    const d = draftFromWorkflow(null, "flow");
    d.workItem = "x".repeat(201);
    d.sleDays = "0";
    Object.assign(d, {
      "target:feature": "60",
      "target:defect": "20",
      "target:debt": "10",
      "target:risk": "5",
    });
    const v = validateWorkflowDraft(d);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.workItem).toMatch(/under 201/);
    expect(v.errors.sleDays).toMatch(/1 to 365/);
    expect(v.errors["target:total"]).toBe("The four add up to 95. Make them add up to 100.");
  });

  it("saves policies for the chosen board only and the target mix with the meanings", () => {
    const d = draftFromWorkflow(null, "flow");
    Object.assign(d, {
      board: "sprint",
      "exit:review": "Checked",
      "enter:backlog": "Not a Sprint-board stage",
      "class:expedite": "Not for stories",
      "meaning:debt": "Clean-up",
      "target:feature": "60",
      "target:defect": "20",
      "target:debt": "15",
      "target:risk": "5",
      sleDays: "8",
    });
    const v = validateWorkflowDraft(d);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const saved = applyWorkflowValues(null, v.values, "2026-11-20T10:00:00.000Z");
    expect(saved.board).toBe("sprint");
    expect(saved.policies).toEqual([{ stage: "review", exit: "Checked" }]);
    expect(saved.classPolicies).toBeUndefined();
    expect(saved.sle).toEqual({ days: 8, pct: 85 });
    expect(saved.workTypes?.find((w) => w.type === "debt")).toEqual({
      type: "debt",
      meaning: "Clean-up",
      targetPct: 15,
    });
    expect(changedParts(null, saved)).toEqual(["board", "policies", "sle", "work_types"]);
    // Saving the same draft again changes nothing.
    expect(applyWorkflowValues(saved, v.values)).toBe(saved);
  });

  it("tells a save that changes nothing by content, whatever order a synced row's keys are in", () => {
    // As Postgres jsonb reads a row back: keys shortest first, with a target mix.
    const synced = {
      id: WORKFLOW_DEFINITION_ID,
      sle: { pct: 85, days: 8 },
      board: "flow",
      policies: [
        { exit: "Checked", stage: "review" },
        { enter: "Pulled", stage: "ready" },
      ],
      updatedAt: "2026-11-01T10:00:00.000Z",
      workTypes: [
        { type: "feature", targetPct: 40 },
        { type: "defect", meaning: "Broken for a user", targetPct: 40 },
        { type: "debt", targetPct: 15 },
        { type: "risk", targetPct: 5 },
      ],
    } as unknown as WorkflowDefinition;
    const d = draftFromWorkflow(synced, "flow");
    const same = validateWorkflowDraft(d);
    if (!same.ok) throw new Error("the draft should be valid");
    expect(applyWorkflowValues(synced, same.values)).toBe(synced);
    // One real edit is a change, and only its part is logged.
    const edited = validateWorkflowDraft({ ...d, pullPolicy: "Oldest first" });
    if (!edited.ok) throw new Error("the draft should be valid");
    const saved = applyWorkflowValues(synced, edited.values);
    expect(saved).not.toBe(synced);
    expect(saved.pullPolicy).toBe("Oldest first");
    expect(changedParts(synced, saved)).toEqual(["pull"]);
  });

  it("checks a cadence", () => {
    expect(validateCadence({ name: " ", cadence: "weekly", minutes: "", purpose: "" })).toEqual({
      ok: false,
      errors: { name: "Name the meeting." },
    });
    expect(
      validateCadence({ name: "Review", cadence: "weekly", minutes: "300", purpose: "" }).ok
    ).toBe(false);
    expect(
      validateCadence({ name: "Replenish", cadence: "daily", minutes: "30", purpose: "Pick" })
    ).toEqual({
      ok: true,
      values: { name: "Replenish", cadence: "daily", minutes: 30, purpose: "Pick" },
    });
  });
});

/* ── The Definition of Workflow tab ─────────────────────────────────── */

describe("How we work: the definition", () => {
  it("shows under the Flow board with three tabs and an example to see", async () => {
    renderBoard();
    await section();
    expect(screen.getByRole("heading", { name: "How we work" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Design it (STATIK)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Versions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See an example workflow" })).toBeInTheDocument();
    // The Flow board's stages, and Done as the Definition of Done.
    expect(screen.getByLabelText("Backlog: Enters when")).toBeInTheDocument();
    expect(screen.getByText(/means your Definition of Done/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the DoD builder" })).toHaveAttribute(
      "href",
      "/dod-builder"
    );
  });

  it("saves the definition with Undo, and logs which parts changed", async () => {
    renderBoard();
    await section();
    type("What one work item is", "A support request");
    type("Review: Leaves when", "Someone else checked it");
    type("Finish within (days)", "8");
    save();
    expect(def()).toMatchObject({
      board: "flow",
      workItem: "A support request",
      policies: [{ stage: "review", exit: "Someone else checked it" }],
      sle: { days: 8, pct: 85 },
    });
    expect(lastToast()[0]).toBe("Saved the Definition of Workflow");
    expect(logged(KANBAN_ACTIONS.WORKFLOW_UPDATED)[0][1]).toEqual({
      parts: ["board", "basics", "policies", "sle"],
    });
    // On the board it describes: the SLE line and the column's policy.
    expect(screen.getByText("SLE: 85% within 8 days")).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Review" });
    expect(within(review).getByText("Policy")).toBeInTheDocument();
    expect(within(review).getByText("Someone else checked it")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ready" })).queryByText("Policy")).toBeNull();
    undoLast();
    expect(def()).toBeUndefined();
    expect(screen.queryByText("SLE: 85% within 8 days")).toBeNull();
  });

  it("keeps what was typed on each tab when switching between them", async () => {
    renderBoard();
    await section();
    type("What one work item is", "A support request");
    type("Review: Leaves when", "Someone else checked it");
    await openTab("Design it (STATIK)");
    type("Inside the team", "Reviews wait for days");
    await openTab("Versions");
    await openTab("Definition");
    expect(screen.getByLabelText("What one work item is")).toHaveValue("A support request");
    expect(screen.getByLabelText("Review: Leaves when")).toHaveValue("Someone else checked it");
    await openTab("Design it (STATIK)");
    expect(screen.getByLabelText("Inside the team")).toHaveValue("Reviews wait for days");
    // Only the tab in view shows; switching saved nothing.
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(within(panels[0]).getByLabelText("Inside the team")).toBeInTheDocument();
    expect(def()).toBeUndefined();
  });

  it("says what is wrong and saves nothing for a bad draft", async () => {
    renderBoard();
    await section();
    type("Feature target %", "60");
    type("Defect target %", "20");
    type("Debt target %", "10");
    type("Risk target %", "5");
    save();
    expect(screen.getByRole("alert")).toHaveTextContent("The four add up to 95");
    expect(def()).toBeUndefined();
  });

  it("names the other board on the board it doesn't describe, and switches to it", async () => {
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    seed({
      sprints: [sprint],
      stories: [story("a", "Pay by card")],
      defs: [
        {
          id: WORKFLOW_DEFINITION_ID,
          board: "flow",
          policies: [{ stage: "review", exit: "Checked" }],
          sle: { days: 8, pct: 85 },
        },
      ],
    });
    renderBoard();
    await section();
    expect(
      screen.getByText("Your Definition of Workflow describes the Flow board.")
    ).toBeInTheDocument();
    // Policies and the SLE stay on the board they describe.
    expect(screen.queryByText("SLE: 85% within 8 days")).toBeNull();
    expect(screen.queryByText("Policy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch to the Flow board" }));
    expect(screen.getByRole("textbox", { name: "New card title" })).toBeInTheDocument();
    expect(screen.getByText("SLE: 85% within 8 days")).toBeInTheDocument();
  });

  it("shows a Sprint-board definition's policies and SLE on the Sprint board", async () => {
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    seed({
      sprints: [sprint],
      stories: [story("a", "Pay by card")],
      defs: [
        {
          id: WORKFLOW_DEFINITION_ID,
          board: "sprint",
          policies: [{ stage: "todo", enter: "Planned in" }],
          sle: { days: 5, pct: 75 },
        },
      ],
    });
    renderBoard();
    await section();
    expect(screen.getByText("SLE: 75% within 5 days")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "To do" })).getByText("Planned in")
    ).toBeTruthy();
    expect(screen.queryByText(/describes the/)).toBeNull();
  });

  it("suggests an SLE from history once five items are finished", async () => {
    seed({ cards: [finished("a", 2), finished("b", 3)] });
    const { unmount } = renderBoard();
    await section();
    fireEvent.click(screen.getByRole("button", { name: "Suggest from history" }));
    expect(screen.getByText(/more finished items to see an SLE from history/)).toBeInTheDocument();
    unmount();
    seed({
      cards: [
        finished("a", 2),
        finished("b", 3),
        finished("c", 4),
        finished("d", 5),
        finished("e", 9),
      ],
    });
    renderBoard();
    await section();
    fireEvent.click(screen.getByRole("button", { name: "Suggest from history" }));
    expect(screen.getByLabelText("Finish within (days)")).toHaveValue(10);
    expect(screen.getByText(/85% of 5 finished items took 10 days or less/)).toBeInTheDocument();
  });

  it("drafts policies from templates without AI, and adds one with Undo", async () => {
    renderBoard();
    await section();
    fireEvent.click(screen.getByRole("button", { name: "Start from a template" }));
    expect(screen.getByText("Suggested policies")).toBeInTheDocument();
    expect(screen.getByText(/^Suggested without AI/)).toBeInTheDocument();
    expect(screen.getByText("Questions to answer next")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add: Review" }));
    expect(def()?.policies?.some((p) => p.stage === "review")).toBe(true);
    expect(screen.getByLabelText("Review: Leaves when")).toHaveValue(
      "Someone other than the author has checked it and any fixes are in"
    );
    expect(logged(KANBAN_ACTIONS.WORKFLOW_UPDATED)[0][1]).toEqual({
      parts: ["policies"],
      source: "fallback",
    });
    undoLast();
    expect(def()).toBeUndefined();
    expect(screen.getByLabelText("Review: Leaves when")).toHaveValue("");
  });

  it("adds every suggestion in one save, with one Undo that takes them all back", async () => {
    seed({ defs: [{ id: WORKFLOW_DEFINITION_ID, board: "flow", pullPolicy: "Oldest first" }] });
    const before = def();
    renderBoard();
    await section();
    fireEvent.click(screen.getByRole("button", { name: "Start from a template" }));
    toastSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Add all \d+$/ }));
    // Four stages, the start, the finish and the blocker policy.
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(lastToast()[0]).toBe("Added 7 suggestions");
    expect(def()?.policies?.map((p) => p.stage)).toEqual([
      "backlog",
      "ready",
      "in_progress",
      "review",
    ]);
    expect(def()).toMatchObject({
      startPoint: expect.any(String),
      blockerPolicy: expect.any(String),
    });
    expect(logged(KANBAN_ACTIONS.WORKFLOW_UPDATED)).toEqual([
      [
        KANBAN_ACTIONS.WORKFLOW_UPDATED,
        { parts: ["policies", "basics", "blockers"], source: "fallback" },
      ],
    ]);
    undoLast();
    expect(def()).toEqual(before);
  });
});

/* ── STATIK ─────────────────────────────────────────────────────────── */

describe("How we work: STATIK", () => {
  it("saves a step's notes, counts it, and reads what the board delivers", async () => {
    seed({ cards: [finished("a", 2)] });
    renderBoard();
    await openTab("Design it (STATIK)");
    expect(await screen.findByText("0 of 7")).toBeInTheDocument();
    // Under the card's h2, the step is an h3.
    expect(
      screen.getByRole("heading", { level: 3, name: /Step 1 of 7: What isn't working/ })
    ).toBeTruthy();
    type("Inside the team", "Reviews wait for days");
    fireEvent.click(screen.getByRole("button", { name: "Save step 1" }));
    expect(def()?.statik).toEqual({ inside: "Reviews wait for days" });
    expect(def()?.board).toBe("flow");
    expect(logged(KANBAN_ACTIONS.STATIK_STEP_SAVED)[0][1]).toEqual({ step: 1 });
    expect(screen.getByText("1 of 7")).toBeInTheDocument();
    // Step 3 is read from the board, never typed.
    fireEvent.click(screen.getByRole("button", { name: /^3: What we deliver today/ }));
    expect(screen.getByText("Items finished")).toBeInTheDocument();
    expect(screen.getByText(/Needs 5 finished items \(1 so far\)/)).toBeInTheDocument();
    // The list holds only its dt/dd groups; the board's line sits beside it.
    const list = screen.getByText("Items finished").closest("dl")!;
    expect(Array.from(list.children).every((el) => el.tagName === "DIV")).toBe(true);
    expect(screen.getByText("From the Flow board.").closest("dl")).toBeNull();
    expect(
      screen.getByText("STATIK comes from Kanban University; the steps here are in our words.")
    ).toBeInTheDocument();
  });

  it("adds a Kanban cadence on step 7 and removes it with Undo", async () => {
    renderBoard();
    await openTab("Design it (STATIK)");
    fireEvent.click(await screen.findByRole("button", { name: /^7: Cadences/ }));
    expect(screen.getByRole("heading", { level: 4, name: "Kanban cadences" })).toBeTruthy();
    type("Meeting", "Replenishment");
    type("Minutes", "30");
    fireEvent.click(screen.getByRole("button", { name: "Add cadence" }));
    expect(def()?.cadences).toEqual([
      expect.objectContaining({ name: "Replenishment", cadence: "weekly", minutes: 30 }),
    ]);
    expect(screen.getByText(/Weekly · 30 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Replenishment" }));
    expect(def()?.cadences).toBeUndefined();
    undoLast();
    expect(def()?.cadences).toHaveLength(1);
  });
});

/* ── Versions ───────────────────────────────────────────────────────── */

describe("How we work: versions", () => {
  it("asks for a definition first", async () => {
    renderBoard();
    await openTab("Versions");
    expect(
      await screen.findByText(/Save the Definition of Workflow first, then save versions/)
    ).toBeInTheDocument();
  });

  it("saves a version with the board's WIP limits, celebrates, and compares it", async () => {
    seed({ defs: [{ id: WORKFLOW_DEFINITION_ID, board: "flow" }] });
    renderBoard();
    await openTab("Versions");
    type("What changed", "Review WIP 2");
    type("What we expect to change", "Shorter cycle time");
    fireEvent.click(screen.getByRole("button", { name: "Save as version" }));
    expect(def()?.versions?.[0]).toMatchObject({
      version: 1,
      note: "Review WIP 2",
      expect: "Shorter cycle time",
      snapshot: { board: "flow", wipLimits: LIMITS },
    });
    expect(lastToast()[0]).toBe("Saved version 1");
    expect(logged(KANBAN_ACTIONS.WORKFLOW_VERSION_SAVED)[0][1]).toEqual({ version: 1 });
    expect(spies.cheer).toHaveBeenCalledWith("kanban", "milestone");
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Compare before and after/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Median cycle time" })).toBeTruthy();
    expect(screen.getByText(/The after window has 1 of 28 days so far/)).toBeInTheDocument();
    expect(screen.getByText(/cycle time before the change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "2 weeks" }));
    expect(screen.getByText(/1 of 14 days so far/)).toBeInTheDocument();
  });
});

/* ── The example ────────────────────────────────────────────────────── */

describe("the example workflow", () => {
  it("loads in memory only, shows its policies on the Flow board, and clears", async () => {
    renderBoard();
    await section();
    fireEvent.click(screen.getByRole("button", { name: "See an example workflow" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByLabelText("What one work item is")).toHaveValue(
      "A support request that needs a change to the product"
    );
    expect(screen.getByText("SLE: 85% within 8 days")).toBeInTheDocument();
    // Edits stay in memory and nothing is logged.
    type("Pull policy", "Oldest first");
    save();
    expect(def()).toBeUndefined();
    expect(spies.log).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByLabelText("What one work item is")).toHaveValue("");
    expect(screen.queryByText("SLE: 85% within 8 days")).toBeNull();
  });

  it("has STATIK notes, cadences and two versions, the second expecting a shorter cycle", () => {
    const ex = buildWorkflowExample(new Date("2026-11-20T10:00:00.000Z"));
    expect(ex.board).toBe("flow");
    expect(Object.keys(ex.statik ?? {})).toHaveLength(8);
    expect(ex.versions?.map((v) => v.snapshot.wipLimits.review)).toEqual([3, 2]);
    expect(ex.versions?.[1].expect).toBe("Review WIP 2 will cut cycle time");
    expect(ex.cadences?.every((c) => c.id.startsWith("example-"))).toBe(true);
  });
});

/* ── Why a card is blocked ──────────────────────────────────────────── */

describe("the block note", () => {
  const blocked = () =>
    card("w", "Wallet payments", {
      blocked: true,
      blockLog: [{ from: ago(2) }],
    });

  it("writes the cause, a default cluster and its side on the open spell, with Undo", async () => {
    seed({ cards: [blocked()] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What blocks it"), {
      target: { value: "Waiting on the payments team's keys" },
    });
    fireEvent.change(within(dialog).getByLabelText("Blocker cluster"), {
      target: { value: "default:6" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(boardCard("w").blockLog?.[0]).toMatchObject({
      cause: "Waiting on the payments team's keys",
      cluster: "Another team",
      side: "external",
    });
    expect(lastToast()[0]).toBe("Saved why it's blocked");
    const [, payload] = logged(KANBAN_ACTIONS.BLOCK_NOTED)[0];
    expect(payload).toEqual({ cardId: "w", cluster: "default", clusterIndex: 6, side: "external" });
    expect(JSON.stringify(payload)).not.toMatch(/keys|Another team/);
    expect(
      screen.getByRole("button", { name: /^Why: Waiting on the payments tea…: Wallet payments$/ })
    ).toBeInTheDocument();
    undoLast();
    expect(boardCard("w").blockLog).toEqual([{ from: expect.any(String) }]);
  });

  it("Undo takes back only the note: a spell closed since keeps its end", async () => {
    seed({ cards: [blocked()] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What blocks it"), {
      target: { value: "Waiting on keys" },
    });
    fireEvent.change(within(dialog).getByLabelText("Blocker cluster"), {
      target: { value: "default:6" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    const saveToast = lastToast();
    // Unblocked inside the Undo window: the store closes the spell.
    act(() => {
      const board = useWorkspaceStore.getState().kanbanBoards![0];
      useWorkspaceStore.getState().upsertKanbanBoard({
        ...board,
        cards: board.cards.map((c) => (c.id === "w" ? { ...c, blocked: false } : c)),
      });
    });
    const closedAt = boardCard("w").blockLog?.[0].to;
    expect(closedAt).toBeTruthy();
    act(() => saveToast[1].action.onClick());
    expect(boardCard("w").blocked).toBeFalsy();
    expect(boardCard("w").blockLog).toEqual([{ from: expect.any(String), to: closedAt }]);
  });

  it("Undo removes a spell the note started for a block from before tracking", () => {
    const log: BlockSpell[] = [
      { from: "2026-11-01T09:00:00.000Z", to: "2026-11-02T09:00:00.000Z" },
    ];
    const started: BlockSpell[] = [
      ...log,
      { from: "2026-11-20T09:00:00.000Z", earlier: true, cause: "Keys" },
    ];
    expect(unnotedLog(started, "2026-11-20T09:00:00.000Z", null)).toEqual(log);
    expect(unnotedLog(started.slice(1), "2026-11-20T09:00:00.000Z", null)).toBeUndefined();
    // A note on an existing spell: its own fields come back, its end stays.
    const noted = [
      {
        from: "2026-11-01T09:00:00.000Z",
        to: "2026-11-03T09:00:00.000Z",
        cause: "New",
        cluster: "Another team",
        side: "external" as const,
      },
    ];
    expect(
      unnotedLog(noted, "2026-11-01T09:00:00.000Z", {
        from: "2026-11-01T09:00:00.000Z",
        cause: "Old",
      })
    ).toEqual([{ from: "2026-11-01T09:00:00.000Z", to: "2026-11-03T09:00:00.000Z", cause: "Old" }]);
    // A spell no longer there: the log as it is.
    expect(
      unnotedLog(noted, "2026-10-01T09:00:00.000Z", { from: "2026-10-01T09:00:00.000Z" })
    ).toBe(noted);
  });

  it("closes without an Undo toast when Save why changes nothing", async () => {
    seed({
      cards: [
        card("w", "Wallet payments", {
          blocked: true,
          blockLog: [
            {
              from: ago(2),
              cause: "Waiting on review",
              cluster: "Waiting for a review",
              side: "internal",
            },
          ],
        }),
      ],
    });
    const stored = boardCard("w").blockLog;
    renderBoard();
    fireEvent.click(
      screen.getByRole("button", { name: /^Why: Waiting on review: Wallet payments$/ })
    );
    const dialog = await screen.findByRole("dialog");
    toastSpy.mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastSpy).not.toHaveBeenCalled();
    expect(logged(KANBAN_ACTIONS.BLOCK_NOTED)).toHaveLength(0);
    expect(boardCard("w").blockLog).toBe(stored);
  });

  it("names a new cluster with its side, and logs it as custom without its name", async () => {
    seed({ cards: [blocked()] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Blocker cluster"), {
      target: { value: "new" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(within(dialog).getByText(/Name the new cluster/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("New cluster's name"), {
      target: { value: "Legal sign-off" },
    });
    fireEvent.change(within(dialog).getByLabelText("It sits"), { target: { value: "external" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(boardCard("w").blockLog?.[0]).toMatchObject({
      cluster: "Legal sign-off",
      side: "external",
    });
    const [, payload] = logged(KANBAN_ACTIONS.BLOCK_NOTED)[0];
    expect(payload).toEqual({ cardId: "w", cluster: "custom", side: "external" });
  });

  it("links an open impediment, or logs a new one linked to the spell", async () => {
    const open: Impediment = {
      id: "imp1",
      title: "Sandbox keys from payments",
      severity: "medium",
      raisedAt: "2026-11-01",
      source: "manual",
    };
    seed({ cards: [blocked()], impediments: [open] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Link an impediment"), {
      target: { value: "imp1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(boardCard("w").blockLog?.[0].sentTo).toEqual([
      { route: "impediment", targetId: "imp1", at: expect.any(String) },
    ]);

    // Unlink, then log a new impediment from the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Link an impediment"), {
      target: { value: "" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(boardCard("w").blockLog?.[0].sentTo).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What blocks it"), {
      target: { value: "No sandbox keys" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log as impediment" }));
    const made = useWorkspaceStore.getState().impediments!.find((i) => i.id !== "imp1")!;
    expect(made).toMatchObject({
      title: "Wallet payments",
      description: "No sandbox keys",
    });
    // Its link back opens the Flow board, where the card is.
    expect(made.sourceRef).toEqual({ tool: "kanban", id: "w", doc: "flow" });
    expect(sourceHref(made.sourceRef)).toBe("/kanban?board=flow");
    expect(boardCard("w").blockLog?.[0].sentTo).toEqual([
      { route: "impediment", targetId: made.id, at: expect.any(String) },
    ]);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Logged as an impediment");
    expect(within(dialog).getByRole("link", { name: "Open Impediments" })).toHaveAttribute(
      "href",
      "/impediments"
    );
  });

  it("never offers or keeps a link to an example impediment", async () => {
    const example: Impediment = {
      id: "example-imp",
      title: "Example build server down",
      severity: "high",
      raisedAt: "2026-11-01",
      source: "manual",
    };
    const real: Impediment = {
      id: "imp1",
      title: "Sandbox keys from payments",
      severity: "medium",
      raisedAt: "2026-11-01",
      source: "manual",
    };
    seed({
      cards: [
        card("w", "Wallet payments", {
          blocked: true,
          blockLog: [
            {
              from: ago(2),
              sentTo: [{ route: "impediment", targetId: "example-imp", at: ago(1) }],
            },
          ],
        }),
      ],
      impediments: [example, real],
    });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Link an impediment");
    expect(within(select).queryByRole("option", { name: /Example build/ })).toBeNull();
    expect(within(select).getByRole("option", { name: real.title })).toBeInTheDocument();
    expect(select).toHaveValue("");
    fireEvent.change(within(dialog).getByLabelText("What blocks it"), {
      target: { value: "No sandbox keys" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(boardCard("w").blockLog?.[0]).toEqual({
      from: expect.any(String),
      cause: "No sandbox keys",
    });
  });

  it("starts an earlier spell for a block from before tracking", async () => {
    seed({ cards: [card("w", "Wallet payments", { blocked: true })] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Wallet payments" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Blocked since before tracking/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("What blocks it"), {
      target: { value: "Another team" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    expect(boardCard("w").blockLog).toEqual([
      { from: expect.any(String), earlier: true, cause: "Another team" },
    ]);
    // Undo takes the spell the note started away again.
    undoLast();
    expect(boardCard("w").blockLog).toBeUndefined();
    expect(boardCard("w").blocked).toBe(true);
  });

  it("is never offered on example cards or unblocked ones", () => {
    seed({
      cards: [
        card("example-w", "Example wallet", { blocked: true }),
        card("x", "Receipts by email"),
      ],
    });
    renderBoard();
    expect(screen.queryByRole("button", { name: /^Add why/ })).toBeNull();
  });

  it("works on a Sprint-board story through the board's writer", async () => {
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    seed({
      sprints: [sprint],
      stories: [story("a", "Pay by card", { blocked: true, blockLog: [{ from: ago(1) }] })],
    });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Pay by card" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Blocker cluster"), {
      target: { value: "default:0" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save why" }));
    const saved = useWorkspaceStore.getState().stories.find((s) => s.id === "a")!;
    expect(saved.blockLog?.[0]).toMatchObject({
      cluster: "Waiting for a review",
      side: "internal",
    });
    expect(logged(KANBAN_ACTIONS.BLOCK_NOTED)[0][1]).toEqual({
      storyId: "a",
      cluster: "default",
      clusterIndex: 0,
      side: "internal",
      board: "sprint",
    });
  });

  it("logs a Sprint-board story as an impediment that links back to its sprint's board", async () => {
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    seed({
      sprints: [sprint],
      stories: [story("a", "Pay by card", { blocked: true, blockLog: [{ from: ago(1) }] })],
    });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add why: Pay by card" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Log as impediment" }));
    const made = useWorkspaceStore.getState().impediments!.find((i) => i.title === "Pay by card")!;
    expect(made.sourceRef).toEqual({ tool: "kanban", id: "a", doc: "s7" });
    expect(sourceHref(made.sourceRef)).toBe("/kanban?sprint=s7");
  });
});

/* ── The Flow card's type ───────────────────────────────────────────── */

describe("the Type select", () => {
  beforeEach(() => {
    // Radix Select's pointer handling, which jsdom lacks.
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  it("sets and clears a Flow card's work type", async () => {
    seed({ cards: [card("x", "Receipts by email")] });
    renderBoard();
    pickOption("Type of Receipts by email", "Defect");
    expect(boardCard("x").workType).toBe("defect");
    expect(spies.log).toHaveBeenCalledWith(KANBAN_ACTIONS.CARD_UPDATED, {
      cardId: "x",
      workType: "defect",
    });
    pickOption("Type of Receipts by email", "No type");
    await waitFor(() => expect(boardCard("x").workType).toBeUndefined());
  });
});

/* ── Markdown ───────────────────────────────────────────────────────── */

describe("the Markdown exports", () => {
  const flowDef = buildWorkflowExample(new Date("2026-11-20T10:00:00.000Z"));

  it("appends the definition and its versions to the board it describes", () => {
    const md = toMarkdown({ cards: [], wipLimits: LIMITS }, new Date("2026-11-20"), flowDef);
    expect(md).toContain("## Definition of Workflow");
    expect(md).toContain("Describes the Flow board.");
    expect(md).toContain(
      "| Review | A pull request is open | Someone other than the author has checked it and any fixes are in |"
    );
    expect(md).toContain("| Done | Meets the Definition of Done | |");
    expect(md).toContain("- **WIP limits:** Ready 5, In progress 3, Review 2.");
    expect(md).toContain("- **SLE:** 85% within 8 days");
    expect(md).toContain("Expedite: A customer can't work");
    expect(md).toContain("Replenishment (weekly, 30 min): Pick what moves into Ready");
    expect(md).toContain("## Versions");
    expect(md).toContain("| 2 |");
    expect(md).toContain("Review WIP 2 will cut cycle time");
    // Without a definition, the export is as it was.
    expect(toMarkdown({ cards: [], wipLimits: LIMITS }, new Date("2026-11-20"))).not.toContain(
      "Definition of Workflow"
    );
  });

  it("puts a Sprint-board definition on the sprint export, and the page picks the right one", async () => {
    const md = sprintBoardMarkdown(
      {
        sprint,
        stories: [],
        wipLimits: LIMITS,
        workflow: { ...flowDef, board: "sprint", classPolicies: undefined },
      },
      new Date("2026-11-20")
    );
    expect(md).toContain("Describes the Sprint board.");
    expect(md).toContain("| To do |");
    expect(md).not.toContain("Classes of service");

    seed({ defs: [{ ...flowDef, versions: undefined }] });
    renderBoard();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "## Definition of Workflow"
    );
  });
});

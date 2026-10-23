import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import type { Sprint, SprintGoal, SprintGoalOutcome } from "@/lib/stores/workspace-types";

/**
 * Sprint Goal, "Goal met?": once the sprint is in its last day or over,
 * the tool asks "Did we meet the sprint goal?", keeps the answer as a
 * draft until Save, stores it on the sprint's goal document (where the
 * tool.sprint_goal.record_outcome verb writes too, and the Sprint Review
 * will read it), and shows it in the verdict and the Markdown export.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn() }));
const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SprintGoalClient } from "@/app/(tools)/sprint-goal/sprint-goal-client";
import { DRAFT_GOAL_ID, normalizeGoal, viewGoal } from "@/app/(tools)/sprint-goal/doc";
import { buildExample } from "@/app/(tools)/sprint-goal/example";
import { toMarkdown } from "@/app/(tools)/sprint-goal/markdown";
import { goalVerdict } from "@/app/(tools)/sprint-goal/verdict";
import {
  normalizeOutcome,
  outcomeClause,
  outcomeDate,
  outcomeMoment,
  validateOutcome,
  withOutcome,
  withoutOutcome,
} from "@/app/(tools)/sprint-goal/outcome";

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Monday 26 Oct 2026, midday, so no time zone moves the day. */
const NOW = new Date(2026, 9, 26, 12);

const sprint = (id: string, extra: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  pointsPlanned: 20,
  status: "active",
  ...extra,
});

const goalDoc = (id: string, extra: Partial<SprintGoal> = {}): SprintGoal => ({
  id,
  businessObjective: "",
  goal: "",
  criteria: [],
  keyResults: [],
  ...extra,
});

const answer = (extra: Partial<SprintGoalOutcome> = {}): SprintGoalOutcome => ({
  met: "partly",
  note: "Colour filters moved to Sprint 3",
  decidedAt: "2026-10-23T12:00:00.000Z",
  ...extra,
});

const S2_DOC = "sprint-goal:sprint:s2";
const docs = () => useWorkspaceStore.getState().sprintGoals ?? [];
const docById = (id: string) => docs().find((d) => d.id === id);
const sprintById = (id: string) => useWorkspaceStore.getState().sprints.find((s) => s.id === id)!;

const renderGoal = () =>
  render(
    <TooltipProvider>
      <SprintGoalClient />
    </TooltipProvider>
  );

const question = () => screen.queryByRole("region", { name: "Did we meet the sprint goal?" });
const answerGroup = () => screen.getByRole("radiogroup", { name: "Did we meet the sprint goal?" });
const pick = (label: string) =>
  fireEvent.click(within(answerGroup()).getByRole("radio", { name: label }));
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

/** Click Undo on the most recent undoable toast. */
const undoLast = () => {
  const [, opts] = toastSpy.mock.calls.at(-1)!;
  act(() => opts.action.onClick());
};

beforeEach(() => {
  // Only the clock is faked: focus moves still run on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  toastSpy.mockReset();
  exported.markdown = undefined;
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({ sprints: [], sprintGoals: [], okrs: [], stories: [] });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ sprints: [], sprintGoals: [], okrs: [], stories: [] });
});

// ─── When to ask ────────────────────────────────────────────────────────────

describe("when the tool asks", () => {
  it("asks in the sprint's last day and after it, not while it runs", () => {
    const today = "2026-10-26";
    expect(outcomeMoment(sprint("s2", { endDate: "2026-11-06" }), today)).toBeNull();
    expect(outcomeMoment(sprint("s2", { endDate: "2026-10-26" }), today)).toBe("last-day");
    expect(outcomeMoment(sprint("s2", { endDate: "2026-10-23" }), today)).toBe("ended");
    // A sprint that hasn't started isn't over either.
    expect(
      outcomeMoment(sprint("s2", { startDate: "2026-11-09", endDate: "2026-11-20" }), today)
    ).toBeNull();
  });

  it("goes by the status once the sprint is closed, whatever its dates say", () => {
    const future = { startDate: "2026-11-09", endDate: "2026-11-20" };
    expect(outcomeMoment(sprint("s2", { ...future, status: "completed" }), "2026-10-26")).toBe(
      "ended"
    );
    expect(outcomeMoment(sprint("s2", { ...future, status: "cancelled" }), "2026-10-26")).toBe(
      "cancelled"
    );
  });

  it("ignores placeholder and missing dates", () => {
    const placeholder = sprint("s2", { startDate: "2020-01-01", endDate: "2020-01-14" });
    expect(outcomeMoment(placeholder, "2026-10-26")).toBeNull();
    expect(outcomeMoment({ ...placeholder, status: "completed" }, "2026-10-26")).toBe("ended");
    expect(outcomeMoment(sprint("s2", { endDate: "" }), "2026-10-26")).toBeNull();
  });

  it("defaults to today's date", () => {
    expect(outcomeMoment(sprint("s2", { endDate: "2026-10-26" }))).toBe("last-day");
  });
});

// ─── The answer ─────────────────────────────────────────────────────────────

describe("the stored answer", () => {
  it("needs an answer and caps the note, never saving a blank one", () => {
    expect(validateOutcome({ met: null, note: "Shipped" })).toEqual({
      ok: false,
      errors: { met: "Pick whether the sprint met its goal." },
    });
    expect(validateOutcome({ met: "met", note: "x".repeat(2001) })).toEqual({
      ok: false,
      errors: { note: "Keep the note to 2000 characters or fewer." },
    });
    expect(validateOutcome({ met: "partly", note: "  Half done  " })).toEqual({
      ok: true,
      values: { met: "partly", note: "Half done" },
    });
    expect(validateOutcome({ met: "not-met", note: "   " })).toEqual({
      ok: true,
      values: { met: "not-met" },
    });
  });

  it("dates a new answer, replaces an earlier one, and clears or restores it", () => {
    const doc = goalDoc(S2_DOC, { sprintId: "s2", goal: "Ship search filters", outcome: answer() });
    const next = withOutcome(doc, { met: "met" }, NOW);
    expect(next.outcome).toEqual({ met: "met", decidedAt: NOW.toISOString() });
    expect(next.goal).toBe("Ship search filters");
    const cleared = withoutOutcome(next);
    expect("outcome" in cleared).toBe(false);
    expect(withoutOutcome(cleared, answer()).outcome).toEqual(answer());
  });

  it("loads legacy documents without an answer unchanged", () => {
    const legacy = {
      id: DRAFT_GOAL_ID,
      businessObjective: "Grow activation",
      goal: "Ship guided onboarding",
      criteria: [],
      keyResults: ["Activation 60%"],
    } as SprintGoal;
    const doc = normalizeGoal(legacy);
    expect("outcome" in doc).toBe(false);
    expect(doc).toEqual(legacy);
  });

  it("keeps an answer an agent recorded and drops one it can't read", () => {
    expect(normalizeOutcome(answer())).toEqual(answer());
    // The verb records no note when none is given.
    expect(normalizeOutcome({ met: "met", decidedAt: "2026-10-23T09:00:00Z" })).toEqual({
      met: "met",
      decidedAt: "2026-10-23T09:00:00Z",
    });
    expect(normalizeOutcome({ met: "yes", decidedAt: "2026-10-23" })).toBeUndefined();
    expect(normalizeOutcome("met")).toBeUndefined();
    expect(normalizeOutcome({ met: "not-met", note: 3 })).toEqual({
      met: "not-met",
      decidedAt: "",
    });
    const stored = goalDoc(S2_DOC, { outcome: { met: "maybe" } as unknown as SprintGoalOutcome });
    expect(normalizeGoal(stored).outcome).toBeUndefined();
    expect(viewGoal([goalDoc(S2_DOC, { outcome: answer() })], sprint("s2")).doc.outcome).toEqual(
      answer()
    );
  });

  it("says the answer in words", () => {
    expect(outcomeClause("met", "Sprint 2")).toBe("Sprint 2 met its goal");
    expect(outcomeClause("partly", "Sprint 2")).toBe("Sprint 2 partly met its goal");
    expect(outcomeClause("not-met")).toBe("The sprint didn't meet its goal");
    expect(outcomeDate(answer())).toBe("23 Oct 2026");
    expect(outcomeDate(answer({ decidedAt: "" }))).toBeNull();
  });
});

// ─── Verdict and Markdown ───────────────────────────────────────────────────

describe("the answer in the verdict and the export", () => {
  const goal = goalDoc(S2_DOC, {
    sprintId: "s2",
    goal: "Shoppers filter search results by size in one tap",
    businessObjective: "Grow repeat searches",
  });

  it("leads the verdict with the answer", () => {
    expect(goalVerdict({ ...goal, outcome: answer() }, sprint("s2"))).toBe(
      "Sprint 2 partly met its goal. The goal meets all five SMART checks, but it has no acceptance criteria yet."
    );
    expect(goalVerdict({ ...goal, outcome: answer({ met: "not-met" }) })).toMatch(
      /^The sprint didn't meet its goal\. The goal meets/
    );
    expect(goalVerdict(goalDoc(S2_DOC, { outcome: answer({ met: "met" }) }), sprint("s2"))).toBe(
      "Sprint 2 met its goal; no goal statement is written here."
    );
    // Without an answer the verdict is as before.
    expect(goalVerdict(goal, sprint("s2"))).toBe(
      "The goal meets all five SMART checks, but it has no acceptance criteria yet."
    );
  });

  it("exports the answer, its date and note under the goal", () => {
    const md = toMarkdown({ ...goal, outcome: answer() }, new Date(2026, 9, 26), {
      sprint: sprint("s2"),
    });
    const lines = md.split("\n");
    const at = lines.indexOf("## Goal met?");
    expect(at).toBeGreaterThan(lines.indexOf("## Sprint goal"));
    expect(at).toBeLessThan(lines.indexOf("## Business objective"));
    expect(lines.slice(at, at + 5)).toEqual([
      "## Goal met?",
      "",
      "**Partly met** · recorded 23 Oct 2026",
      "",
      "Note: Colour filters moved to Sprint 3",
    ]);
    expect(lines.at(-2)).toBe(
      "**Sprint 2 partly met its goal. The goal meets all five SMART checks, but it has no acceptance criteria yet.**"
    );
  });

  it("exports an answer without a note or a usable date", () => {
    const md = toMarkdown(
      { ...goal, outcome: { met: "met", decidedAt: "" } },
      new Date(2026, 9, 26),
      { sprint: sprint("s2") }
    );
    expect(md).toContain("## Goal met?\n\n**Met**\n\n## Business objective");
    expect(md).not.toContain("Note:");
  });

  it("exports an answer on its own, and legacy documents as before", () => {
    const only = toMarkdown(goalDoc(S2_DOC, { outcome: answer() }), new Date(2026, 9, 26), {
      sprint: sprint("s2"),
    });
    expect(only).not.toContain("No sprint goal yet.");
    expect(only).toContain("**Partly met** · recorded 23 Oct 2026");

    const legacy = toMarkdown(goal, new Date(2026, 9, 26), { sprint: sprint("s2") });
    expect(legacy).not.toContain("Goal met?");
    expect(toMarkdown(goalDoc(S2_DOC), new Date(2026, 9, 26))).toContain("No sprint goal yet.");
  });
});

// ─── The tool ───────────────────────────────────────────────────────────────

describe("Goal met? on the page", () => {
  it("doesn't ask while the sprint runs", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { endDate: "2026-11-06", goal: "Ship search filters" })],
    });
    renderGoal();
    expect(question()).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("asks on the sprint's last day", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { endDate: "2026-10-26", goal: "Ship search filters" })],
    });
    renderGoal();
    expect(
      within(question()!).getByText(
        "Sprint 2 ends today. Once the team has looked at the goal, record its answer here."
      )
    ).toBeInTheDocument();
  });

  it("doesn't ask about a sprint with no goal, or for the draft", () => {
    useWorkspaceStore.setState({ sprints: [sprint("s2")] });
    const { unmount } = renderGoal();
    expect(question()).toBeNull();
    unmount();
    useWorkspaceStore.setState({ sprints: [] });
    renderGoal();
    expect(question()).toBeNull();
  });

  it("saves nothing until an answer is picked, then stores it on the sprint's document", async () => {
    useWorkspaceStore.setState({ sprints: [sprint("s2", { goal: "Ship search filters" })] });
    renderGoal();
    expect(
      within(question()!).getByText("Sprint 2 is over. Record the team's answer while it's fresh.")
    ).toBeInTheDocument();
    // No answer is pre-selected.
    for (const radio of within(answerGroup()).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }

    save();
    expect(screen.getByText("Pick whether the sprint met its goal.")).toBeInTheDocument();
    expect(docs()).toEqual([]);
    await waitFor(() =>
      expect(within(answerGroup()).getByRole("radio", { name: "Met" })).toHaveFocus()
    );

    pick("Partly met");
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "  Colour filters moved to Sprint 3 " },
    });
    // Picking and typing are still a draft.
    expect(docs()).toEqual([]);
    save();

    expect(docById(S2_DOC)).toEqual({
      id: S2_DOC,
      sprintId: "s2",
      businessObjective: "",
      goal: "Ship search filters",
      criteria: [],
      keyResults: [],
      outcome: {
        met: "partly",
        note: "Colour filters moved to Sprint 3",
        decidedAt: NOW.toISOString(),
      },
    });
    expect(docById(DRAFT_GOAL_ID)).toBeUndefined();
    expect(sprintById("s2").goal).toBe("Ship search filters");
    // A first answer replaces nothing, so there's nothing to undo.
    expect(toastSpy).not.toHaveBeenCalled();

    // The recorded answer, with Change, and the verdict leads with it.
    const card = question()!;
    expect(within(card).getByText("Partly met")).toBeInTheDocument();
    expect(within(card).getByText("Colour filters moved to Sprint 3")).toBeInTheDocument();
    expect(within(card).getByText("Recorded 26 Oct 2026")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(within(card).queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(/^Sprint 2 partly met its goal\. The goal meets/)).toBeInTheDocument();
    expect(exported.markdown).toContain("**Partly met** · recorded 26 Oct 2026");
    await waitFor(() => expect(within(card).getByText("Partly met").parentElement).toHaveFocus());
  });

  it("shows an answer an agent recorded and keeps the rest of an old document", () => {
    const legacy = goalDoc(S2_DOC, {
      sprintId: "s2",
      goal: "Ship search filters",
      criteria: [{ id: "c1", text: "Size filter live", relevantChecked: true }],
    });
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { goal: "Ship search filters" })],
      sprintGoals: [legacy],
    });
    renderGoal();
    // An old document has no answer yet, so the tool asks.
    pick("Met");
    save();
    expect(docById(S2_DOC)).toMatchObject({
      criteria: legacy.criteria,
      outcome: { met: "met", decidedAt: NOW.toISOString() },
    });
    expect(docById(S2_DOC)?.outcome).not.toHaveProperty("note");
  });

  it("changes an answer from the recorded one, with Undo", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { goal: "Ship search filters" })],
      sprintGoals: [
        goalDoc(S2_DOC, { sprintId: "s2", goal: "Ship search filters", outcome: answer() }),
      ],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    // The form starts from the recorded answer.
    expect(within(answerGroup()).getByRole("radio", { name: "Partly met" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByLabelText("Note")).toHaveValue("Colour filters moved to Sprint 3");
    expect(
      screen.getByText("Saving replaces the answer recorded on 23 Oct 2026.")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(answerGroup()).getByRole("radio", { name: "Partly met" })).toHaveFocus()
    );

    pick("Met");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "" } });
    save();
    expect(docById(S2_DOC)?.outcome).toEqual({ met: "met", decidedAt: NOW.toISOString() });
    expect(toastSpy.mock.calls.at(-1)![0]).toBe("Changed Sprint 2's answer to “Met”");
    expect(screen.getByText(/^Sprint 2 met its goal\./)).toBeInTheDocument();

    undoLast();
    expect(docById(S2_DOC)?.outcome).toEqual(answer());
    expect(within(question()!).getByText("Partly met")).toBeInTheDocument();
  });

  it("cancels a change without writing", async () => {
    const stored = goalDoc(S2_DOC, {
      sprintId: "s2",
      goal: "Ship search filters",
      outcome: answer(),
    });
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { goal: "Ship search filters" })],
      sprintGoals: [stored],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    pick("Not met");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(docById(S2_DOC)).toEqual(stored);
    expect(within(question()!).getByText("Partly met")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Change" })).toHaveFocus());
  });

  it("clears an answer with Undo, and asks again", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { goal: "Ship search filters" })],
      sprintGoals: [
        goalDoc(S2_DOC, { sprintId: "s2", goal: "Ship search filters", outcome: answer() }),
      ],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Clear answer" }));
    expect(docById(S2_DOC)).not.toHaveProperty("outcome");
    expect(docById(S2_DOC)?.goal).toBe("Ship search filters");
    expect(toastSpy.mock.calls.at(-1)![0]).toBe(
      "Cleared Sprint 2's answer to “Did we meet the sprint goal?”"
    );
    expect(answerGroup()).toBeInTheDocument();
    expect(screen.queryByText(/partly met its goal/)).toBeNull();
    expect(exported.markdown).not.toContain("Goal met?");
    await waitFor(() => expect(screen.getByText(/^The goal meets/)).toHaveFocus());

    undoLast();
    expect(docById(S2_DOC)?.outcome).toEqual(answer());
    expect(within(question()!).getByText("Partly met")).toBeInTheDocument();
  });

  it("shows an answer recorded before the sprint ended", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { endDate: "2026-11-06", goal: "Ship search filters" })],
      sprintGoals: [
        goalDoc(S2_DOC, { sprintId: "s2", goal: "Ship search filters", outcome: answer() }),
      ],
    });
    renderGoal();
    expect(within(question()!).getByText("Partly met")).toBeInTheDocument();
  });

  it("keeps the answer out of the example, and never writes it there", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2")],
      sprintGoals: [goalDoc(S2_DOC, { sprintId: "s2", ...buildExample(), outcome: answer() })],
    });
    renderGoal();
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(question()).toBeNull();
    expect(screen.queryByText(/partly met its goal/)).toBeNull();
    expect(exported.markdown).not.toContain("Goal met?");
    // Clearing the example brings the sprint's own answer back.
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(docById(S2_DOC)?.outcome).toEqual(answer());
    expect(within(question()!).getByText("Partly met")).toBeInTheDocument();
  });

  it("keeps the sprint's answer when a draft replaces its goal", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { goal: "Ship search filters" })],
      sprintGoals: [
        goalDoc(S2_DOC, { sprintId: "s2", goal: "Ship search filters", outcome: answer() }),
        goalDoc(DRAFT_GOAL_ID, { goal: "Ship saved searches", businessObjective: "Grow" }),
      ],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace goal" }));
    expect(docById(S2_DOC)).toMatchObject({ goal: "Ship saved searches", outcome: answer() });
    undoLast();
    expect(docById(S2_DOC)).toMatchObject({ goal: "Ship search filters", outcome: answer() });
  });
});

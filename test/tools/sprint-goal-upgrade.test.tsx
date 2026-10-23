import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { resetSelectedSprint, SELECTED_SPRINT_KEY } from "@/lib/sprints/use-selected-sprint";
import type { Okr, Sprint, SprintGoal } from "@/lib/stores/workspace-types";

/**
 * Sprint Goal, Phase 2 of the tool upgrade: one goal per sprint, kept in
 * step with `Sprint.goal`; SMART checks on whole words and on the goal
 * sentence itself; key results linked from the OKRs tool instead of
 * copied; the draft for when no sprint is chosen, never hidden.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn() }));
const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
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
  useHistoryLogger: () => ({ log: history.log }),
}));
// Steps swap synchronously instead of waiting on exit animations.
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
import {
  goalSmart,
  hasVagueWord,
  isMeasurable,
  isTimeBound,
  smartCheck,
  validateSmart,
} from "@/app/(tools)/sprint-goal/smart";
import {
  DRAFT_GOAL_ID,
  goalConflict,
  goalDocId,
  normalizeGoal,
  sprintGoalPatch,
  usableDraft,
  viewGoal,
} from "@/app/(tools)/sprint-goal/doc";
import {
  EXAMPLE_OKR_ID,
  buildExample,
  buildExampleOkr,
  withoutExample,
} from "@/app/(tools)/sprint-goal/example";
import { toMarkdown } from "@/app/(tools)/sprint-goal/markdown";
import { goalVerdict } from "@/app/(tools)/sprint-goal/verdict";
import { krProgressText, resolveLinkedOkrs } from "@/app/(tools)/sprint-goal/okr-links";
import { validateCriterion } from "@/app/(tools)/sprint-goal/criteria-step";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const sprint = (id: string, extra: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  pointsPlanned: 20,
  status: "planned",
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

const okr = (id: string, objective: string, extra: Partial<Okr> = {}): Okr => ({
  id,
  objective,
  quarter: "Q4 2026",
  keyResults: [{ id: `${id}-kr`, title: "Weekly active teams", current: 40, target: 80 }],
  ...extra,
});

const docs = () => useWorkspaceStore.getState().sprintGoals ?? [];
const docById = (id: string) => docs().find((d) => d.id === id);
const sprintById = (id: string) => useWorkspaceStore.getState().sprints.find((s) => s.id === id)!;

const renderGoal = () =>
  render(
    <TooltipProvider>
      <SprintGoalClient />
    </TooltipProvider>
  );

// Radix tabs switch on mouse down, not click.
const openStep = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

const commit = (label: string, value: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

/** Click Undo on the most recent undoable toast. */
const undoLast = () => {
  const [, opts] = toastSpy.mock.calls.at(-1)!;
  act(() => opts.action.onClick());
};

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockClear();
  exported.markdown = undefined;
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({ sprints: [], sprintGoals: [], okrs: [], stories: [] });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], sprintGoals: [], okrs: [], stories: [] });
});

// ─── SMART checks ───────────────────────────────────────────────────────────

describe("SMART checks match whole words", () => {
  it("doesn't count words that merely contain a quantity as measurable", () => {
    // "account" holds "count", "integrate" and "accurate" hold "rate".
    expect(isMeasurable("Integrate the account page with billing")).toBe(false);
    expect(isMeasurable("Accurate addresses on every discounted order")).toBe(false);
    expect(isMeasurable("Scoreboard for the support team")).toBe(false);
  });

  it("still finds real quantities", () => {
    expect(isMeasurable("Raise the conversion rate on checkout")).toBe(true);
    expect(isMeasurable("Payment-step completion reaches 85%")).toBe(true);
    expect(isMeasurable("Cut page load to 2 seconds")).toBe(true);
    expect(isMeasurable("Reach 2,000 sign-ups")).toBe(true);
    expect(isMeasurable("Pay in one tap")).toBe(true);
    expect(isMeasurable("At least half of trials see the tour")).toBe(true);
  });

  it("doesn't take a deadline's number for a quantity", () => {
    expect(isMeasurable("Ship the new flow by the end of Sprint 14")).toBe(false);
    expect(isMeasurable("Launch on 2026-11-02")).toBe(false);
    expect(isMeasurable("Live for beta users by 3 May")).toBe(false);
    expect(isMeasurable("Release by 25/10")).toBe(false);
    expect(isMeasurable("Ready in Q3")).toBe(false);
    expect(isMeasurable("Done by 2027")).toBe(false);
    // "No one" isn't a count of one.
    expect(isMeasurable("No one waits at checkout")).toBe(false);
  });

  it("doesn't count words that merely contain a time as time-bound", () => {
    // "update" and "validate" hold "date", "holidays" holds "days".
    expect(isTimeBound("Update the holidays page for the support team")).toBe(false);
    expect(isTimeBound("Validate the candidate's details")).toBe(false);
    expect(isTimeBound("Shoppers may pay later with a saved card")).toBe(false);
    expect(isTimeBound("Search works within the app")).toBe(false);
    expect(isTimeBound("Show a tip after signing in")).toBe(false);
  });

  it("finds real deadlines", () => {
    for (const text of [
      "Ship it by end of sprint",
      "Ready by the end of the sprint",
      "Signed off by sprint end",
      "Demo it at the sprint review",
      "Done before the release",
      "Setup takes place within 3 minutes",
      "Answer within a day",
      "Live by Friday",
      "Merged by EOD",
      "Ready for Sprint 14",
      "Shipped in Q4",
      "Launch on 2026-11-02",
      "Release on 25/10",
      "Live by 3 May",
      "Live by November 15th",
      "Due on the release date",
      "Done this sprint",
      "Done by 2027",
    ]) {
      expect(isTimeBound(text), text).toBe(true);
    }
  });

  it("flags 'some' but not 'something', and catches inflected vague words", () => {
    expect(hasVagueWord("Fix some onboarding bugs")).toBe(true);
    expect(hasVagueWord("Ask someone from QA to sign off on something")).toBe(false);
    for (const w of ["improved", "improving", "enhanced", "optimized", "optimisation", "things"]) {
      expect(hasVagueWord(`Ship the ${w} checkout`), w).toBe(true);
    }
    expect(hasVagueWord("Goodwill credits for late orders")).toBe(false);
    expect(hasVagueWord("Finance team exports invoices")).toBe(false);
  });

  it("keeps the length rule for Achievable at its edges", () => {
    const len = (n: number) => smartCheck("x".repeat(n), false).achievable;
    expect([len(19), len(20), len(300), len(301)]).toEqual([false, true, true, false]);
    expect(smartCheck("y".repeat(5000), false).achievable).toBe(false);
    expect(smartCheck("   ", true)).toEqual({
      specific: false,
      measurable: false,
      achievable: false,
      relevant: true,
      timeBound: false,
    });
  });

  it("reads Relevant from the user's tick on a criterion", () => {
    const text = "Saved cards appear for 100% of shoppers by end of sprint";
    expect(validateSmart({ id: "c", text, relevantChecked: true })).toEqual({
      specific: true,
      measurable: true,
      achievable: true,
      relevant: true,
      timeBound: true,
    });
    expect(validateSmart({ id: "c", text, relevantChecked: false }).relevant).toBe(false);
  });

  it("checks the goal sentence: relevant through the objective or an OKR, time-bound by its sprint", () => {
    const goal = { goal: "Shoppers pay with a saved card in one tap", businessObjective: "" };
    expect(goalSmart(goal)).toMatchObject({ relevant: false, timeBound: false, measurable: true });
    expect(goalSmart({ ...goal, businessObjective: "Win back mobile shoppers" }).relevant).toBe(
      true
    );
    expect(goalSmart({ ...goal, okrIds: ["o1"] }).relevant).toBe(true);
    expect(goalSmart(goal, { id: "s1" }).timeBound).toBe(true);
    expect(goalSmart({ ...goal, goal: "Make checkout better" }).specific).toBe(false);
  });
});

// ─── The goal document ──────────────────────────────────────────────────────

describe("one goal document per sprint", () => {
  it("keys a sprint's goal by its id and keeps the draft's singleton id", () => {
    expect(goalDocId("s2")).toBe("sprint-goal:sprint:s2");
    expect(goalDocId()).toBe(DRAFT_GOAL_ID);
    expect(DRAFT_GOAL_ID).toBe("sprint-goal:current");
  });

  it("starts a sprint without a document from Sprint.goal, writing nothing", () => {
    const view = viewGoal([], sprint("s2", { goal: "Ship search filters" }));
    expect(view).toEqual({
      stored: false,
      doc: goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Ship search filters" }),
    });
    expect(viewGoal([], undefined).doc.id).toBe(DRAFT_GOAL_ID);
  });

  it("loads old stored shapes", () => {
    const legacy = {
      id: DRAFT_GOAL_ID,
      businessObjective: "Grow activation",
      goal: "Ship guided onboarding",
      criteria: [{ id: "criterion-1", text: "", relevantChecked: false }, null],
      keyResults: ["Activation 60%", 7],
    } as unknown as SprintGoal;
    const doc = normalizeGoal(legacy);
    expect(doc.criteria).toEqual([{ id: "criterion-1", text: "", relevantChecked: false }]);
    expect(doc.keyResults).toEqual(["Activation 60%", ""]);
    expect(doc.okrIds).toBeUndefined();
    // An agent's bare document (empty arrays, no okrIds) and a missing field.
    const bare = normalizeGoal({ id: "x", goal: "G" } as unknown as SprintGoal);
    expect(bare).toEqual(goalDoc("x", { goal: "G" }));
  });

  it("finds a disagreement with Sprint.goal, ignoring spacing, the draft and the example", () => {
    const s = sprint("s2", { goal: "Ship  search filters " });
    const stored = (goal: string, extra: Partial<SprintGoal> = {}) => ({
      stored: true,
      doc: goalDoc(goalDocId("s2"), { sprintId: "s2", goal, ...extra }),
    });
    expect(goalConflict(stored("Ship search filters"), s)).toBeNull();
    expect(goalConflict(stored("Ship saved searches"), s)).toEqual({
      onSprint: "Ship search filters",
      here: "Ship saved searches",
    });
    expect(goalConflict(stored("Ship saved searches"), undefined)).toBeNull();
    expect(goalConflict({ ...stored("x"), stored: false }, s)).toBeNull();
    expect(goalConflict(stored("x", { okrIds: [EXAMPLE_OKR_ID] }), s)).toBeNull();
  });

  it("mirrors only a changed goal, and a cleared goal clears the sprint's", () => {
    expect(sprintGoalPatch({ goal: "A goal" }, " A goal ")).toBeNull();
    expect(sprintGoalPatch({ goal: "A goal" }, "Another")).toEqual({ goal: "Another" });
    expect(sprintGoalPatch({ goal: "A goal" }, "  ")).toEqual({ goal: undefined });
    expect(sprintGoalPatch({}, "")).toBeNull();
  });

  it("offers the draft only when it holds the user's own goal", () => {
    expect(usableDraft([])).toBeNull();
    expect(usableDraft([goalDoc(DRAFT_GOAL_ID, { keyResults: [""] })])).toBeNull();
    expect(usableDraft([goalDoc(DRAFT_GOAL_ID, { ...buildExample() })])).toBeNull();
    expect(usableDraft([goalDoc(DRAFT_GOAL_ID, { goal: "Mine" })])?.goal).toBe("Mine");
  });

  it("clears the example, including one loaded before goals linked OKRs", () => {
    const old = goalDoc(DRAFT_GOAL_ID, {
      ...buildExample(),
      okrIds: [EXAMPLE_OKR_ID, "mine"],
      keyResults: [
        "30% of returning shoppers pay with a saved card in the first week",
        "My own key result",
      ],
    });
    expect(withoutExample(old)).toEqual(
      goalDoc(DRAFT_GOAL_ID, { okrIds: ["mine"], keyResults: ["My own key result"] })
    );
  });

  it("validates a new criterion instead of adding it blank", () => {
    expect(validateCriterion({ text: "  " })).toEqual({
      ok: false,
      errors: { text: "Write the criterion before adding it." },
    });
    expect(validateCriterion({ text: " 90% by Friday " })).toEqual({
      ok: true,
      values: { text: "90% by Friday" },
    });
  });
});

// ─── Verdict, OKR links and Markdown ────────────────────────────────────────

describe("results", () => {
  const criteria = [
    {
      id: "c1",
      text: "Reorder shows for 100% of past orders by end of sprint",
      relevantChecked: true,
    },
    { id: "c2", text: "Make it better", relevantChecked: false },
  ];

  it("says in one sentence how the goal and its criteria do", () => {
    expect(goalVerdict(goalDoc("x"), sprint("s2"))).toBe(
      "Sprint 2 has no goal yet: write the one outcome the team commits to."
    );
    expect(goalVerdict(goalDoc("x"))).toBe(
      "No goal yet: write the one outcome the team commits to."
    );
    const goal = goalDoc("x", { goal: "Shoppers reorder in one tap", businessObjective: "Grow" });
    expect(goalVerdict(goal, sprint("s2"))).toBe(
      "The goal meets all five SMART checks, but it has no acceptance criteria yet."
    );
    expect(goalVerdict({ ...goal, criteria }, sprint("s2"))).toBe(
      "The goal meets all five SMART checks, and 1 of 2 acceptance criteria does."
    );
    expect(goalVerdict({ ...goal, criteria: [criteria[1]] })).toBe(
      "The goal meets 4 of 5 SMART checks (missing Time-bound), but its acceptance criterion doesn't yet."
    );
    expect(goalVerdict({ ...goal, criteria: [criteria[0], criteria[0]] }, sprint("s2"))).toBe(
      "The goal meets all five SMART checks, and so do all 2 acceptance criteria."
    );
  });

  it("resolves linked OKRs and reports deleted ones", () => {
    const okrs = [okr("o1", "Grow"), okr("o2", "Retain")];
    expect(resolveLinkedOkrs(["o2", "gone", "o2"], okrs)).toEqual({
      linked: [okrs[1]],
      missing: ["gone"],
    });
    expect(resolveLinkedOkrs(undefined, okrs)).toEqual({ linked: [], missing: [] });
    expect(krProgressText({ id: "k", title: "t", current: 12, target: 30, unit: "%" })).toBe(
      "12% of 30%"
    );
    expect(
      krProgressText({ id: "k", title: "t", current: 40, target: 120, unit: "sign-ups" })
    ).toBe("40 of 120 sign-ups");
  });

  it("exports the sprint, the goal's SMART line, linked OKRs, notes and the verdict", () => {
    const md = toMarkdown(
      goalDoc("x", {
        goal: "Shoppers reorder in one tap",
        businessObjective: "Grow repeat orders",
        criteria,
        okrIds: ["o1", "gone"],
        keyResults: ["Old note", ""],
      }),
      new Date(2026, 9, 23),
      { sprint: sprint("s2"), okrs: [okr("o1", "Grow repeat orders")] }
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Sprint Goal — Sprint 2 · 23 Oct 2026");
    expect(lines).toContain("SMART: 5/5");
    expect(lines).toContain("## Linked OKRs");
    expect(lines).toContain("- **Grow repeat orders** (Q4 2026, 50% of the way)");
    expect(lines).toContain("  - Weekly active teams: 40 of 80");
    expect(lines).toContain("## Key-result notes");
    expect(lines).toContain("- Old note");
    expect(md).not.toContain("gone");
    expect(lines.at(-2)).toBe(
      "**The goal meets all five SMART checks, and 1 of 2 acceptance criteria does.**"
    );
  });

  it("counts a goal with only a linked OKR as something to export", () => {
    const md = toMarkdown(goalDoc("x", { okrIds: ["o1"] }), new Date(2026, 9, 23), {
      okrs: [okr("o1", "Grow")],
    });
    expect(md).toContain("## Linked OKRs");
    expect(md).not.toContain("No sprint goal yet.");
  });
});

// ─── The tool ───────────────────────────────────────────────────────────────

describe("Sprint Goal on the shared sprint", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      sprints: [
        sprint("s1", { status: "completed", startDate: "2026-09-28", endDate: "2026-10-09" }),
        sprint("s2", { status: "active", goal: "Ship search filters" }),
      ],
    });
  });

  it("opens on the active sprint and starts from the goal Sprint Planning wrote", () => {
    renderGoal();
    openStep("Sprint Goal");
    expect(screen.getByLabelText("Sprint goal")).toHaveValue("Ship search filters");
    expect(docs()).toEqual([]);

    // The first edit stores the sprint's own document, goal included.
    openStep("Business Objective");
    commit("Business objective", "Help shoppers find things faster");
    expect(docById("sprint-goal:sprint:s2")).toMatchObject({
      sprintId: "s2",
      goal: "Ship search filters",
      businessObjective: "Help shoppers find things faster",
    });
    expect(docById(DRAFT_GOAL_ID)).toBeUndefined();
  });

  it("mirrors a saved goal statement onto the sprint", () => {
    renderGoal();
    openStep("Sprint Goal");
    commit("Sprint goal", "Shoppers filter search results by size in one tap");
    expect(sprintById("s2").goal).toBe("Shoppers filter search results by size in one tap");
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe(
      "Shoppers filter search results by size in one tap"
    );
    // The SMART checks run on the goal sentence too.
    expect(screen.getByText("Measurable").textContent).toContain("(met)");
  });

  it("keeps each sprint's goal apart", () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s1", { sprintId: "s1", goal: "Old sprint's goal" }),
      ],
    });
    window.localStorage.setItem(SELECTED_SPRINT_KEY, "s1");
    renderGoal();
    openStep("Sprint Goal");
    expect(screen.getByLabelText("Sprint goal")).toHaveValue("Old sprint's goal");
  });

  it("shows both goals when they disagree and lets the user pick, with Undo", () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Ship saved searches" }),
      ],
    });
    renderGoal();
    // Visible from the first step, not only the goal step.
    const banner = screen.getByText("Sprint 2's goal doesn't match this one.").parentElement!;
    expect(within(banner).getByText("Ship search filters")).toBeInTheDocument();
    expect(within(banner).getByText("Ship saved searches")).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole("button", { name: "Use the sprint's goal here" }));
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Ship search filters");
    expect(screen.queryByText("Sprint 2's goal doesn't match this one.")).toBeNull();
    undoLast();
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Ship saved searches");

    fireEvent.click(screen.getByRole("button", { name: "Set this goal on Sprint 2" }));
    expect(sprintById("s2").goal).toBe("Ship saved searches");
    undoLast();
    expect(sprintById("s2").goal).toBe("Ship search filters");
  });

  it("offers a goal written here to a sprint that has none", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Mine" })],
    });
    renderGoal();
    expect(
      screen.getByText(
        "Sprint 2 has no goal yet, so Sprint Planning and the cockpit don't show this one."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use the sprint's goal here" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set this goal on Sprint 2" }));
    expect(sprintById("s2").goal).toBe("Mine");
  });

  it("points at Sprint Planning and the cockpit once the sprint has its goal", () => {
    useWorkspaceStore.setState({
      stories: [
        { id: "st1", title: "Size filter", sprintId: "s2" } as never,
        { id: "st2", title: "Colour filter", sprintId: "s1" } as never,
      ],
    });
    renderGoal();
    const next = screen.getByRole("complementary", { name: "Plan Sprint 2 around this goal" });
    expect(within(next).getByText(/1 story is planned into Sprint 2/)).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: /Sprint Planning/ })).toHaveAttribute(
      "href",
      "/sprint-planning?sprint=s2"
    );
    expect(within(next).getByRole("link", { name: /Sprint Cockpit/ })).toHaveAttribute(
      "href",
      "/sprint?sprint=s2"
    );
  });

  it("shows a one-sentence verdict", () => {
    renderGoal();
    expect(
      screen.getByText(
        "The goal meets 2 of 5 SMART checks (missing Measurable, Achievable and Relevant), but it has no acceptance criteria yet."
      )
    ).toBeInTheDocument();
  });
});

describe("Sprint Goal draft", () => {
  const legacyDraft = goalDoc(DRAFT_GOAL_ID, {
    businessObjective: "Grow activation",
    goal: "Ship guided onboarding",
    criteria: [{ id: "c1", text: "Tour covers 5 steps", relevantChecked: false }],
    keyResults: ["Activation 60%"],
  });

  it("is the goal while there are no sprints", () => {
    useWorkspaceStore.setState({ sprintGoals: [legacyDraft] });
    renderGoal();
    expect(screen.getByText(/This goal isn't tied to a sprint yet/)).toBeInTheDocument();
    openStep("Sprint Goal");
    commit("Sprint goal", "Ship guided onboarding to everyone");
    expect(docById(DRAFT_GOAL_ID)?.goal).toBe("Ship guided onboarding to everyone");
  });

  it("is offered to a sprint without a goal, and Undo puts it back", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [legacyDraft],
    });
    renderGoal();
    expect(screen.getByText("Ship guided onboarding")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));

    expect(docById(DRAFT_GOAL_ID)).toBeUndefined();
    expect(docById("sprint-goal:sprint:s2")).toMatchObject({
      sprintId: "s2",
      goal: "Ship guided onboarding",
      keyResults: ["Activation 60%"],
    });
    expect(sprintById("s2").goal).toBe("Ship guided onboarding");

    undoLast();
    expect(docById(DRAFT_GOAL_ID)).toEqual(legacyDraft);
    expect(docById("sprint-goal:sprint:s2")).toBeUndefined();
    expect(sprintById("s2").goal).toBeUndefined();
  });

  it("doesn't overwrite a goal set in Sprint Planning when moved", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active", goal: "Planning's goal" })],
      sprintGoals: [legacyDraft],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    expect(sprintById("s2").goal).toBe("Planning's goal");
    expect(screen.getByText("Sprint 2's goal doesn't match this one.")).toBeInTheDocument();
  });

  it("can be opened next to a sprint's own goal, and replaces it only after a confirm", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active", goal: "Sprint goal" })],
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Sprint goal" }),
        legacyDraft,
      ],
    });
    renderGoal();
    expect(screen.queryByRole("button", { name: "Use it for Sprint 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
    openStep("Sprint Goal");
    expect(screen.getByLabelText("Sprint goal")).toHaveValue("Ship guided onboarding");

    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    const dialog = screen.getByRole("dialog", { name: "Replace Sprint 2's goal with the draft?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace goal" }));

    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Ship guided onboarding");
    // The sprint's goal was in step with this tool, so it follows.
    expect(sprintById("s2").goal).toBe("Ship guided onboarding");
    expect(docById(DRAFT_GOAL_ID)).toBeUndefined();
    expect(screen.getByLabelText("Sprint goal")).toHaveValue("Ship guided onboarding");
  });

  it("fills a sprint whose goal document is empty without asking", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [goalDoc("sprint-goal:sprint:s2", { sprintId: "s2" }), legacyDraft],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Ship guided onboarding");
    undoLast();
    expect(docById("sprint-goal:sprint:s2")).toEqual(
      goalDoc("sprint-goal:sprint:s2", { sprintId: "s2" })
    );
  });

  it("can be discarded with Undo", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "G" }), legacyDraft],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(docById(DRAFT_GOAL_ID)).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Open draft" })).toBeNull();
    undoLast();
    expect(docById(DRAFT_GOAL_ID)).toEqual(legacyDraft);
  });
});

describe("Sprint Goal example", () => {
  it("never writes onto the sprint or into the OKRs, and clears back to nothing", () => {
    useWorkspaceStore.setState({ sprints: [sprint("s2", { status: "active" })] });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe(buildExample().goal);
    expect(sprintById("s2").goal).toBeUndefined();
    expect(useWorkspaceStore.getState().okrs).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();

    // Its OKR shows read-only in the Key Results step.
    openStep("Key Results");
    const list = screen.getByRole("list", { name: "OKRs to link" });
    expect(within(list).getByText(buildExampleOkr().objective)).toBeInTheDocument();
    expect(within(list).getByRole("checkbox")).toBeChecked();
    expect(exported.markdown).toContain("## Linked OKRs");

    // Editing the example's goal still doesn't touch the sprint.
    openStep("Sprint Goal");
    commit("Sprint goal", "Edited example goal");
    expect(sprintById("s2").goal).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(docById("sprint-goal:sprint:s2")).toMatchObject({
      goal: "Edited example goal",
      criteria: [],
      okrIds: [],
    });
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });
});

describe("Sprint Goal criteria and key results", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", {
          sprintId: "s2",
          goal: "Ship guided onboarding",
          keyResults: ["Activation 60%", "NPS 40"],
        }),
      ],
      okrs: [okr("o1", "Grow activation"), okr("o2", "Cut churn")],
    });
  });

  it("adds a criterion only once it has text, by Enter or the button", () => {
    renderGoal();
    openStep("Acceptance Criteria");
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getByText("Write the criterion before adding it.")).toBeInTheDocument();
    expect(docById("sprint-goal:sprint:s2")?.criteria).toEqual([]);

    const field = screen.getByLabelText("First acceptance criterion");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "90% finish the tour by sprint end" } });
    fireEvent.submit(field.closest("form")!);
    expect(docById("sprint-goal:sprint:s2")?.criteria).toEqual([
      expect.objectContaining({
        text: "90% finish the tour by sprint end",
        relevantChecked: false,
      }),
    ]);
    expect(screen.getByLabelText("Another acceptance criterion")).toHaveValue("");

    // Relevance is the user's tick, never a default.
    fireEvent.click(screen.getByRole("checkbox", { name: "Criterion 1 serves the sprint goal" }));
    expect(docById("sprint-goal:sprint:s2")?.criteria[0].relevantChecked).toBe(true);
  });

  it("deletes the last criterion too, with Undo", () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", {
          sprintId: "s2",
          criteria: [{ id: "c1", text: "Only one", relevantChecked: true }],
        }),
      ],
    });
    renderGoal();
    openStep("Acceptance Criteria");
    fireEvent.click(screen.getByRole("button", { name: "Remove acceptance criterion 1" }));
    expect(docById("sprint-goal:sprint:s2")?.criteria).toEqual([]);
    undoLast();
    expect(docById("sprint-goal:sprint:s2")?.criteria).toEqual([
      { id: "c1", text: "Only one", relevantChecked: true },
    ]);
  });

  it("links workspace OKRs instead of copying key results", () => {
    renderGoal();
    openStep("Key Results");
    fireEvent.click(screen.getByRole("checkbox", { name: /Cut churn/ }));
    expect(docById("sprint-goal:sprint:s2")?.okrIds).toEqual(["o2"]);
    // A linked OKR shows its key results as they are in the OKRs tool.
    expect(screen.getByText("Weekly active teams")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Cut churn/ }));
    expect(docById("sprint-goal:sprint:s2")?.okrIds).toEqual([]);
  });

  it("keeps old key results as editable notes, deletable with Undo", () => {
    renderGoal();
    openStep("Key Results");
    expect(screen.getByRole("heading", { name: "Key-result notes" })).toBeInTheDocument();
    commit("Key-result note 2", "NPS 45");
    expect(docById("sprint-goal:sprint:s2")?.keyResults).toEqual(["Activation 60%", "NPS 45"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove key-result note 1" }));
    expect(docById("sprint-goal:sprint:s2")?.keyResults).toEqual(["NPS 45"]);
    expect(toastSpy.mock.calls.at(-1)![0]).toBe("Deleted “Activation 60%”");
    undoLast();
    expect(docById("sprint-goal:sprint:s2")?.keyResults).toEqual(["Activation 60%", "NPS 45"]);
  });

  it("offers to unlink OKRs that were deleted", () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "G", okrIds: ["o1", "gone"] }),
      ],
    });
    renderGoal();
    openStep("Key Results");
    expect(screen.getByText("One linked OKR no longer exists.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unlink it/ }));
    expect(docById("sprint-goal:sprint:s2")?.okrIds).toEqual(["o1"]);
  });

  it("points at the OKRs tool when there are none", () => {
    useWorkspaceStore.setState({ okrs: [] });
    renderGoal();
    openStep("Key Results");
    expect(screen.getByText(/No OKRs yet\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set OKRs" })).toHaveAttribute("href", "/okrs");
  });
});

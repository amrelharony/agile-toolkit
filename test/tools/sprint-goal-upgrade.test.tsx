import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const exported = vi.hoisted(() => ({
  markdown: undefined as string | undefined,
  targetRef: undefined as unknown,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, targetRef }: { markdown?: string; targetRef?: unknown }) => {
    exported.markdown = markdown;
    exported.targetRef = targetRef;
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
  draftHome,
  goalConflict,
  goalDocId,
  isExampleGoal,
  normalizeGoal,
  sprintGoalPatch,
  sprintHasOwnGoal,
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
import {
  krProgressText,
  okrMeasuredPercent,
  okrProgressLabel,
  resolveLinkedOkrs,
} from "@/app/(tools)/sprint-goal/okr-links";
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
  exported.targetRef = undefined;
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

  it("keeps decimals, fractions, '24/7' and counts as quantities", () => {
    // A bare d.d or d/d is a date only after a word like "by" or with its
    // year; "of 2000" and "Release 2 features" are counts, not a year or a
    // release name.
    for (const text of [
      "Page load time under 2.5 seconds by end of sprint",
      "Error budget burn stays below 0.5 per day",
      "App store rating reaches 4.5 stars",
      "Onboard a cohort of 2000 users",
      "Roll out in 2000 stores",
      "Release 2 features to beta testers",
      "3/4 of new users finish onboarding",
      "Provide 24/7 monitoring for checkout",
    ]) {
      expect(isMeasurable(text), text).toBe(true);
    }
    expect(isTimeBound("3/4 of new users finish onboarding")).toBe(false);
    expect(isTimeBound("Provide 24/7 monitoring for checkout")).toBe(false);
    expect(isTimeBound("Roll out in 2000 stores")).toBe(false);
  });

  it("still takes dates, years and names with digits for what they are", () => {
    expect(isMeasurable("Launch on 25.10.2026")).toBe(false);
    expect(isMeasurable("Release on 25/10/26")).toBe(false);
    expect(isMeasurable("Ship it in Release 3")).toBe(false);
    expect(isMeasurable("Upgrade checkout to version 2.1")).toBe(false);
    // Digits inside a name aren't a count.
    expect(isMeasurable("Everyone can log in with OAuth2")).toBe(false);
    expect(isMeasurable("Ship v2 of search to the B2B portal")).toBe(false);
    expect(isTimeBound("Launch on 25.10.2026")).toBe(true);
    expect(isTimeBound("Release on 25/10/26")).toBe(true);
  });

  it("doesn't take quantity words in another sense for a quantity", () => {
    expect(isMeasurable("Users can rate stories")).toBe(false);
    expect(isMeasurable("We can count on QA for the sign-off")).toBe(false);
    expect(isMeasurable("Support double-click to open a card")).toBe(false);
    // The noun and the verb that sets a target still count.
    expect(isMeasurable("Raise the conversion rate on checkout")).toBe(true);
    expect(isMeasurable("Aim to double sign-ups from the landing page")).toBe(true);
  });

  it("needs a point in time after 'due', 'before' and 'until'", () => {
    expect(isTimeBound("Fix crashes due to memory leaks")).toBe(false);
    expect(isTimeBound("Errors due to timeouts drop to zero")).toBe(false);
    expect(isTimeBound("Users see a price preview before they pay")).toBe(false);
    expect(isTimeBound("Banner stays until further notice")).toBe(false);
    for (const text of [
      "Due Friday",
      "Due 3 May",
      "Due by the review",
      "Ready before 5pm",
      "Ready before launch",
      "Hold the freeze until the end of the sprint",
      "Answer within 1.5 days",
    ]) {
      expect(isTimeBound(text), text).toBe(true);
    }
  });

  it("flags 'some' but not 'something', and catches inflected vague words", () => {
    // A hyphenated compound is one word: "fine-grained" isn't "fine".
    expect(hasVagueWord("Ship the fine-grained permissions screen")).toBe(false);
    expect(hasVagueWord("Make the sign-up flow better")).toBe(true);
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

  it("starts from Sprint.goal while the stored goal statement is blank, without a conflict", () => {
    // The objective was written first; then the goal was set in Planning.
    const s = sprint("s2", { goal: "Ship search filters" });
    const stored = goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", businessObjective: "Grow" });
    const view = viewGoal([stored], s);
    expect(view.doc).toMatchObject({ goal: "Ship search filters", businessObjective: "Grow" });
    expect(view.stored).toBe(true);
    expect(goalConflict(view, s)).toBeNull();
    // A goal of its own still wins, and the draft never borrows a sprint's.
    const own = goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Mine" });
    expect(viewGoal([own], s).doc.goal).toBe("Mine");
    expect(viewGoal([goalDoc(DRAFT_GOAL_ID)], undefined).doc.goal).toBe("");
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
    // An old example the user rewrote, without pressing "Clear example".
    const rewritten = goalDoc(DRAFT_GOAL_ID, { ...buildExample(), goal: "Mine" });
    expect(usableDraft([rewritten])?.criteria).toHaveLength(4);
  });

  it("treats the example's own text as the example, so its notice stays", () => {
    const ex = buildExample();
    expect(isExampleGoal(goalDoc("x", { goal: ex.goal }))).toBe(true);
    expect(isExampleGoal(goalDoc("x", { businessObjective: ex.businessObjective }))).toBe(true);
    expect(isExampleGoal(goalDoc("x", { goal: "Mine" }))).toBe(false);
  });

  it("finds the sprint a legacy draft was already copied to", () => {
    const sprints = [sprint("s2"), sprint("s1", { goal: " Ship guided  onboarding" })];
    expect(draftHome(goalDoc(DRAFT_GOAL_ID, { goal: "Ship guided onboarding" }), sprints)?.id).toBe(
      "s1"
    );
    expect(draftHome(goalDoc(DRAFT_GOAL_ID, { goal: "Other" }), sprints)).toBeUndefined();
    expect(
      draftHome(goalDoc(DRAFT_GOAL_ID, { businessObjective: "Only" }), sprints)
    ).toBeUndefined();
    expect(draftHome(null, sprints)).toBeUndefined();
  });

  it("counts a goal only on the sprint as the sprint's own", () => {
    const draft = goalDoc(DRAFT_GOAL_ID, { goal: "Draft goal" });
    expect(sprintHasOwnGoal([], sprint("s2", { goal: "Planning's goal" }), draft)).toBe(true);
    // The same goal as the draft's (the old tool copied it) isn't replaced.
    expect(sprintHasOwnGoal([], sprint("s2", { goal: "Draft goal" }), draft)).toBe(false);
    expect(sprintHasOwnGoal([], sprint("s2"), draft)).toBe(false);
    // An empty document left by "Clear example" doesn't count either.
    const empty = goalDoc(goalDocId("s2"), { sprintId: "s2" });
    expect(sprintHasOwnGoal([empty], sprint("s2"), draft)).toBe(false);
    const full = goalDoc(goalDocId("s2"), { sprintId: "s2", businessObjective: "Grow" });
    expect(sprintHasOwnGoal([full], sprint("s2"), draft)).toBe(true);
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
      "The goal meets all five SMART checks, and 1 of 2 acceptance criteria passes every check."
    );
    expect(goalVerdict({ ...goal, criteria: [criteria[1]] })).toBe(
      "The goal meets 4 of 5 SMART checks (missing Time-bound), but its acceptance criterion doesn't pass every check yet."
    );
    expect(goalVerdict({ ...goal, criteria: [criteria[0], criteria[0]] }, sprint("s2"))).toBe(
      "The goal meets all five SMART checks, and both acceptance criteria pass every check."
    );
    expect(goalVerdict({ ...goal, criteria: [criteria[1], criteria[1], criteria[1]] })).toBe(
      "The goal meets 4 of 5 SMART checks (missing Time-bound), but none of its 3 acceptance criteria passes every check yet."
    );
  });

  it("names the criteria's own bar when the goal misses checks but they pass", () => {
    // The criteria pass all five checks; the goal only three.
    const partial = goalDoc("x", { goal: "Ship the checkout page", criteria: [criteria[0]] });
    expect(goalVerdict(partial, sprint("s2"))).toBe(
      "The goal meets 3 of 5 SMART checks (missing Measurable and Relevant), and its acceptance criterion passes every check."
    );
    const three = { ...partial, criteria: [criteria[0], criteria[0], criteria[0]] };
    expect(goalVerdict(three, sprint("s2"))).toBe(
      "The goal meets 3 of 5 SMART checks (missing Measurable and Relevant), and all 3 acceptance criteria pass every check."
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
    // The old intent's "Q4 2026" reads as the OKR page's "2026 Q4", as the step shows it.
    expect(lines).toContain("- **Grow repeat orders** (2026 Q4, 50% of the way)");
    expect(lines).toContain("  - Weekly active teams: 40 of 80");
    expect(lines).toContain("## Key-result notes");
    expect(lines).toContain("- Old note");
    expect(md).not.toContain("gone");
    expect(lines.at(-2)).toBe(
      "**The goal meets all five SMART checks, and 1 of 2 acceptance criteria passes every check.**"
    );
  });

  it("reads a linked objective with no key result as not measured yet, never 0%", () => {
    const empty = okr("o1", "Win back churned teams", { keyResults: [] });
    const md = toMarkdown(goalDoc("x", { okrIds: ["o1"] }), new Date(2026, 9, 23), {
      okrs: [empty],
    });
    expect(md.split("\n")).toContain("- **Win back churned teams** (2026 Q4, not measured yet)");
    expect(md).not.toContain("0% of the way");
    expect(okrMeasuredPercent(empty)).toBeNull();
    expect(okrProgressLabel(empty)).toBe("not measured yet");
    expect(okrMeasuredPercent(okr("o2", "Grow"))).toBe(50);
    expect(okrProgressLabel(okr("o2", "Grow"))).toBe("50% of the way");
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
    // The SMART checks run on the goal sentence too, and each badge says
    // how to pass in its accessible text, not only in a hover title.
    expect(screen.getByText("Measurable").textContent).toBe(
      "Measurable (met: Contains a number or a quantity)"
    );
    expect(screen.getByText("Relevant").textContent).toBe(
      "Relevant (not met: Write the business objective or link an OKR)"
    );
  });

  it("shows the goal Planning wrote over a stored blank one, and says so everywhere", () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", businessObjective: "Grow" }),
      ],
    });
    renderGoal();
    expect(screen.queryByText(/already has a goal|doesn't match/)).toBeNull();
    expect(screen.queryByText(/has no goal yet/)).toBeNull();
    expect(screen.getByText("Ship search filters")).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Plan Sprint 2 around this goal" })
    ).toBeInTheDocument();
    // The next edit stores it.
    openStep("Business Objective");
    commit("Business objective", "Grow repeat searches");
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Ship search filters");
  });

  it("cuts an over-long sprint goal on both sides when it's taken, with Undo", () => {
    const long = `Ship search filters ${"and more ".repeat(40)}`.trim();
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active", goal: long })],
      sprintGoals: [goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Mine" })],
    });
    renderGoal();
    expect(screen.getByText(/over 300 characters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the sprint's goal here" }));
    const cut = docById("sprint-goal:sprint:s2")!.goal;
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(long.startsWith(cut)).toBe(true);
    expect(sprintById("s2").goal).toBe(cut);
    expect(toastSpy.mock.calls.at(-1)![0]).toBe("Using Sprint 2's goal, cut to 300 characters");
    expect(screen.queryByText("Sprint 2's goal doesn't match this one.")).toBeNull();
    undoLast();
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Mine");
    expect(sprintById("s2").goal).toBe(long);
  });

  it("puts focus on the verdict after a banner action removes its button", async () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "Ship saved searches" }),
      ],
    });
    renderGoal();
    const button = screen.getByRole("button", { name: "Use the sprint's goal here" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/^The goal meets/)).toHaveFocus());
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

  it("asks before replacing a goal set only in Sprint Planning, and keeps it on the sprint", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active", goal: "Planning's goal" })],
      sprintGoals: [legacyDraft],
    });
    renderGoal();
    // The sprint's goal counts as its own, though it has no goal document.
    expect(screen.getByText(/There's also a draft/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use it for Sprint 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    const dialog = screen.getByRole("dialog", { name: "Replace Sprint 2's goal with the draft?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace goal" }));
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe("Ship guided onboarding");
    expect(sprintById("s2").goal).toBe("Planning's goal");
    expect(screen.getByText("Sprint 2's goal doesn't match this one.")).toBeInTheDocument();
  });

  it("goes back to the sprint the old tool copied its goal to", async () => {
    // Before goals were per sprint, "Use as the goal of" set Sprint 1's goal.
    useWorkspaceStore.setState({
      sprints: [
        sprint("s1", {
          status: "completed",
          startDate: "2026-09-28",
          endDate: "2026-10-09",
          goal: "Ship guided onboarding",
        }),
        sprint("s2", { status: "active" }),
      ],
      sprintGoals: [legacyDraft],
    });
    renderGoal();
    expect(
      screen.getByText(/Sprint 1's goal came from a draft that isn't tied to a sprint yet/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use it for Sprint 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 1" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(docById("sprint-goal:sprint:s1")).toMatchObject({
      sprintId: "s1",
      businessObjective: "Grow activation",
    });
    expect(docById("sprint-goal:sprint:s2")).toBeUndefined();
    expect(sprintById("s2").goal).toBeUndefined();
    // The tool follows the goal to Sprint 1.
    openStep("Business Objective");
    expect(screen.getByLabelText("Business objective")).toHaveValue("Grow activation");
    undoLast();
    expect(docById(DRAFT_GOAL_ID)).toEqual(legacyDraft);
    expect(docById("sprint-goal:sprint:s1")).toBeUndefined();
    expect(sprintById("s1").goal).toBe("Ship guided onboarding");
  });

  it("is offered with the example still in it, which stays behind its notice", () => {
    const rewritten = goalDoc(DRAFT_GOAL_ID, {
      ...buildExample(),
      businessObjective: "Grow activation",
      goal: "Ship guided onboarding",
    });
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [rewritten],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    expect(docById("sprint-goal:sprint:s2")?.criteria).toHaveLength(4);
    // The user's own goal reaches the sprint; the example's parts don't.
    expect(sprintById("s2").goal).toBe("Ship guided onboarding");
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
  });

  it("never puts the example's goal on the sprint when moving a draft", () => {
    const halfway = goalDoc(DRAFT_GOAL_ID, { ...buildExample(), businessObjective: "Mine" });
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [halfway],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Use it for Sprint 2" }));
    expect(docById("sprint-goal:sprint:s2")?.goal).toBe(buildExample().goal);
    expect(sprintById("s2").goal).toBeUndefined();
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

  it("is discarded only after a confirm, with Undo", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s2", { status: "active" })],
      sprintGoals: [goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "G" }), legacyDraft],
    });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    const dialog = screen.getByRole("dialog", { name: "Discard the draft goal?" });
    expect(
      within(dialog).getByText(
        "The draft's goal statement, objective, 1 acceptance criterion and 1 key-result note are deleted. You can undo this right after."
      )
    ).toBeInTheDocument();
    // Cancel keeps it.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(docById(DRAFT_GOAL_ID)).toEqual(legacyDraft);

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Discard draft" })
    );
    expect(docById(DRAFT_GOAL_ID)).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Open draft" })).toBeNull();
    await waitFor(() => expect(screen.getByText(/^The goal meets/)).toHaveFocus());
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

  it("keeps its OKR listed when unticked, and its notice while any of it is left", () => {
    useWorkspaceStore.setState({ sprints: [sprint("s2", { status: "active" })] });
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    openStep("Key Results");
    const box = () =>
      within(screen.getByRole("list", { name: "OKRs to link" })).getByRole("checkbox");
    fireEvent.click(box());
    expect(box()).not.toBeChecked();
    expect(docById("sprint-goal:sprint:s2")?.okrIds).toEqual([]);
    fireEvent.click(box());
    expect(box()).toBeChecked();

    // With the criteria and the link gone, its objective and goal text are
    // still the example's: the notice stays and nothing reaches the sprint.
    act(() =>
      useWorkspaceStore.getState().upsertSprintGoal({
        ...docById("sprint-goal:sprint:s2")!,
        criteria: [],
        okrIds: [],
      })
    );
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.queryByText(/doesn't show this one/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText(/Example data\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("offers a PNG of the preview only once there is one", () => {
    renderGoal();
    expect(exported.targetRef).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(exported.targetRef).toEqual({ current: expect.any(HTMLDivElement) });
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

  it("keeps keyboard focus in the list when a criterion is deleted", async () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", {
          sprintId: "s2",
          criteria: [
            { id: "c1", text: "First", relevantChecked: true },
            { id: "c2", text: "Second", relevantChecked: true },
          ],
        }),
      ],
    });
    renderGoal();
    openStep("Acceptance Criteria");
    fireEvent.click(screen.getByRole("button", { name: "Remove acceptance criterion 1" }));
    // The next criterion's button took its place.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove acceptance criterion 1" })).toHaveFocus()
    );
    expect(screen.getByLabelText("Acceptance criterion 1")).toHaveValue("Second");
    fireEvent.click(screen.getByRole("button", { name: "Remove acceptance criterion 1" }));
    await waitFor(() => expect(screen.getByLabelText("First acceptance criterion")).toHaveFocus());
  });

  it("keeps keyboard focus in the step when a note is deleted", async () => {
    renderGoal();
    openStep("Key Results");
    fireEvent.click(screen.getByRole("button", { name: "Remove key-result note 2" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove key-result note 1" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove key-result note 1" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Grow activation/ })).toHaveFocus()
    );
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

  it("shows a linked objective with no key result as not measured yet, in the step and the summary", () => {
    useWorkspaceStore.setState({
      okrs: [okr("o1", "Grow activation", { keyResults: [] }), okr("o2", "Cut churn")],
      sprintGoals: [
        goalDoc("sprint-goal:sprint:s2", { sprintId: "s2", goal: "G", okrIds: ["o1"] }),
      ],
    });
    renderGoal();
    openStep("Key Results");
    const list = screen.getByRole("list", { name: "OKRs to link" });
    expect(within(list).getByText("2026 Q4 · not measured yet")).toBeInTheDocument();
    expect(within(list).getByText("2026 Q4 · 50% of the way")).toBeInTheDocument();
    expect(screen.getByText("(not measured yet)")).toBeInTheDocument();
    expect(screen.queryByText(/\b0% of the way/)).toBeNull();
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

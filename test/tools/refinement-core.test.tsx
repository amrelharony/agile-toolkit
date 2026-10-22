import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { todayLocalISO } from "@/lib/utils/formatters";
import { REFINEMENT_ACTIONS } from "@/lib/history/event-actions";

/**
 * Refinement (Definition of Ready) gap-filling: the store's save maths and
 * edits, the per-story checklist and readiness badge, criterion editing,
 * the history table and the drift / trend signals. (Clearing the history
 * with Undo is covered by refinement-fixes.test.tsx.)
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof spies.csv }) => {
    spies.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { RefinementClient } from "@/app/(tools)/refinement/refinement-client";
import {
  DEFAULT_CRITERIA,
  useRefinementStore,
  type StorySave,
} from "@/app/(tools)/refinement/store";

const st = () => useRefinementStore.getState();

function save(id: string, storyName: string, metCount: number, totalCriteria = 8): StorySave {
  return {
    id,
    storyName,
    date: "2026-10-10",
    checks: [],
    totalCriteria,
    metCount,
    passRate: Math.round((metCount / totalCriteria) * 100),
  };
}

/** The Check Story card (its checkboxes, progress and Save button). */
const checkCard = () => screen.getByText("Check Story").closest(".rounded-xl") as HTMLElement;
const checkbox = (label: string) => screen.getByRole("checkbox", { name: label });

beforeEach(() => {
  spies.log.mockClear();
  spies.csv = undefined;
  localStorage.clear();
  useRefinementStore.setState({
    criteria: DEFAULT_CRITERIA,
    storyName: "",
    storyDescription: "",
    currentChecks: {},
    history: [],
  });
});

describe("refinement store", () => {
  it("saves a named story with its pass rate, newest first, and clears the check", () => {
    st().setStoryName("  USER-42 Dark mode  ");
    st().setStoryDescription("   ");
    for (const id of ["d1", "d2", "d3"]) st().toggleCheck(id);
    st().saveStory();

    const [first] = st().history;
    expect(first).toMatchObject({
      storyName: "USER-42 Dark mode",
      description: undefined,
      date: todayLocalISO(),
      totalCriteria: 8,
      metCount: 3,
      passRate: 38,
    });
    expect(first.checks).toHaveLength(8);
    expect(first.checks.filter((c) => c.checked).map((c) => c.criterionId)).toEqual([
      "d1",
      "d2",
      "d3",
    ]);
    expect(st()).toMatchObject({ storyName: "", storyDescription: "", currentChecks: {} });

    st().setStoryName("USER-43");
    st().setStoryDescription(" Needs API ");
    st().saveStory();
    expect(st().history.map((h) => h.storyName)).toEqual(["USER-43", "USER-42 Dark mode"]);
    expect(st().history[0]).toMatchObject({ description: "Needs API", passRate: 0 });
  });

  it("refuses to save a story without a name", () => {
    st().setStoryName("   ");
    st().toggleCheck("d1");
    st().saveStory();
    expect(st().history).toEqual([]);
    expect(st().currentChecks).toEqual({ d1: true });
  });

  it("saves 0% rather than NaN with no criteria", () => {
    useRefinementStore.setState({ criteria: [] });
    st().setStoryName("Spike");
    st().saveStory();
    expect(st().history[0]).toMatchObject({ totalCriteria: 0, metCount: 0, passRate: 0 });
  });

  it("ignores checks for removed criteria and counts only the current list", () => {
    st().toggleCheck("d1");
    st().toggleCheck("d2");
    st().toggleCheck("d2");
    expect(st().currentChecks).toEqual({ d1: true, d2: false });
    st().removeCriterion("d1");
    expect(st().currentChecks).toEqual({ d2: false });
    expect(st().criteria).toHaveLength(7);
  });

  it("edits, describes, adds and resets criteria", () => {
    st().setCriterion("d2", "AC agreed with PO");
    st().setCriterionDescription("d2", "  Given / When / Then  ");
    expect(st().criteria[1]).toMatchObject({
      label: "AC agreed with PO",
      description: "Given / When / Then",
    });
    st().setCriterionDescription("d2", "   ");
    expect(st().criteria[1].description).toBeUndefined();

    st().addCriterion();
    expect(st().criteria).toHaveLength(9);
    expect(st().criteria[8].label).toBe("New criterion");

    useRefinementStore.setState({ history: [save("h1", "Old", 4)] });
    st().setStoryName("Draft");
    st().resetCurrent();
    expect(st().storyName).toBe("");
    expect(st().history).toHaveLength(1);
    st().removeHistory("h1");
    expect(st().history).toEqual([]);

    st().reset();
    expect(st().criteria).toEqual(DEFAULT_CRITERIA);
  });
});

describe("Refinement checklist", () => {
  it("counts met criteria into a percentage and a readiness badge", () => {
    render(<RefinementClient />);
    const card = checkCard();
    expect(within(card).getByText("Not Ready")).toBeInTheDocument();
    expect(within(card).getByText("0 / 8 criteria met")).toBeInTheDocument();
    expect(within(card).getByText("0%")).toBeInTheDocument();

    for (const c of DEFAULT_CRITERIA.slice(0, 4)) fireEvent.click(checkbox(c.label));
    expect(checkbox(DEFAULT_CRITERIA[0].label)).toHaveAttribute("aria-checked", "true");
    expect(within(card).getByText("4 / 8 criteria met")).toBeInTheDocument();
    expect(within(card).getByText("50%")).toBeInTheDocument();
    expect(within(card).getByText("Partial")).toBeInTheDocument();

    for (const c of DEFAULT_CRITERIA.slice(4)) fireEvent.click(checkbox(c.label));
    expect(within(card).getByText("100%")).toBeInTheDocument();
    expect(within(card).getByText("Ready")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Clear" }));
    expect(within(card).getByText("0 / 8 criteria met")).toBeInTheDocument();
  });

  it("enables Save once the story is named, then adds it to the history table", () => {
    render(<RefinementClient />);
    const saveBtn = screen.getByRole("button", { name: "Save to History" });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText(/No stories saved yet/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Story Name / ID"), {
      target: { value: "USER-42" },
    });
    fireEvent.change(screen.getByLabelText("Story description"), {
      target: { value: "Dark mode toggle" },
    });
    fireEvent.click(checkbox(DEFAULT_CRITERIA[0].label));
    fireEvent.click(saveBtn);

    expect(spies.log).toHaveBeenCalledWith(REFINEMENT_ACTIONS.STORY_ADDED, {
      storyName: "USER-42",
    });
    const row = screen.getByRole("row", { name: /USER-42/ });
    expect(row).toHaveTextContent("Dark mode toggle");
    expect(row).toHaveTextContent("13%");
    expect(row).toHaveTextContent("1/8");
    expect(row).toHaveTextContent("Partial");
    expect(screen.getByLabelText("Story Name / ID")).toHaveValue("");
    expect(spies.csv?.rows).toEqual([["USER-42", "Dark mode toggle", todayLocalISO(), 13, 1, 8]]);

    fireEvent.click(screen.getByRole("button", { name: "Remove USER-42 from history" }));
    expect(st().history).toEqual([]);
  });

  it("saves with Ctrl+Enter in the description", () => {
    render(<RefinementClient />);
    fireEvent.change(screen.getByLabelText("Story Name / ID"), { target: { value: "USER-7" } });
    fireEvent.keyDown(screen.getByLabelText("Story description"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(st().history.map((h) => h.storyName)).toEqual(["USER-7"]);
    expect(spies.log).toHaveBeenCalledTimes(1);
  });

  // Bug: Ctrl+Enter bypassed the disabled Save button — nothing was saved
  // but a "story added" event was still logged (history, XP, streaks).
  it("logs nothing when Ctrl+Enter is pressed with no story name", () => {
    render(<RefinementClient />);
    fireEvent.keyDown(screen.getByLabelText("Story description"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(st().history).toEqual([]);
    expect(spies.log).not.toHaveBeenCalled();
  });
});

describe("Refinement criteria editing", () => {
  const label = DEFAULT_CRITERIA[1].label; // "Acceptance criteria defined"

  it("renames a criterion with Enter, keeps the old name when blanked, and cancels with Escape", () => {
    render(<RefinementClient />);
    fireEvent.click(screen.getAllByRole("button", { name: `Edit ${label}` })[0]);
    let input = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(input, { target: { value: "  AC agreed  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(st().criteria[1].label).toBe("AC agreed");
    // Both lists show the new name.
    expect(screen.getAllByRole("button", { name: "Edit AC agreed" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit AC agreed" })[0]);
    input = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save criterion" }));
    expect(st().criteria[1].label).toBe("AC agreed");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit AC agreed" })[0]);
    input = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(input, { target: { value: "Thrown away" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Criterion" })).toBeNull();
    expect(st().criteria[1].label).toBe("AC agreed");
  });

  it("adds a description with Ctrl+Enter and shows it under the criterion", () => {
    render(<RefinementClient />);
    fireEvent.click(screen.getAllByRole("button", { name: `Edit ${label}` })[0]);
    const desc = screen.getByRole("textbox", { name: "Criterion description" });
    fireEvent.change(desc, { target: { value: "Given / When / Then" } });
    fireEvent.keyDown(desc, { key: "Enter", metaKey: true });
    expect(st().criteria[1].description).toBe("Given / When / Then");
    expect(screen.getAllByText("Given / When / Then")).toHaveLength(2);
  });

  it("adds and removes criteria, down to an empty list", () => {
    render(<RefinementClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getByText("9 criteria defined")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "New criterion" })).toBeInTheDocument();

    for (const c of st().criteria.slice()) {
      fireEvent.click(screen.getAllByRole("button", { name: `Remove ${c.label}` })[0]);
    }
    expect(screen.getByText("0 criteria defined")).toBeInTheDocument();
    expect(screen.getByText("No criteria yet. Add some above.")).toBeInTheDocument();
    expect(screen.queryByText(/criteria met/)).toBeNull();
    expect(within(checkCard()).getByText("Not Ready")).toBeInTheDocument();
  });
});

describe("Refinement history header and signals", () => {
  // Bug: the header badge read "1 stories saved".
  it("counts saved stories in the header, singular for one", () => {
    useRefinementStore.setState({ history: [save("h1", "Only", 8)] });
    render(<RefinementClient />);
    expect(screen.getByText("1 story saved")).toBeInTheDocument();
    act(() => {
      useRefinementStore.setState({ history: [save("h2", "Two", 4), save("h1", "Only", 8)] });
    });
    expect(screen.getByText("2 stories saved")).toBeInTheDocument();
  });

  it("flags sustained drift (nine stories below the baseline) and a falling trend", () => {
    // Newest first: nine recent stories at 5/8 after eleven at 8/8.
    const history = [
      ...Array.from({ length: 9 }, (_, i) => save(`low${i}`, `Low ${i}`, 5)),
      ...Array.from({ length: 11 }, (_, i) => save(`high${i}`, `High ${i}`, 8)),
    ];
    useRefinementStore.setState({ history });
    render(<RefinementClient />);
    expect(screen.getByText("DoR adherence drift:").parentElement).toHaveTextContent(
      "long-run pass-rate baseline (83%)"
    );
    expect(screen.getByText(/pass-rate trend/)).toHaveTextContent("↘ pass-rate trend");
    expect(screen.getByText("Pass Rate Trend")).toBeInTheDocument();
  });

  it("raises no drift alert or chart for a single story", () => {
    useRefinementStore.setState({ history: [save("h1", "Only", 8)] });
    render(<RefinementClient />);
    expect(screen.queryByText("DoR adherence drift:")).toBeNull();
    expect(screen.queryByText("Pass Rate Trend")).toBeNull();
    expect(screen.queryByText(/pass-rate trend/)).toBeNull();
  });
});

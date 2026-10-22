import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintReview } from "@/lib/stores/workspace-types";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";

/**
 * Sprint Review Kit: the singleton-doc store hook, the four tabs (demo
 * script, stakeholder feedback, showcase checklist, velocity summary), the
 * shared NumCell field, and the combined Markdown/CSV export.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({
  text: {} as Record<string, string | undefined>,
  csv: {} as Record<string, CsvData | undefined>,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ counts: {} as Record<string, number> }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    filename,
    clipboardText,
    csvData,
  }: {
    filename: string;
    clipboardText?: string;
    csvData?: CsvData;
  }) => {
    exported.text[filename] = clipboardText;
    exported.csv[filename] = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/history/selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history/selectors")>()),
  selectEvents: (q: { toolId?: string; action?: string }) =>
    q.toolId === "sprint-review"
      ? Array.from({ length: signals.counts[q.action ?? ""] ?? 0 }, () => ({}))
      : [],
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { SprintReviewClient } from "@/app/(tools)/sprint-review/sprint-review-client";
import { DemoScriptTab } from "@/app/(tools)/sprint-review/components/demo-script-tab";
import { FeedbackTab } from "@/app/(tools)/sprint-review/components/feedback-tab";
import { ShowcaseChecklistTab } from "@/app/(tools)/sprint-review/components/showcase-checklist-tab";
import { VelocitySummaryTab } from "@/app/(tools)/sprint-review/components/velocity-summary-tab";
import { NumCell, SectionLabel } from "@/app/(tools)/sprint-review/components/form-fields";
import { SR_ID } from "@/app/(tools)/sprint-review/use-sprint-review-store";
import { DEFAULT_STATE } from "@/app/(tools)/sprint-review/constants";

function seed(partial: Partial<SprintReview> = {}) {
  useWorkspaceStore.setState({ sprintReviews: [{ id: SR_ID, ...DEFAULT_STATE, ...partial }] });
}

function doc(): SprintReview {
  const d = (useWorkspaceStore.getState().sprintReviews ?? []).find((r) => r.id === SR_ID);
  if (!d) throw new Error("no sprint review doc");
  return d;
}

/** Type into a draft-on-keystroke field and commit it (blur). */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

const feature = (id: string, name: string, timeMinutes: number) => ({
  id,
  name,
  description: "",
  acceptanceCriteria: "",
  timeMinutes,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0, 0));
  useWorkspaceStore.setState({ sprintReviews: [] });
  exported.text = {};
  exported.csv = {};
  history.log.mockClear();
  signals.counts = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Sprint Review — store + client shell", () => {
  it("shows the defaults on first mount and stamps today's local date as the meeting date", () => {
    render(<SprintReviewClient />);
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#1").parentElement).toHaveTextContent("Sprint #1 — Sprint Alpha");
    expect(doc().meetingDate).toBe("2026-10-18");
    expect(doc().features).toEqual(DEFAULT_STATE.features);
    expect(doc().checklistItems).toHaveLength(8);
  });

  it("keeps a persisted meeting date and lets the user clear it (no re-stamp)", () => {
    seed({ meetingDate: "2026-01-05" });
    render(<FeedbackTab />);
    const date = screen.getByLabelText("Meeting Date");
    expect(date).toHaveValue("2026-01-05");
    fireEvent.change(date, { target: { value: "" } });
    expect(doc().meetingDate).toBe("");
  });

  it("does not re-stamp a meeting date the user cleared in the client", () => {
    seed({ meetingDate: "2026-01-05" });
    render(<SprintReviewClient />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Stakeholder Feedback/ }), { button: 0 });
    fireEvent.change(screen.getByLabelText("Meeting Date"), { target: { value: "" } });
    expect(doc().meetingDate).toBe("");
    expect(screen.getByLabelText("Meeting Date")).toHaveValue("");
  });

  it("switches tabs", () => {
    render(<SprintReviewClient />);
    expect(screen.getByText("Features to Demo")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Showcase Checklist/ }), { button: 0 });
    expect(screen.getByRole("checkbox", { name: "Environment is working" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Velocity Summary/ }), { button: 0 });
    expect(screen.getByText("Velocity Summary Card")).toBeInTheDocument();
  });

  it("Reset restores the default review", () => {
    seed({
      sprintName: "Orion",
      sprintNumber: "9",
      features: [],
      feedbackItems: [{ id: "x", stakeholder: "CEO", feedback: "ok", category: "concern" }],
      checklistItems: [{ id: "c", label: "Only", checked: true }],
      committed: 3,
      meetingDate: "2026-02-02",
    });
    render(<SprintReviewClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(doc()).toEqual({ id: SR_ID, ...DEFAULT_STATE });
  });

  it("builds the combined Markdown export from every tab", () => {
    seed({
      sprintName: "Orion",
      sprintNumber: "7",
      meetingDate: "2026-10-20",
      features: [
        {
          id: "f1",
          name: "Login",
          description: "SSO",
          acceptanceCriteria: "Given a user",
          timeMinutes: 10,
        },
        feature("f2", "", 0),
      ],
      feedbackItems: [
        { id: "s", stakeholder: "PM", feedback: "add export", category: "suggestion" },
        { id: "c", stakeholder: "", feedback: "", category: "concern" },
        { id: "p", stakeholder: "CTO", feedback: "great", category: "positive" },
      ],
      checklistItems: [
        { id: "a", label: "Env", checked: true },
        { id: "b", label: "Data", checked: false },
      ],
      committed: 40,
      completed: 30,
      totalBacklog: 200,
      backlogDone: 50,
    });
    render(<SprintReviewClient />);
    const md = exported.text["sprint-7-review"]!;
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Sprint 7 Review Kit — Orion");
    expect(lines[1]).toBe("_Date: 2026-10-20_");
    expect(md).toContain("**Estimated Duration:** 10 minutes");
    expect(md).toContain(
      "### 1. Login (10 min)\n**Description:** SSO\n**Acceptance Criteria:** Given a user"
    );
    expect(md).toContain("### 2. Untitled Feature (0 min)");
    // Feedback grouped positive → concern → suggestion, blanks get placeholders.
    const pos = md.indexOf("### Positive\n- **CTO:** great");
    const con = md.indexOf("### Concern\n- **Unknown:** —");
    const sug = md.indexOf("### Suggestion\n- **PM:** add export");
    expect(pos).toBeGreaterThan(-1);
    expect(con).toBeGreaterThan(pos);
    expect(sug).toBeGreaterThan(con);
    expect(md).toContain("Progress: 1/2\n\n- [x] Env\n- [ ] Data");
    expect(md).toContain("- **Completion Rate:** 75%");
    expect(md).toContain("- **Release Progress:** 25%");
    expect(lines[lines.length - 1]).toMatch(/^_Generated .+_$/);
  });

  it("export never shows NaN/Infinity when committed or backlog is 0, and notes empty feedback", () => {
    seed({ committed: 0, completed: 5, totalBacklog: 0, backlogDone: 3, feedbackItems: [] });
    render(<SprintReviewClient />);
    const md = exported.text["sprint-1-review"]!;
    expect(md).toContain("- **Completion Rate:** 0%");
    expect(md).toContain("- **Release Progress:** 0%");
    expect(md).toContain("## Stakeholder Feedback\n_No feedback recorded._");
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it("exports features and feedback as one CSV with a Type column", () => {
    seed({
      features: [feature("f1", "Login", 5)],
      feedbackItems: [{ id: "p", stakeholder: "CTO", feedback: "great", category: "positive" }],
    });
    render(<SprintReviewClient />);
    const csv = exported.csv["sprint-1-review"]!;
    expect(csv.headers[0]).toBe("Type");
    expect(csv.rows).toEqual([
      ["Feature", "Login", "", "", "", "", 5],
      ["Feedback", "CTO", "", "", "great", "positive", ""],
    ]);
  });

  it("shows the 30-day activity callout only when there is activity", () => {
    const { unmount } = render(<SprintReviewClient />);
    expect(screen.queryByText(/Last 30 days/)).not.toBeInTheDocument();
    unmount();
    signals.counts = { item_added: 1, feedback_added: 2 };
    render(<SprintReviewClient />);
    expect(screen.getByText(/Last 30 days/)).toHaveTextContent(
      "Last 30 days: 1 demo item added · 2 feedback items captured."
    );
  });
});

describe("Sprint Review — Demo Script tab", () => {
  it("totals the minutes and renders the generated script", () => {
    seed({ features: [feature("f1", "Login", 5), feature("f2", "", 10)] });
    render(<DemoScriptTab />);
    expect(screen.getByText("— Total: 15 min")).toBeInTheDocument();
    const script = exported.text["demo-script"]!;
    expect(script.split("\n")).toEqual([
      "# Sprint 1 Review — Sprint Alpha",
      "**Estimated Duration:** 15 minutes",
      "",
      "## 1. Login (5 min)",
      "",
      "## 2. Untitled Feature (10 min)",
      "",
    ]);
  });

  it("shows the empty message and no script when there are no features", () => {
    seed({ features: [] });
    render(<DemoScriptTab />);
    expect(screen.getByText("No features yet. Add one above.")).toBeInTheDocument();
    expect(screen.queryByText("Generated Demo Script")).not.toBeInTheDocument();
    expect(screen.getByText("— Total: 0 min")).toBeInTheDocument();
  });

  it("adds a blank 5-minute feature and logs it", () => {
    seed({ features: [feature("f1", "Login", 5)] });
    render(<DemoScriptTab />);
    fireEvent.click(screen.getByRole("button", { name: /Add Feature/ }));
    const fs = doc().features;
    expect(fs).toHaveLength(2);
    expect(fs[1]).toMatchObject({
      name: "",
      description: "",
      acceptanceCriteria: "",
      timeMinutes: 5,
    });
    expect(fs[1].id).not.toBe("f1");
    expect(history.log).toHaveBeenCalledWith(SPRINT_REVIEW_ACTIONS.ITEM_ADDED, {});
    expect(screen.getByText("— Total: 10 min")).toBeInTheDocument();
  });

  it("deletes exactly the clicked feature", () => {
    seed({ features: [feature("f1", "A", 5), feature("f2", "B", 5), feature("f3", "C", 5)] });
    render(<DemoScriptTab />);
    fireEvent.click(screen.getByRole("button", { name: "Delete feature 2" }));
    expect(doc().features.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(history.log).toHaveBeenCalledWith(SPRINT_REVIEW_ACTIONS.ITEM_REMOVED, {
      featureId: "f2",
      name: "B",
    });
  });

  it("commits sprint info and feature text on blur", () => {
    seed({ features: [feature("f1", "Login", 5)] });
    render(<DemoScriptTab />);
    commit(screen.getByLabelText("Sprint Name"), "Orion");
    commit(screen.getByLabelText("Sprint Number"), "12");
    commit(screen.getByLabelText("Feature Name"), "Sign-in v2");
    commit(screen.getByLabelText("Brief Description"), "SSO + email");
    commit(screen.getByLabelText("Acceptance Criteria"), "Given...\nThen...");
    expect(doc()).toMatchObject({ sprintName: "Orion", sprintNumber: "12" });
    expect(doc().features[0]).toMatchObject({
      name: "Sign-in v2",
      description: "SSO + email",
      acceptanceCriteria: "Given...\nThen...",
    });
    expect(exported.text["demo-script"]).toContain("# Sprint 12 Review — Orion");
  });

  it("commits a valid time and clamps below the 1-minute minimum", () => {
    seed({ features: [feature("f1", "Login", 5)] });
    render(<DemoScriptTab />);
    const time = screen.getByLabelText("Time (min)");
    commit(time, "12");
    expect(doc().features[0].timeMinutes).toBe(12);
    commit(time, "0");
    expect(doc().features[0].timeMinutes).toBe(1);
    expect(time).toHaveValue(1);
  });

  // Bug: when the clamped value equalled the stored one, the field kept showing
  // the rejected input ("0") while the store still held 1.
  it("shows the clamped value even when it equals the stored value", () => {
    seed({ features: [feature("f1", "Login", 1)] });
    render(<DemoScriptTab />);
    const time = screen.getByLabelText("Time (min)");
    commit(time, "0");
    expect(doc().features[0].timeMinutes).toBe(1);
    expect(time).toHaveValue(1);
  });

  // Bug: Number("") is 0, so emptying the field silently committed the minimum.
  it("reverts an emptied time field instead of committing the minimum", () => {
    seed({ features: [feature("f1", "Login", 10)] });
    render(<DemoScriptTab />);
    const time = screen.getByLabelText("Time (min)");
    commit(time, "");
    expect(doc().features[0].timeMinutes).toBe(10);
    expect(time).toHaveValue(10);
  });
});

describe("Sprint Review — Feedback tab", () => {
  function chooseCategory(trigger: HTMLElement, label: string) {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const listbox = screen.getByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: label }));
  }

  it("shows the empty message and no summary without feedback", () => {
    seed({ feedbackItems: [] });
    render(<FeedbackTab />);
    expect(screen.getByText("No feedback yet. Add items above.")).toBeInTheDocument();
    expect(screen.queryByText("Feedback Summary")).not.toBeInTheDocument();
  });

  it("adds a blank positive item and logs FEEDBACK_ADDED", () => {
    seed({ feedbackItems: [] });
    render(<FeedbackTab />);
    fireEvent.click(screen.getByRole("button", { name: /Add Feedback/ }));
    expect(doc().feedbackItems).toHaveLength(1);
    expect(doc().feedbackItems[0]).toMatchObject({
      stakeholder: "",
      feedback: "",
      category: "positive",
    });
    expect(history.log).toHaveBeenCalledWith(SPRINT_REVIEW_ACTIONS.FEEDBACK_ADDED, {});
  });

  it("groups the summary by category with counts and placeholders", () => {
    seed({
      feedbackItems: [
        { id: "a", stakeholder: "CTO", feedback: "great", category: "positive" },
        { id: "b", stakeholder: "", feedback: "", category: "positive" },
        { id: "c", stakeholder: "Ops", feedback: "latency", category: "concern" },
      ],
    });
    render(<FeedbackTab />);
    expect(screen.getByText(/^2 item/)).toHaveTextContent("2 items");
    expect(screen.getByText(/^1 item/)).toHaveTextContent("1 item");
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Suggestion", { selector: "div" })).not.toBeInTheDocument();
  });

  it("edits stakeholder and feedback on blur", () => {
    seed({ feedbackItems: [{ id: "a", stakeholder: "", feedback: "", category: "positive" }] });
    render(<FeedbackTab />);
    commit(screen.getByLabelText("Stakeholder"), "VP Sales");
    commit(screen.getByLabelText("Feedback"), "Ship it");
    expect(doc().feedbackItems[0]).toMatchObject({ stakeholder: "VP Sales", feedback: "Ship it" });
  });

  it("changes an item's category", () => {
    seed({
      feedbackItems: [
        { id: "a", stakeholder: "A", feedback: "x", category: "positive" },
        { id: "b", stakeholder: "B", feedback: "y", category: "positive" },
      ],
    });
    render(<FeedbackTab />);
    chooseCategory(screen.getAllByRole("combobox")[1], "Concern");
    expect(doc().feedbackItems.map((f) => f.category)).toEqual(["positive", "concern"]);
  });

  it("deletes exactly the clicked item", () => {
    seed({
      feedbackItems: [
        { id: "a", stakeholder: "A", feedback: "x", category: "positive" },
        { id: "b", stakeholder: "", feedback: "y", category: "concern" },
        { id: "c", stakeholder: "C", feedback: "z", category: "suggestion" },
      ],
    });
    render(<FeedbackTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete feedback from unnamed stakeholder" })
    );
    expect(doc().feedbackItems.map((f) => f.id)).toEqual(["a", "c"]);
  });
});

describe("Sprint Review — Showcase Checklist tab", () => {
  it("shows progress for the default checklist", () => {
    seed({
      checklistItems: DEFAULT_STATE.checklistItems.map((c, i) => ({ ...c, checked: i < 3 })),
    });
    render(<ShowcaseChecklistTab />);
    expect(screen.getByText("3/8")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it("shows 0% (not NaN) for an empty checklist", () => {
    seed({ checklistItems: [] });
    render(<ShowcaseChecklistTab />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("toggles an item", () => {
    seed();
    render(<ShowcaseChecklistTab />);
    const box = screen.getByRole("checkbox", { name: "Demo data prepared" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(doc().checklistItems.find((c) => c.id === "c2")?.checked).toBe(true);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("1/8")).toBeInTheDocument();
    fireEvent.click(box);
    expect(doc().checklistItems.find((c) => c.id === "c2")?.checked).toBe(false);
  });

  it("adds a trimmed item with Enter and keeps Add disabled for blank input", () => {
    seed({ checklistItems: [] });
    render(<ShowcaseChecklistTab />);
    const input = screen.getByLabelText("New checklist item");
    const add = screen.getByRole("button", { name: /^Add$/ });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(add).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(doc().checklistItems).toHaveLength(0);
    fireEvent.change(input, { target: { value: "  Coffee ready  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(doc().checklistItems).toEqual([
      expect.objectContaining({ label: "Coffee ready", checked: false }),
    ]);
    expect(input).toHaveValue("");
  });

  it("removes exactly the clicked item and edits a label on blur", () => {
    seed();
    render(<ShowcaseChecklistTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete checklist item: Stakeholders invited" })
    );
    expect(doc().checklistItems.map((c) => c.id)).not.toContain("c4");
    expect(doc().checklistItems).toHaveLength(7);
    commit(screen.getByLabelText("Edit checklist item: Backup plan ready"), "Plan B ready");
    expect(doc().checklistItems.find((c) => c.id === "c7")?.label).toBe("Plan B ready");
  });
});

describe("Sprint Review — Velocity Summary tab", () => {
  it("derives completion rate and release progress", () => {
    seed();
    render(<VelocitySummaryTab />);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("18%")).toBeInTheDocument();
    const card = exported.text["velocity-summary"]!;
    expect(card).toContain("# Velocity Summary — Sprint 1: Sprint Alpha");
    expect(card).toContain("- **Completion Rate:** 90%");
    expect(card).toContain("- **Release Progress:** 18%");
  });

  it("shows 0% (not NaN/Infinity) when committed and backlog are 0", () => {
    seed({ committed: 0, completed: 5, totalBacklog: 0, backlogDone: 5 });
    render(<VelocitySummaryTab />);
    expect(screen.getAllByText("0%")).toHaveLength(2);
    expect(exported.text["velocity-summary"]).not.toMatch(/NaN|Infinity/);
  });

  it("commits the inputs and recomputes", () => {
    seed();
    render(<VelocitySummaryTab />);
    commit(screen.getByLabelText("Committed Points"), "50");
    commit(screen.getByLabelText("Completed Points"), "25");
    commit(screen.getByLabelText("Total Backlog Points"), "100");
    commit(screen.getByLabelText("Done to Date"), "80");
    expect(doc()).toMatchObject({
      committed: 50,
      completed: 25,
      totalBacklog: 100,
      backlogDone: 80,
    });
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  // Bug: a negative entry clamped to the stored 0 left "-5" in the field.
  it("clamps a negative entry to 0 and shows the clamped value", () => {
    seed({ committed: 0 });
    render(<VelocitySummaryTab />);
    const committed = screen.getByLabelText("Committed Points");
    commit(committed, "-5");
    expect(doc().committed).toBe(0);
    expect(committed).toHaveValue(0);
  });
});

describe("Sprint Review — NumCell", () => {
  function renderCell(value: number, onCommit = vi.fn()) {
    render(<NumCell value={value} onCommit={onCommit} min={1} max={10} ariaLabel="n" />);
    return { input: screen.getByLabelText("n"), onCommit };
  }

  it("commits a typed value within range", () => {
    const { input, onCommit } = renderCell(5);
    commit(input, "7.5");
    expect(onCommit).toHaveBeenCalledWith(7.5);
  });

  it("clamps into [min, max] and shows the clamped value", () => {
    const { input, onCommit } = renderCell(5);
    commit(input, "50");
    expect(onCommit).toHaveBeenLastCalledWith(10);
    expect(input).toHaveValue(10);
    commit(input, "-3");
    expect(onCommit).toHaveBeenLastCalledWith(1);
    expect(input).toHaveValue(1);
  });

  // Bug: Number("") is 0, so a blank field committed the minimum.
  it("treats a blank field as invalid and reverts it", () => {
    const { input, onCommit } = renderCell(5);
    commit(input, "");
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue(5);
  });

  it("commits on Enter", () => {
    const { input, onCommit } = renderCell(5);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(8);
  });

  it("re-syncs the draft when the committed value changes upstream", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<NumCell value={5} onCommit={onCommit} ariaLabel="n" />);
    rerender(<NumCell value={9} onCommit={onCommit} ariaLabel="n" />);
    expect(screen.getByLabelText("n")).toHaveValue(9);
  });

  it("SectionLabel is a <label> only when htmlFor is given", () => {
    render(
      <>
        <SectionLabel htmlFor="x">Linked</SectionLabel>
        <input id="x" />
        <SectionLabel>Plain</SectionLabel>
      </>
    );
    expect(screen.getByText("Linked").tagName).toBe("LABEL");
    expect(screen.getByText("Plain").tagName).toBe("P");
    expect(screen.getByLabelText("Linked")).toHaveAttribute("id", "x");
  });
});

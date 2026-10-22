import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Premortem gap-filling: adding a cause, the likelihood/impact cells
 * (draft, clamp, blank), the score, reordering, the text fields that
 * commit on blur, the once-per-cause prevention log, Undo of "Clear
 * example", and Markdown edges. Example load/clear, Send to and remove
 * Undo live in premortem-example / premortem-sendto / premortem-undo.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { PremortemClient } from "@/app/(tools)/premortem/premortem-client";
import { toMarkdown, type Cause } from "@/app/(tools)/premortem/markdown";
import { EXAMPLE_SCENARIO } from "@/app/(tools)/premortem/example";
import { PREMORTEM_ACTIONS } from "@/lib/history/event-actions";

const KEY = "agile-toolkit:premortem";
const NOW = new Date(2026, 9, 18);

const cause = (id: string, text: string, extra: Partial<Cause> = {}): Cause => ({
  id,
  text,
  likelihood: 3,
  impact: 3,
  ...extra,
});
const seed = (causes: Cause[], scenario = "") =>
  localStorage.setItem(KEY, JSON.stringify({ scenario, causes }));
const stored = () =>
  JSON.parse(localStorage.getItem(KEY) ?? "{}") as { scenario: string; causes: Cause[] };
const causeTexts = () =>
  screen
    .getAllByRole("textbox", { name: /^Cause of failure \d+$/ })
    .map((i) => (i as HTMLInputElement).value);
/** Score badge text for cause `n` (1-based, display order). */
const scoreOf = (n: number) =>
  screen.getByRole("button", { name: `Remove cause ${n}` }).previousElementSibling!.textContent;
const likelihood = (n: number) =>
  screen.getByLabelText(`Likelihood (1-5) for cause ${n}`) as HTMLInputElement;
const commitCell = (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const preventionLogs = () =>
  history.log.mock.calls.filter(([action]) => action === PREMORTEM_ACTIONS.PREVENTION_ADDED);

beforeEach(() => {
  undo.last = null;
  history.log.mockClear();
  localStorage.removeItem(KEY);
});

describe("Premortem: causes", () => {
  it("adds a blank cause at the end, L3 × I3 = 9", () => {
    seed([cause("c1", "Unclear goal", { likelihood: 5, impact: 5 })]);
    render(<PremortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add Cause" }));
    expect(stored().causes).toHaveLength(2);
    expect(stored().causes[1]).toMatchObject({ text: "", likelihood: 3, impact: 3 });
    expect(causeTexts()).toEqual(["Unclear goal", ""]);
    expect(scoreOf(1)).toBe("Risk score 25");
    expect(scoreOf(2)).toBe("Risk score 9");
    expect(history.log).toHaveBeenCalledWith(PREMORTEM_ACTIONS.CAUSE_ADDED, {
      causeId: stored().causes[1].id,
    });
  });

  it("commits likelihood and impact on blur or Enter, and rescores", () => {
    seed([cause("c1", "Unclear goal")]);
    render(<PremortemClient />);
    fireEvent.change(likelihood(1), { target: { value: "5" } });
    // Typing alone writes nothing.
    expect(stored().causes[0].likelihood).toBe(3);
    fireEvent.blur(likelihood(1));
    expect(stored().causes[0].likelihood).toBe(5);
    expect(scoreOf(1)).toBe("Risk score 15");

    const impact = screen.getByLabelText("Impact (1-5) for cause 1");
    fireEvent.change(impact, { target: { value: "2" } });
    (impact as HTMLInputElement).focus();
    fireEvent.keyDown(impact, { key: "Enter" });
    expect(stored().causes[0].impact).toBe(2);
    expect(scoreOf(1)).toBe("Risk score 10");
  });

  it("clamps likelihood and impact into 1-5", () => {
    seed([cause("c1", "Unclear goal")]);
    render(<PremortemClient />);
    commitCell(likelihood(1), "9");
    expect(stored().causes[0].likelihood).toBe(5);
    expect(likelihood(1).value).toBe("5");
    commitCell(likelihood(1), "-2");
    expect(stored().causes[0].likelihood).toBe(1);
    expect(likelihood(1).value).toBe("1");
  });

  // Bug: Number("") is 0, so clearing the cell and leaving it saved 1
  // (0 clamped up) instead of keeping the value, as unreadable input does.
  it("keeps the value when the cell is left blank", () => {
    seed([cause("c1", "Unclear goal", { likelihood: 4 })]);
    render(<PremortemClient />);
    commitCell(likelihood(1), "");
    expect(stored().causes[0].likelihood).toBe(4);
    expect(likelihood(1).value).toBe("4");
    expect(scoreOf(1)).toBe("Risk score 12");
  });

  it("moves causes up and down, and not past either end", () => {
    seed([cause("c1", "Unclear goal"), cause("c2", "Scope creep"), cause("c3", "No tests")]);
    render(<PremortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Move cause 1 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move cause 3 down" }));
    expect(causeTexts()).toEqual(["Unclear goal", "Scope creep", "No tests"]);

    fireEvent.click(screen.getByRole("button", { name: "Move cause 3 up" }));
    expect(causeTexts()).toEqual(["Unclear goal", "No tests", "Scope creep"]);
    fireEvent.click(screen.getByRole("button", { name: "Move cause 1 down" }));
    expect(causeTexts()).toEqual(["No tests", "Unclear goal", "Scope creep"]);
    expect(stored().causes.map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
  });

  it("commits the scenario, text, description, action and owner on blur", () => {
    seed([cause("c1", "")]);
    render(<PremortemClient />);
    const fields: [string, string][] = [
      ["Imagined failure scenario", "We shipped late."],
      ["Cause of failure 1", "Scope creep"],
      ["Description for cause 1 (optional)", "Every review added work."],
      ["Preventive action for cause 1", "Freeze scope at planning."],
      ["Owner for cause 1", "PO"],
    ];
    for (const [label, value] of fields) {
      const el = screen.getByLabelText(label);
      fireEvent.change(el, { target: { value } });
      fireEvent.blur(el);
    }
    expect(stored()).toEqual({
      scenario: "We shipped late.",
      causes: [
        {
          id: "c1",
          text: "Scope creep",
          likelihood: 3,
          impact: 3,
          description: "Every review added work.",
          preventiveAction: "Freeze scope at planning.",
          owner: "PO",
        },
      ],
    });
  });
});

describe("Premortem: prevention log", () => {
  it("logs a cause's first preventive action once, not on every edit", () => {
    seed([cause("c1", "Scope creep", { owner: "PO" })]);
    render(<PremortemClient />);
    const action = screen.getByLabelText("Preventive action for cause 1");
    fireEvent.change(action, { target: { value: "   " } });
    fireEvent.blur(action);
    expect(preventionLogs()).toHaveLength(0);

    fireEvent.change(action, { target: { value: "Freeze scope" } });
    fireEvent.blur(action);
    fireEvent.change(action, { target: { value: "Freeze scope at planning" } });
    fireEvent.blur(action);
    expect(preventionLogs()).toEqual([
      [PREMORTEM_ACTIONS.PREVENTION_ADDED, { causeId: "c1", owner: "PO" }],
    ]);
  });

  it("doesn't log actions that were already saved, or the example's", () => {
    seed([cause("c1", "Scope creep", { preventiveAction: "Freeze scope" })]);
    render(<PremortemClient />);
    const action = screen.getByLabelText("Preventive action for cause 1");
    fireEvent.change(action, { target: { value: "Freeze scope at planning" } });
    fireEvent.blur(action);
    expect(preventionLogs()).toHaveLength(0);
  });

  it("doesn't log the example's preventive actions as the user's", () => {
    render(<PremortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const action = screen.getByLabelText("Preventive action for cause 1");
    fireEvent.change(action, { target: { value: "A sharper action" } });
    fireEvent.blur(action);
    expect(preventionLogs()).toHaveLength(0);
  });
});

describe("Premortem: Undo", () => {
  it("labels an untitled cause by its position", () => {
    seed([cause("c1", "Unclear goal"), cause("c2", "  ")]);
    render(<PremortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove cause 2" }));
    expect(undo.last!.label).toBe("Removed cause 2");
  });

  it("puts the cleared example back, scenario included", () => {
    render(<PremortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Cause" }));
    const before = stored();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().scenario).toBe("");
    expect(stored().causes).toHaveLength(1);

    act(() => undo.last!.revert());
    expect(stored()).toEqual(before);
    expect(stored().scenario).toBe(EXAMPLE_SCENARIO);
  });
});

describe("Premortem Markdown edges", () => {
  it("shows a scenario with no causes yet", () => {
    expect(toMarkdown({ scenario: "We shipped late.", causes: [] }, NOW)).toBe(
      "# Premortem — 18 Oct 2026\n\n## Imagined failure\n\nWe shipped late.\n\n## Causes\n\n_No causes yet._\n"
    );
  });

  it("marks a missing scenario and an untitled cause, and lists actions without owners", () => {
    const md = toMarkdown(
      {
        scenario: "  ",
        causes: [
          cause("c1", "", { likelihood: 2, impact: 5, preventiveAction: "Line one\nline two" }),
          cause("c2", "Scope creep", { description: "  ", owner: "  " }),
        ],
      },
      NOW
    );
    expect(md).toContain("## Imagined failure\n\n_Not described yet._");
    expect(md).toContain("| 1 | (untitled) | 2 | 5 | 10 | Line one line two |  |");
    // A blank description adds nothing after the cause.
    expect(md).toContain("| 2 | Scope creep | 3 | 3 | 9 |  |  |");
    expect(md).toContain("## Preventive actions\n\n- [ ] Line one line two\n");
    expect(md).not.toContain("**");
  });

  it("collapses a multi-line scenario to one line", () => {
    const md = toMarkdown({ scenario: "It's April.\n\nWe missed.", causes: [] }, NOW);
    expect(md).toContain("## Imagined failure\n\nIt's April. We missed.\n");
  });
});

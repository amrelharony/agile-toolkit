import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * RICE gap-filling: the pure helpers behind the add form and the row editor
 * (draft parsing, validation edges, the confidence key), Markdown edges, and
 * the table's derived values (dense ranks, outlier flag, header count).
 * Adding/editing/deleting basics live in rice-wsjf-editing and
 * rice-scoring-example.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
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

import { RiceScoringClient } from "@/app/(tools)/rice-scoring/rice-scoring-client";
import { toMarkdown } from "@/app/(tools)/rice-scoring/markdown";
import {
  EMPTY_RICE_DRAFT,
  confidenceKey,
  confidenceOf,
  riceCustomFrom,
  riceDraftFrom,
  sameRiceValues,
  validateRice,
  withRiceValues,
} from "@/app/(tools)/rice-scoring/rice-inputs";

const NOW = new Date(2026, 9, 18);

const row = (
  id: string,
  title: string,
  score: number | undefined,
  fields: Record<string, number | string>,
  framework: PrioritizationItem["framework"] = "rice"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score,
  fields,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const rice = (id: string, title: string, r: number, i: number, c: number, e: number) =>
  row(id, title, (r * i * (c / 100)) / e, { reach: r, impact: i, confidence: c, effort: e });

const rows = () => useWorkspaceStore.getState().prioritizations ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pick = (group: string, option: string) =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option })
  );
const addAndScore = () => fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent);

/** The table row whose title button reads `title`. */
const tableRow = (title: string) => screen.getByRole("button", { name: title }).closest("tr")!;
const cells = (title: string) =>
  within(tableRow(title))
    .getAllByRole("cell")
    .map((c) => c.textContent);

beforeEach(() => {
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("RICE confidence key", () => {
  it("reads `confidence`, falls back to `confidencePct`, and prefers `confidence` when both exist", () => {
    expect(confidenceKey(undefined)).toBe("confidence");
    expect(confidenceKey({ confidencePct: 80 })).toBe("confidencePct");
    expect(confidenceKey({ confidence: 50, confidencePct: 80 })).toBe("confidence");
    expect(confidenceOf({ confidencePct: 80 })).toBe(80);
    expect(confidenceOf({ confidence: "50" })).toBe(50);
    expect(confidenceOf({ confidence: "lots" })).toBeUndefined();
    expect(confidenceOf(undefined)).toBeUndefined();
  });
});

describe("riceDraftFrom / riceCustomFrom", () => {
  it("turns stored numbers and numeric strings into a draft, and unreadable values into blanks", () => {
    expect(riceDraftFrom({ reach: 500, impact: "2", confidencePct: 80, effort: "1.5" })).toEqual({
      reach: "500",
      impact: 2,
      confidence: 80,
      effort: "1.5",
    });
    expect(riceDraftFrom({ reach: "n/a", impact: "", effort: " " })).toEqual(EMPTY_RICE_DRAFT);
    expect(riceDraftFrom(undefined)).toEqual(EMPTY_RICE_DRAFT);
  });

  it("keeps only the off-scale impact and confidence as Custom", () => {
    expect(riceCustomFrom({ reach: "1", impact: 1.5, confidence: 70, effort: "1" })).toEqual({
      impact: 1.5,
      confidence: 70,
    });
    expect(riceCustomFrom({ reach: "1", impact: 2, confidence: 80, effort: "1" })).toEqual({
      impact: null,
      confidence: null,
    });
    expect(riceCustomFrom(EMPTY_RICE_DRAFT)).toEqual({ impact: null, confidence: null });
  });
});

describe("validateRice", () => {
  const ok = { reach: "500", impact: 2, confidence: 80, effort: "2" };

  it("returns the numbers for a complete draft", () => {
    expect(validateRice(ok)).toEqual({
      ok: true,
      values: { reach: 500, impact: 2, confidence: 80, effort: 2 },
    });
  });

  it("accepts a reach of 0 (nobody reached is a real answer)", () => {
    const result = validateRice({ ...ok, reach: "0" });
    expect(result).toEqual({
      ok: true,
      values: { reach: 0, impact: 2, confidence: 80, effort: 2 },
    });
  });

  it("treats whitespace as blank", () => {
    expect(validateRice({ ...ok, reach: "   ", effort: "\t" })).toEqual({
      ok: false,
      errors: { reach: "Enter the reach.", effort: "Enter the effort." },
    });
  });

  it("rejects a negative or unreadable reach", () => {
    for (const reach of ["-1", "abc", "Infinity"]) {
      expect(validateRice({ ...ok, reach })).toEqual({
        ok: false,
        errors: { reach: "Reach must be 0 or more." },
      });
    }
  });

  it("rejects an effort of 0 or less, or unreadable", () => {
    for (const effort of ["0", "-2", "two"]) {
      expect(validateRice({ ...ok, effort })).toEqual({
        ok: false,
        errors: { effort: "Effort must be more than 0." },
      });
    }
  });

  it("names every missing input at once", () => {
    expect(validateRice(EMPTY_RICE_DRAFT)).toEqual({
      ok: false,
      errors: {
        reach: "Enter the reach.",
        impact: "Pick an impact.",
        confidence: "Pick a confidence.",
        effort: "Enter the effort.",
      },
    });
  });
});

describe("sameRiceValues / withRiceValues", () => {
  const values = { reach: 500, impact: 2, confidence: 80, effort: 3 };

  it("compares stored numbers and numeric strings with the edited values", () => {
    expect(sameRiceValues({ reach: "500", impact: 2, confidence: 80, effort: 3 }, values)).toBe(
      true
    );
    expect(sameRiceValues({ reach: 500, impact: 2, confidencePct: 80, effort: 3 }, values)).toBe(
      true
    );
    expect(sameRiceValues({ reach: 500, impact: 2, confidence: 80, effort: 4 }, values)).toBe(
      false
    );
    expect(sameRiceValues(undefined, values)).toBe(false);
  });

  it("writes the new values, keeping other keys and the row's own confidence key", () => {
    expect(withRiceValues({ reach: 1, confidencePct: 50, note: "keep" }, values)).toEqual({
      reach: 500,
      impact: 2,
      confidencePct: 80,
      effort: 3,
      note: "keep",
    });
    expect(withRiceValues(undefined, values)).toEqual(values);
  });
});

describe("RICE toMarkdown edges", () => {
  it("shows a dash for missing inputs and 0.00 for a row without a score", () => {
    const md = toMarkdown([row("a", "Unscored idea", undefined, {})], NOW);
    expect(md).toContain("| 1 | Unscored idea | — | — | — | — | 0.00 |");
  });

  it("reads confidence saved as confidencePct by the MCP actions", () => {
    const md = toMarkdown(
      [row("a", "Bulk export", 160, { reach: 200, impact: 1, confidencePct: 80, effort: 1 })],
      NOW
    );
    expect(md).toContain("| 1 | Bulk export | 200 | 1 | 80% | 1 | 160.00 |");
  });

  it("names every tied leader under Do first", () => {
    const md = toMarkdown(
      [
        rice("a", "Saved cards", 100, 1, 100, 1),
        rice("b", "Guest checkout", 200, 1, 50, 1),
        rice("c", "Autocomplete", 10, 1, 100, 1),
      ],
      NOW
    );
    expect(md).toContain("**Do first:** Saved cards, Guest checkout (RICE 100.00)");
    expect(md).toContain("| 1 | Guest checkout |");
    expect(md).toContain("| 2 | Autocomplete |");
  });

  it("never flags outliers in fewer than four rows", () => {
    const md = toMarkdown(
      [rice("a", "Tiny", 1, 1, 100, 1), rice("b", "Huge", 1_000_000, 3, 100, 1)],
      NOW
    );
    expect(md).not.toContain("(outlier)");
    expect(md).not.toContain("re-check its inputs");
  });
});

describe("RICE table", () => {
  it("ranks rows by score with dense ranks, two decimals and a header count", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        rice("a", "Saved cards", 3000, 2, 80, 4),
        rice("b", "Guest checkout", 6000, 1, 100, 2),
        rice("c", "Wallet", 2400, 1, 100, 2),
        row("w", "A WSJF row", 99, { businessValue: 1 }, "wsjf"),
      ],
    });
    render(<RiceScoringClient />);

    expect(screen.getByText("Initiatives (3, sorted by RICE)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "A WSJF row" })).toBeNull();
    const top = cells("Guest checkout");
    // Rank, then R, I, C%, E and the score (the title cell holds buttons).
    expect([top[0], ...top.slice(2, 7)]).toEqual(["1", "6000", "1", "100", "2", "3000.00"]);
    // Saved cards (1200) and Wallet (1200) tie for second.
    expect(cells("Saved cards")[0]).toBe("2");
    expect(cells("Wallet")[0]).toBe("2");
    expect(cells("Wallet")[6]).toBe("1200.00");
    const order = screen
      .getAllByRole("button", { name: /^Edit scores for / })
      .map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual([
      "Edit scores for Guest checkout",
      "Edit scores for Saved cards",
      "Edit scores for Wallet",
    ]);
  });

  it("flags an outlier score on its row only", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        rice("a", "A", 100, 1, 100, 10),
        rice("b", "B", 110, 1, 100, 10),
        rice("c", "C", 120, 1, 100, 10),
        rice("d", "D", 130, 1, 100, 10),
        rice("e", "Typo", 100000, 3, 100, 1),
      ],
    });
    render(<RiceScoringClient />);
    const flags = screen.getAllByRole("img", { name: "Outlier score, re-check inputs" });
    expect(flags).toHaveLength(1);
    expect(tableRow("Typo")).toContainElement(flags[0]);
  });

  it("shows no chart or table until a row exists", () => {
    render(<RiceScoringClient />);
    expect(screen.queryByText("Top 10 by RICE score")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("RICE adding: edges", () => {
  function fillScores(reach: string, effort: string) {
    type("Reach (people per quarter)", reach);
    type("Effort (person-months)", effort);
    pick("Impact", "1 Medium");
    pick("Confidence", "100% High");
  }

  it("trims the title and caps it at 200 characters", () => {
    render(<RiceScoringClient />);
    type("Initiative title", `   ${"x".repeat(250)}   `);
    fillScores("10", "1");
    addAndScore();
    expect(rows()[0].title).toBe("x".repeat(200));
  });

  it("accepts a reach of 0 and scores it 0", () => {
    render(<RiceScoringClient />);
    type("Initiative title", "Internal tool");
    fillScores("0", "1");
    addAndScore();
    expect(rows()[0]).toMatchObject({ score: 0, fields: { reach: 0, effort: 1 } });
    expect(cells("Internal tool")[6]).toBe("0.00");
  });

  it("blocks a whitespace-only title", () => {
    render(<RiceScoringClient />);
    type("Initiative title", "   ");
    fillScores("10", "1");
    addAndScore();
    expect(rows()).toEqual([]);
    expect(alerts()).toEqual(["Enter a title."]);
  });

  it("explains a negative reach and a zero effort", () => {
    render(<RiceScoringClient />);
    type("Initiative title", "Saved searches");
    fillScores("-5", "0");
    addAndScore();
    expect(rows()).toEqual([]);
    expect(alerts()).toEqual(["Reach must be 0 or more.", "Effort must be more than 0."]);
  });

  it("clears only the message of the input that changed", () => {
    render(<RiceScoringClient />);
    addAndScore();
    expect(alerts()).toHaveLength(5);
    type("Reach (people per quarter)", "10");
    expect(alerts()).toEqual([
      "Enter a title.",
      "Enter the effort.",
      "Pick an impact.",
      "Pick a confidence.",
    ]);
    type("Initiative title", "S");
    pick("Impact", "2 High");
    expect(alerts()).toEqual(["Enter the effort.", "Pick a confidence."]);
  });
});

describe("RICE editing: edges", () => {
  const r1 = rice("r1", "Saved searches", 500, 2, 80, 3);

  it("ignores a rename to blank and caps a long rename at 200 characters", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
    let input = screen.getByLabelText("Rename Saved searches");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rows()[0]).toEqual(r1);

    fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
    input = screen.getByLabelText("Rename Saved searches");
    fireEvent.change(input, { target: { value: "y".repeat(230) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rows()[0].title).toBe("y".repeat(200));
  });

  it("closes the editor from its Edit button or Cancel without saving", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    const edit = screen.getByRole("button", { name: "Edit scores for Saved searches" });

    fireEvent.click(edit);
    let editor = screen.getByRole("form", { name: "Edit scores for Saved searches" });
    expect(edit).toHaveAttribute("aria-controls", "rice-edit-r1");
    fireEvent.change(within(editor).getByLabelText("Reach (people per quarter)"), {
      target: { value: "999" },
    });
    fireEvent.click(edit);
    expect(screen.queryByRole("form", { name: "Edit scores for Saved searches" })).toBeNull();
    expect(edit).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(edit);
    editor = screen.getByRole("form", { name: "Edit scores for Saved searches" });
    // A reopened editor starts from the stored row, not the abandoned draft.
    expect(within(editor).getByLabelText("Reach (people per quarter)")).toHaveValue(500);
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit scores for Saved searches" })).toBeNull();
    expect(rows()[0]).toEqual(r1);
  });

  it("blocks a negative reach in the editor", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Saved searches" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Saved searches" });
    fireEvent.change(within(editor).getByLabelText("Reach (people per quarter)"), {
      target: { value: "-1" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent("Reach must be 0 or more.");
    expect(rows()[0]).toEqual(r1);
  });
});

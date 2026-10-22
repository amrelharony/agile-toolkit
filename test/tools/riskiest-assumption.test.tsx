import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Assumption, AssumptionLevel } from "@/lib/stores/workspace-types";

/**
 * Riskiest Assumption Canvas: the add form (trim + clamp 1-5), ranking by
 * risk × (6 − evidence), the 2×2 matrix, KPIs, row editing, status, delete,
 * the test card and the CSV export.
 */

const h = vi.hoisted(() => ({
  log: vi.fn(),
  exported: {} as { csvData?: { headers: string[]; rows: unknown[][] }; jsonData?: unknown },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: {
    csvData?: { headers: string[]; rows: unknown[][] };
    jsonData?: unknown;
  }) => {
    h.exported.csvData = props.csvData;
    h.exported.jsonData = props.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));

beforeAll(() => {
  // Radix Select + the test card's scroll-into-view call these; jsdom has neither.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { RiskiestAssumptionClient } from "@/app/(tools)/riskiest-assumption/riskiest-assumption-client";

const RA_ID = "riskiestAssumption:current";

const asm = (
  id: string,
  riskLevel: AssumptionLevel,
  evidenceLevel: AssumptionLevel,
  patch: Partial<Assumption> = {}
): Assumption => ({
  id,
  statement: `assumption ${id}`,
  riskLevel,
  evidenceLevel,
  status: "untested",
  ...patch,
});

const seed = (...assumptions: Assumption[]) =>
  useWorkspaceStore.setState({ riskiestAssumptions: [{ id: RA_ID, assumptions }] });

const stored = () =>
  (useWorkspaceStore.getState().riskiestAssumptions ?? []).find((d) => d.id === RA_ID)
    ?.assumptions ?? [];

const byId = (id: string) => stored().find((a) => a.id === id)!;

/** The value shown under a KPI label. */
const stat = (label: string) =>
  screen.getAllByText(label, { selector: "span.truncate" })[0].parentElement!.nextElementSibling!
    .textContent;

const rankBadges = () => screen.queryAllByText(/^#\d+ · score/).map((b) => b.textContent);

const quadrant = (title: string) =>
  Array.from(screen.getByText(title).parentElement!.querySelectorAll("li")).map(
    (li) => li.textContent
  );

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

function chooseStatus(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: label }));
}

beforeEach(() => {
  h.log.mockClear();
  h.exported.csvData = undefined;
  h.exported.jsonData = undefined;
  useWorkspaceStore.setState({ riskiestAssumptions: [] });
});

describe("Riskiest Assumption — empty state", () => {
  it("shows zero KPIs, no matrix, and a disabled Add button", () => {
    render(<RiskiestAssumptionClient />);
    expect(stat("Total")).toBe("0");
    expect(stat("Untested + risky")).toBe("0");
    expect(stat("Validated")).toBe("0");
    expect(stat("Invalidated")).toBe("0");
    expect(screen.queryByText("Risk × Evidence matrix")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add assumption" })).toBeDisabled();
    type(screen.getByLabelText("Assumption statement"), "   ");
    expect(screen.getByRole("button", { name: "Add assumption" })).toBeDisabled();
  });
});

describe("Riskiest Assumption — add form", () => {
  it("adds a trimmed, untested assumption and resets the form", () => {
    render(<RiskiestAssumptionClient />);
    type(screen.getByLabelText("Assumption statement"), "  Users will pay $20/mo  ");
    type(screen.getByLabelText("Risk level (1-5)"), "5");
    type(screen.getByLabelText("Evidence level (1-5)"), "1");
    type(screen.getByLabelText("Test idea"), "  fake-door pricing page ");
    type(screen.getByLabelText("Description"), "   ");
    fireEvent.click(screen.getByRole("button", { name: "Add assumption" }));

    expect(stored()).toHaveLength(1);
    const [a] = stored();
    expect(a).toMatchObject({
      statement: "Users will pay $20/mo",
      riskLevel: 5,
      evidenceLevel: 1,
      testIdea: "fake-door pricing page",
      status: "untested",
    });
    expect(a.description).toBeUndefined();
    expect(h.log).toHaveBeenCalledWith("assumption_added", {
      assumptionId: a.id,
      statement: "Users will pay $20/mo",
      riskLevel: 5,
      evidenceLevel: 1,
      description: undefined,
      testIdea: "fake-door pricing page",
    });

    expect(screen.getByLabelText("Assumption statement")).toHaveValue("");
    expect(screen.getByLabelText("Risk level (1-5)")).toHaveValue(3);
    expect(screen.getByLabelText("Evidence level (1-5)")).toHaveValue(3);
    expect(screen.getByLabelText("Test idea")).toHaveValue("");
    expect(stat("Total")).toBe("1");
  });

  it("clamps the levels to 1-5 on blur and falls back to 3 when blank", () => {
    render(<RiskiestAssumptionClient />);
    const risk = screen.getByLabelText("Risk level (1-5)");
    const evidence = screen.getByLabelText("Evidence level (1-5)");
    type(risk, "9");
    fireEvent.blur(risk);
    expect(risk).toHaveValue(5);
    type(evidence, "-2");
    fireEvent.blur(evidence);
    expect(evidence).toHaveValue(1);
    type(risk, "2.6");
    fireEvent.blur(risk);
    expect(risk).toHaveValue(3);
    type(risk, "");
    fireEvent.blur(risk);
    expect(risk).toHaveValue(3);
  });

  // Bug: `Number(x) || 3` turned a typed 0 into 3 instead of clamping it to 1.
  it("clamps a typed 0 up to 1 rather than resetting it to 3", () => {
    render(<RiskiestAssumptionClient />);
    const risk = screen.getByLabelText("Risk level (1-5)");
    type(risk, "0");
    fireEvent.blur(risk);
    expect(risk).toHaveValue(1);

    // Also when Add is clicked straight from the field (no blur in between).
    type(screen.getByLabelText("Assumption statement"), "Low risk");
    type(screen.getByLabelText("Evidence level (1-5)"), "0");
    fireEvent.click(screen.getByRole("button", { name: "Add assumption" }));
    expect(stored()[0]).toMatchObject({ riskLevel: 1, evidenceLevel: 1 });
  });

  it("does nothing for a whitespace-only statement", () => {
    render(<RiskiestAssumptionClient />);
    type(screen.getByLabelText("Assumption statement"), "  ");
    fireEvent.click(screen.getByRole("button", { name: "Add assumption" }));
    expect(stored()).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });
});

describe("Riskiest Assumption — ranking, matrix, KPIs", () => {
  it("ranks by risk × (6 − evidence), highest first, ties in insertion order", () => {
    seed(asm("a", 2, 2), asm("b", 5, 1), asm("c", 4, 3), asm("d", 3, 5), asm("e", 3, 2));
    render(<RiskiestAssumptionClient />);
    expect(rankBadges()).toEqual([
      "#1 · score 25",
      "#2 · score 12",
      "#3 · score 12",
      "#4 · score 8",
      "#5 · score 3",
    ]);
    // c (12) was added before e (12).
    const statements = screen
      .getAllByText(/^assumption [a-e]$/)
      .filter((el) => el.className.includes("flex-1"))
      .map((el) => el.textContent);
    expect(statements).toEqual([
      "assumption b",
      "assumption c",
      "assumption e",
      "assumption a",
      "assumption d",
    ]);
    // Ranking reads a copy — the stored order is untouched.
    expect(stored().map((a) => a.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("places each assumption in the right quadrant (3/3 counts as test-first)", () => {
    seed(
      asm("tl", 3, 3, { statement: "x".repeat(100) }),
      asm("tr", 4, 4),
      asm("bl", 2, 2),
      asm("br", 1, 5)
    );
    render(<RiskiestAssumptionClient />);
    expect(quadrant("Test first · high risk · low evidence")).toEqual([`· ${"x".repeat(80)}`]);
    expect(quadrant("Monitor · high risk · high evidence")).toEqual(["· assumption tr"]);
    expect(quadrant("Defer · low risk · low evidence")).toEqual(["· assumption bl"]);
    expect(quadrant("Solid · low risk · high evidence")).toEqual(["· assumption br"]);
  });

  it("marks empty quadrants", () => {
    seed(asm("a", 5, 1));
    render(<RiskiestAssumptionClient />);
    expect(quadrant("Solid · low risk · high evidence")).toEqual(["empty"]);
  });

  it("counts only untested assumptions with risk ≥ 4 as untested + risky", () => {
    seed(
      asm("a", 4, 1),
      asm("b", 5, 5),
      asm("c", 3, 1),
      asm("d", 5, 1, { status: "testing" }),
      asm("e", 2, 2, { status: "validated" }),
      asm("f", 5, 2, { status: "invalidated" })
    );
    render(<RiskiestAssumptionClient />);
    expect(stat("Total")).toBe("6");
    expect(stat("Untested + risky")).toBe("2");
    expect(stat("Validated")).toBe("1");
    expect(stat("Invalidated")).toBe("1");
  });
});

describe("Riskiest Assumption — editing a row", () => {
  it("commits a new risk on blur, clamped, and re-ranks", () => {
    seed(asm("a", 2, 2), asm("b", 3, 3));
    render(<RiskiestAssumptionClient />);
    expect(rankBadges()).toEqual(["#1 · score 9", "#2 · score 8"]);
    const risk = screen.getByLabelText("Risk for assumption #2"); // a
    type(risk, "9");
    expect(byId("a").riskLevel).toBe(2);
    fireEvent.blur(risk);
    expect(byId("a").riskLevel).toBe(5);
    expect(rankBadges()).toEqual(["#1 · score 20", "#2 · score 9"]);
    expect(h.log).toHaveBeenCalledWith("assumption_updated", { assumptionId: "a", riskLevel: 5 });
  });

  it("commits a new evidence level on blur", () => {
    seed(asm("a", 4, 2));
    render(<RiskiestAssumptionClient />);
    const evidence = screen.getByLabelText("Evidence for assumption #1");
    type(evidence, "4");
    fireEvent.blur(evidence);
    expect(byId("a").evidenceLevel).toBe(4);
    expect(rankBadges()).toEqual(["#1 · score 8"]);
  });

  // Bug: Number("") is 0, so clearing a level and tabbing away saved 1.
  it("restores the previous level when the field is cleared", () => {
    seed(asm("a", 4, 2));
    render(<RiskiestAssumptionClient />);
    const risk = screen.getByLabelText("Risk for assumption #1");
    type(risk, "");
    fireEvent.blur(risk);
    expect(byId("a").riskLevel).toBe(4);
    expect(risk).toHaveValue(4);
  });

  // Bug: every blur committed (and logged an update) even when nothing changed.
  it("does not write or log when a level is blurred unchanged", () => {
    seed(asm("a", 4, 2));
    render(<RiskiestAssumptionClient />);
    const before = useWorkspaceStore.getState().riskiestAssumptions;
    fireEvent.blur(screen.getByLabelText("Risk for assumption #1"));
    fireEvent.blur(screen.getByLabelText("Evidence for assumption #1"));
    expect(useWorkspaceStore.getState().riskiestAssumptions).toBe(before);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("changes the status from the dropdown", () => {
    seed(asm("a", 4, 2));
    render(<RiskiestAssumptionClient />);
    chooseStatus(screen.getByRole("combobox", { name: "Status for assumption #1" }), "Validated");
    expect(byId("a").status).toBe("validated");
    expect(stat("Validated")).toBe("1");
    expect(stat("Untested + risky")).toBe("0");
    expect(h.log).toHaveBeenCalledWith("assumption_updated", {
      assumptionId: "a",
      status: "validated",
    });
  });

  it("removes exactly the clicked assumption", () => {
    seed(asm("a", 2, 2), asm("b", 5, 1), asm("c", 4, 3));
    render(<RiskiestAssumptionClient />);
    // Ranked: b (25), c (12), a (8).
    fireEvent.click(screen.getByRole("button", { name: "Remove assumption #2" }));
    expect(stored().map((a) => a.id)).toEqual(["a", "b"]);
    expect(h.log).toHaveBeenCalledWith("assumption_removed", {
      assumptionId: "c",
      statement: "assumption c",
    });
  });

  it("shows the description and test idea under the statement", () => {
    seed(asm("a", 4, 2, { description: "from the pricing survey", testIdea: "smoke test" }));
    render(<RiskiestAssumptionClient />);
    expect(screen.getByText("from the pricing survey")).toBeInTheDocument();
    expect(screen.getByText("Test idea:").parentElement).toHaveTextContent("Test idea: smoke test");
  });
});

describe("Riskiest Assumption — test card", () => {
  it("opens a test card for an assumption and closes it", () => {
    seed(asm("a", 5, 1, { testIdea: "fake door" }), asm("b", 2, 4));
    render(<RiskiestAssumptionClient />);
    fireEvent.click(screen.getAllByRole("button", { name: /Generate test card/ })[0]);
    expect(screen.getByText("Test Card")).toBeInTheDocument();
    expect(screen.getByText("risk 5 · evidence 1 · score 25")).toBeInTheDocument();
    expect(screen.getAllByText("fake door").length).toBeGreaterThan(0);
    expect(h.log).toHaveBeenCalledWith("test_generated", {
      assumptionId: "a",
      statement: "assumption a",
      riskLevel: 5,
      evidenceLevel: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Close test card" }));
    expect(screen.queryByText("Test Card")).not.toBeInTheDocument();
  });

  it("prompts for a test when the assumption has no test idea", () => {
    seed(asm("a", 2, 4));
    render(<RiskiestAssumptionClient />);
    fireEvent.click(screen.getByRole("button", { name: /Generate test card/ }));
    expect(screen.getByText(/no test idea — write the cheapest experiment/)).toBeInTheDocument();
  });

  // Bug: the card kept a snapshot, so it showed stale levels after an edit
  // and stayed open for an assumption that had been deleted.
  it("follows edits to its assumption and closes when the assumption is deleted", () => {
    seed(asm("a", 2, 4));
    render(<RiskiestAssumptionClient />);
    fireEvent.click(screen.getByRole("button", { name: /Generate test card/ }));
    expect(screen.getByText("risk 2 · evidence 4 · score 4")).toBeInTheDocument();

    const risk = screen.getByLabelText("Risk for assumption #1");
    type(risk, "5");
    fireEvent.blur(risk);
    expect(screen.getByText("risk 5 · evidence 4 · score 10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove assumption #1" }));
    expect(screen.queryByText("Test Card")).not.toBeInTheDocument();
  });
});

describe("Riskiest Assumption — export", () => {
  it("exports the ranked list with scores", () => {
    seed(asm("a", 2, 2, { description: "d" }), asm("b", 5, 1, { testIdea: "t" }));
    render(<RiskiestAssumptionClient />);
    expect(h.exported.csvData?.headers).toEqual([
      "Statement",
      "Risk",
      "Evidence",
      "Score",
      "Status",
      "Test Idea",
      "Description",
    ]);
    expect(h.exported.csvData?.rows).toEqual([
      ["assumption b", 5, 1, 25, "untested", "t", ""],
      ["assumption a", 2, 2, 8, "untested", "", "d"],
    ]);
    expect(h.exported.jsonData).toEqual({ assumptions: stored() });
  });
});

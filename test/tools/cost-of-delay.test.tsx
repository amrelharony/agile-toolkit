import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Cost-of-Delay Tracker: adding an initiative (title, $/week, weeks), the
 * KPI strip, the ranked table, the CSV export and removal.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
  json: undefined as unknown,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: {
    csvData?: { headers: string[]; rows: (string | number)[][] };
    jsonData?: unknown;
  }) => {
    exported.csv = p.csvData;
    exported.json = p.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
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

import { CostOfDelayClient } from "@/app/(tools)/cost-of-delay/cost-of-delay-client";
import { generateCostOfDelayPrompts } from "@/lib/ai-prompts/cost-of-delay";

const row = (
  id: string,
  title: string,
  perWeekUsd: number,
  weeksDelayed: number,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "cost-of-delay",
  title,
  score: perWeekUsd * weeksDelayed,
  fields: { perWeekUsd, weeksDelayed, totalCost: perWeekUsd * weeksDelayed },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...extra,
});

const rows = () => useWorkspaceStore.getState().prioritizations ?? [];
const codRows = () => rows().filter((r) => r.framework === "cost-of-delay");
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));
const kpi = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const tableRows = () => {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) =>
      within(tr)
        .getAllByRole("cell")
        .slice(0, 4)
        .map((td) => td.textContent?.trim())
    );
};

beforeEach(() => {
  exported.csv = undefined;
  exported.json = undefined;
  window.history.replaceState({}, "", "/cost-of-delay");
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("Cost of Delay: empty state", () => {
  it("shows zeroed KPIs and no table or chart", () => {
    render(<CostOfDelayClient />);
    expect(kpi("Total CoD this period")).toBe("$0");
    expect(kpi("Items tracked")).toBe("0");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Top 10 by total cost")).toBeNull();
  });

  it("ignores other frameworks' rows", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "w1",
          framework: "wsjf",
          title: "WSJF row",
          score: 9,
          status: "scored",
          updatedAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    });
    render(<CostOfDelayClient />);
    expect(kpi("Items tracked")).toBe("0");
    expect(screen.queryByText("WSJF row")).toBeNull();
  });
});

describe("Cost of Delay: adding an initiative", () => {
  it("saves $/week × weeks as the total, scored under its own framework, and clears the form", () => {
    render(<CostOfDelayClient />);
    type("Initiative title", "  Migrate billing  ");
    type("Cost per week in dollars", "10000");
    type("Weeks delayed", "4");
    add();

    expect(codRows()).toHaveLength(1);
    expect(codRows()[0]).toMatchObject({
      framework: "cost-of-delay",
      title: "Migrate billing",
      score: 40000,
      status: "scored",
      fields: { perWeekUsd: 10000, weeksDelayed: 4, totalCost: 40000 },
    });
    expect(screen.getByLabelText("Initiative title")).toHaveValue("");
    expect(screen.getByLabelText("Cost per week in dollars")).toHaveValue(null);
    expect(screen.getByLabelText("Weeks delayed")).toHaveValue(null);
    expect(kpi("Total CoD this period")).toBe("$40,000");
    expect(kpi("Items tracked")).toBe("1");
    expect(tableRows()).toEqual([["Migrate billing", "$10,000", "4", "$40,000"]]);
  });

  it("does nothing without a title (blank or whitespace only)", () => {
    render(<CostOfDelayClient />);
    type("Cost per week in dollars", "500");
    add();
    type("Initiative title", "   ");
    add();
    expect(codRows()).toEqual([]);
    // The numbers the user typed are kept for the next try.
    expect(screen.getByLabelText("Cost per week in dollars")).toHaveValue(500);
  });

  it("treats blank numbers as 0 and clamps negatives to 0", () => {
    render(<CostOfDelayClient />);
    type("Initiative title", "Blank numbers");
    add();
    type("Initiative title", "Negative");
    type("Cost per week in dollars", "-2500");
    type("Weeks delayed", "3");
    add();

    const [blank, negative] = codRows();
    expect(blank).toMatchObject({
      score: 0,
      fields: { perWeekUsd: 0, weeksDelayed: 0, totalCost: 0 },
    });
    expect(negative).toMatchObject({
      score: 0,
      fields: { perWeekUsd: 0, weeksDelayed: 3, totalCost: 0 },
    });
    expect(Number.isFinite(negative.score)).toBe(true);
  });

  it("keeps fractional inputs and caps a very long title at 200 characters", () => {
    render(<CostOfDelayClient />);
    type("Initiative title", "x".repeat(260));
    type("Cost per week in dollars", "1500.5");
    type("Weeks delayed", "2");
    add();
    expect(codRows()[0].title).toHaveLength(200);
    expect(codRows()[0].score).toBe(3001);
  });
});

describe("Cost of Delay: the list", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "Small", 1000, 2),
        row("b", "Big", 20000, 3),
        row("c", "Middle", 5000, 3),
      ],
    });
  });

  it("ranks by total cost, highest first, and totals the KPI", () => {
    render(<CostOfDelayClient />);
    expect(screen.getByText("Items (3)")).toBeInTheDocument();
    expect(tableRows()).toEqual([
      ["Big", "$20,000", "3", "$60,000"],
      ["Middle", "$5,000", "3", "$15,000"],
      ["Small", "$1,000", "2", "$2,000"],
    ]);
    expect(kpi("Total CoD this period")).toBe("$77,000");
    expect(kpi("Items tracked")).toBe("3");
    expect(screen.getByText("Top 10 by total cost")).toBeInTheDocument();
  });

  it("does not reorder the stored rows when it sorts the table", () => {
    render(<CostOfDelayClient />);
    expect(codRows().map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("removes exactly the row whose trash button was clicked", () => {
    render(<CostOfDelayClient />);
    const middle = screen.getByText("Middle").closest("tr")!;
    fireEvent.click(within(middle).getByRole("button", { name: "Remove initiative" }));
    expect(codRows().map((r) => r.id)).toEqual(["a", "b"]);
    expect(kpi("Total CoD this period")).toBe("$62,000");
  });

  it("exports every row to CSV with its inputs and total", () => {
    render(<CostOfDelayClient />);
    expect(exported.csv?.headers).toEqual([
      "Title",
      "Per week ($)",
      "Weeks delayed",
      "Total cost ($)",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Small", 1000, 2, 2000],
      ["Big", 20000, 3, 60000],
      ["Middle", 5000, 3, 15000],
    ]);
    expect(exported.json).toHaveLength(3);
  });

  it("shows 0 for a row whose inputs are missing instead of NaN", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "legacy",
          framework: "cost-of-delay",
          title: "Legacy row",
          status: "scored",
          updatedAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    });
    render(<CostOfDelayClient />);
    expect(tableRows()).toEqual([["Legacy row", "$0", "0", "$0"]]);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe("Cost of Delay: rows written by the CD3 agent actions", () => {
  // Bug: tool.cost_of_delay.score_and_persist stores score = CD3 (cost ÷ job
  // size) and keeps the total in fields.totalCost "so rows added via the agent
  // surface display identically", but the table, KPI and chart read `score`.
  // A $10,000/week × 4-week row with job size 8 showed a $5,000 total.
  const agentRow = (): PrioritizationItem => ({
    id: "agent",
    framework: "cost-of-delay",
    title: "Agent-scored",
    score: 5000,
    fields: { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8, totalCost: 40000 },
    status: "scored",
    updatedAt: "2026-10-01T09:00:00.000Z",
  });

  it("shows the total cost of delay ($/week × weeks), not the CD3 ratio", () => {
    useWorkspaceStore.setState({
      prioritizations: [agentRow(), row("ui", "From the form", 3000, 5)],
    });
    render(<CostOfDelayClient />);
    expect(tableRows()).toEqual([
      ["Agent-scored", "$10,000", "4", "$40,000"],
      ["From the form", "$3,000", "5", "$15,000"],
    ]);
    expect(kpi("Total CoD this period")).toBe("$55,000");
    expect(exported.csv?.rows[0]).toEqual(["Agent-scored", 10000, 4, 40000]);
  });

  // Same bug in the AI prompt's item table, whose Total column read `score`.
  it("gives the AI prompt the total cost too", () => {
    const [prompt] = generateCostOfDelayPrompts({ items: [agentRow()], totalCost: 40000 });
    const line = prompt.prompt.split("\n").find((l) => l.includes("Agent-scored"));
    expect(line).toContain("$40,000");
    expect(line).not.toContain("$5,000");
  });
});

describe("Cost of Delay: AI prompt", () => {
  it("has no prompt for an empty tracker", () => {
    expect(generateCostOfDelayPrompts({ items: [], totalCost: 0 })).toEqual([]);
  });

  it("lists the items and the period total", () => {
    const [prompt] = generateCostOfDelayPrompts({
      items: [row("a", "Migrate billing", 10000, 4)],
      totalCost: 40000,
    });
    expect(prompt.id).toBe("cod-narrative");
    expect(prompt.prompt).toContain("Total CoD this period: $40,000");
    const line = prompt.prompt.split("\n").find((l) => l.includes("Migrate billing"))!;
    expect(line).toContain("$10,000");
    expect(line).toContain("$40,000");
  });
});

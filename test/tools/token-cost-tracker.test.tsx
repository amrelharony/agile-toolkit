import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TokenSpend } from "@/lib/stores/workspace-types";

/**
 * Token-Cost Tracker: logging spend (typed cost, price-table cost, zero
 * cost), the totals / last-30-days / projection KPIs and the over-budget
 * banner, the monthly budget field, the daily chart data, the per-feature
 * breakdown, the spend log and the CSV export.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };
type Day = { date: string; cost: number; tokens: number };

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const chart = vi.hoisted(() => ({
  data: undefined as Day[] | undefined,
  dailyBudgetUsd: undefined as number | undefined,
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/app/(tools)/token-cost-tracker/charts", () => ({
  DailySpendChart: ({ data, dailyBudgetUsd }: { data: Day[]; dailyBudgetUsd: number }) => {
    chart.data = data;
    chart.dailyBudgetUsd = dailyBudgetUsd;
    return <div data-testid="daily-chart" />;
  },
}));

import { TokenCostTrackerClient } from "@/app/(tools)/token-cost-tracker/token-cost-tracker-client";

const entry = (
  id: string,
  date: string,
  costUsd: number,
  extra: Partial<TokenSpend> = {}
): TokenSpend => ({
  id,
  feature: "Search",
  model: "custom",
  date,
  inputTokens: 100,
  outputTokens: 50,
  costUsd,
  ...extra,
});

const spend = () => useWorkspaceStore.getState().tokenSpend ?? [];
/** A KPI tile ("Monthly budget" is also a section title). */
const kpi = (label: string) =>
  screen.getByText(label, { selector: "div.tracking-wider" }).parentElement!;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const logSpend = () => fireEvent.click(screen.getByRole("button", { name: "Log" }));
const budgetField = () => screen.getByLabelText("Monthly budget USD");
function setBudget(value: string) {
  fireEvent.change(budgetField(), { target: { value } });
  fireEvent.blur(budgetField());
}

beforeEach(() => {
  exported.csv = undefined;
  chart.data = undefined;
  chart.dailyBudgetUsd = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ tokenSpend: [] });
  // "Today" is Sun 18 Oct 2026, noon local time. Only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Token-Cost Tracker: empty state", () => {
  it("shows zero spend and hides the chart, breakdown and log", () => {
    render(<TokenCostTrackerClient />);
    setBudget("1000");
    expect(kpi("Total spend")).toHaveTextContent("$0.00");
    expect(kpi("Last 30d")).toHaveTextContent("$0.00");
    expect(kpi("Projected next 30d")).toHaveTextContent("$0.00");
    expect(kpi("Monthly budget")).toHaveTextContent("$1000");
    expect(screen.queryByText(/exceeds monthly budget/)).toBeNull();
    expect(screen.queryByText("Daily spend")).toBeNull();
    expect(screen.queryByText("By feature")).toBeNull();
    expect(screen.queryByText(/^Spend log/)).toBeNull();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-18");
  });
});

describe("Token-Cost Tracker: logging spend", () => {
  it("logs a typed cost and keeps feature, model and date for the next entry", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "  Search ");
    type("Model", " in-house-llm ");
    type("Date", "2026-10-17");
    type("Input tokens", "1200");
    type("Output tokens", "300");
    type("Cost USD", "0.42");
    logSpend();

    expect(spend()).toHaveLength(1);
    expect(spend()[0]).toMatchObject({
      feature: "Search",
      model: "in-house-llm",
      date: "2026-10-17",
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.42,
    });
    expect(history.log).toHaveBeenCalledWith("spend_logged", { feature: "Search", costUsd: 0.42 });
    expect(screen.getByLabelText("Feature")).toHaveValue("  Search ");
    expect(screen.getByLabelText("Model")).toHaveValue(" in-house-llm ");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-17");
    expect(screen.getByLabelText("Input tokens")).toHaveValue(null);
    expect(screen.getByLabelText("Output tokens")).toHaveValue(null);
    expect(screen.getByLabelText("Cost USD")).toHaveValue(null);
  });

  it("records missing token counts as zero", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "in-house-llm");
    type("Cost USD", "1");
    logSpend();
    expect(spend()[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 1 });
  });

  it("asks for the model after the feature", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Cost USD", "1");
    logSpend();
    expect(spend()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the model that was used.");
  });

  it("rejects a negative cost", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "claude-sonnet-4-6");
    type("Input tokens", "1000");
    type("Output tokens", "500");
    type("Cost USD", "-1");
    logSpend();
    expect(spend()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Cost can't be negative.");
  });

  it("previews and fills the cost from the price table, matching the id case-insensitively", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "CLAUDE-SONNET-4-6");
    type("Input tokens", "1000");
    type("Output tokens", "500");
    // 1k input at $0.003 + 0.5k output at $0.015 per 1k.
    expect(screen.getByText(/leave Cost blank to auto-fill with \$0\.0105/)).toBeInTheDocument();
    expect(screen.getByLabelText("Cost USD")).toHaveAttribute(
      "placeholder",
      "Cost USD (auto ≈ $0.0105)"
    );
    logSpend();
    expect(spend()[0].costUsd).toBeCloseTo(0.0105, 10);
  });

  it("accepts a unique partial model id but not an ambiguous one", () => {
    render(<TokenCostTrackerClient />);
    type("Input tokens", "1000");
    type("Output tokens", "1000");
    type("Model", "sonnet-4-6");
    expect(screen.getByText(/Price-table match/)).toBeInTheDocument();
    type("Model", "gpt-4");
    expect(screen.queryByText(/Price-table match/)).toBeNull();
    expect(screen.getByLabelText("Cost USD")).toHaveAttribute("placeholder", "Cost USD");
  });

  // Bug: a typed $0 (free tier, credits) was treated as "blank" and replaced
  // with the price-table estimate, although a typed value is an override.
  it("keeps a typed zero cost for a priced model", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "claude-sonnet-4-6");
    type("Input tokens", "1000");
    type("Output tokens", "500");
    type("Cost USD", "0");
    logSpend();
    expect(spend()).toHaveLength(1);
    expect(spend()[0].costUsd).toBe(0);
  });

  it("logs a zero cost for a model that isn't in the price table", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "in-house-llm");
    type("Cost USD", "0");
    logSpend();
    expect(spend()[0].costUsd).toBe(0);
  });
});

describe("Token-Cost Tracker: KPIs and the budget", () => {
  const seed = () =>
    useWorkspaceStore.setState({
      tokenSpend: [
        entry("today", "2026-10-18", 10),
        // 29 days before today: the first day of the 30-day window.
        entry("window-start", "2026-09-19", 20),
        // 30 days before: just outside it.
        entry("too-old", "2026-09-18", 100),
        // A typo'd future date counts toward the total only.
        entry("future", "2026-11-01", 1000),
      ],
    });

  it("totals everything, and windows the last 30 days on both sides", () => {
    seed();
    render(<TokenCostTrackerClient />);
    setBudget("1000");
    expect(kpi("Total spend")).toHaveTextContent("$1130.00");
    expect(kpi("Last 30d")).toHaveTextContent("$30.00");
    // The window is fully observed, so the projection equals it.
    expect(kpi("Projected next 30d")).toHaveTextContent("$30.00");
    expect(screen.queryByText(/exceeds monthly budget/)).toBeNull();
  });

  it("projects a part-month's daily rate over 30 days and flags going over budget", () => {
    useWorkspaceStore.setState({
      tokenSpend: [entry("a", "2026-10-14", 100), entry("b", "2026-10-18", 50)],
    });
    render(<TokenCostTrackerClient />);
    setBudget("1000");
    // 5 days observed (14th..18th inclusive): $150 / 5 × 30.
    const projected = kpi("Projected next 30d");
    expect(projected).toHaveTextContent("$900.00");
    expect(within(projected).getByText("$900.00")).not.toHaveClass("text-danger");

    setBudget("800");
    expect(within(kpi("Projected next 30d")).getByText("$900.00")).toHaveClass("text-danger");
    expect(
      screen.getByText(/Projected spend \$900\.00 exceeds monthly budget \$/)
    ).toHaveTextContent("Projected spend $900.00 exceeds monthly budget $800.");
  });

  it("commits the budget on blur or Enter and reverts junk", () => {
    render(<TokenCostTrackerClient />);
    setBudget("1500");
    expect(kpi("Monthly budget")).toHaveTextContent("$1500");

    budgetField().focus();
    fireEvent.change(budgetField(), { target: { value: "2000" } });
    // Not committed while typing.
    expect(kpi("Monthly budget")).toHaveTextContent("$1500");
    fireEvent.keyDown(budgetField(), { key: "Enter" });
    expect(budgetField()).not.toHaveFocus();
    expect(kpi("Monthly budget")).toHaveTextContent("$2000");

    setBudget("");
    expect(budgetField()).toHaveValue(2000);
    expect(kpi("Monthly budget")).toHaveTextContent("$2000");

    setBudget("0");
    expect(kpi("Monthly budget")).toHaveTextContent("$0");
  });

  // Bug: a negative budget was neither committed nor reverted, so the field
  // showed -50 while the KPI and the banner kept using the old budget.
  it("reverts a negative budget instead of leaving it in the field", () => {
    render(<TokenCostTrackerClient />);
    setBudget("1000");
    setBudget("-50");
    expect(kpi("Monthly budget")).toHaveTextContent("$1000");
    expect(budgetField()).toHaveValue(1000);
  });
});

describe("Token-Cost Tracker: chart, breakdown and log", () => {
  const seed = () =>
    useWorkspaceStore.setState({
      tokenSpend: [
        entry("s1", "2026-10-02", 1.5, { feature: "Chat", inputTokens: 1000, outputTokens: 500 }),
        entry("s2", "2026-10-01", 0.25, { feature: "Search", inputTokens: 200, outputTokens: 0 }),
        entry("s3", "2026-10-02", 3, { feature: "Search", inputTokens: 3000, outputTokens: 1000 }),
      ],
    });

  it("rolls spend up per day, oldest first, against a daily budget line", async () => {
    seed();
    render(<TokenCostTrackerClient />);
    setBudget("900");
    expect(screen.getByText("Daily spend")).toBeInTheDocument();
    await screen.findByTestId("daily-chart");
    expect(chart.data).toEqual([
      { date: "2026-10-01", cost: 0.25, tokens: 200 },
      { date: "2026-10-02", cost: 4.5, tokens: 5500 },
    ]);
    expect(chart.dailyBudgetUsd).toBe(30);
  });

  it("breaks spend down by feature, biggest first", () => {
    seed();
    render(<TokenCostTrackerClient />);
    // The breakdown is the page's only list (the log is a table).
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Search$3.25", "Chat$1.50"]);
  });

  it("lists entries newest first and removes the one clicked", () => {
    seed();
    render(<TokenCostTrackerClient />);
    expect(screen.getByText("Spend log (3)")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "2026-10-02",
      "2026-10-02",
      "2026-10-01",
    ]);
    expect(within(rows[0]).getAllByRole("cell")[3].textContent).toBe((1500).toLocaleString());
    expect(within(rows[0]).getAllByRole("cell")[4].textContent).toBe("$1.50");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove spend entry: Search on 2026-10-01" })
    );
    expect(spend().map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(history.log).toHaveBeenCalledWith("spend_removed", { id: "s2" });
    expect(kpi("Total spend")).toHaveTextContent("$4.50");
  });

  it("exports every entry to CSV", () => {
    seed();
    render(<TokenCostTrackerClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Feature",
      "Model",
      "Input tokens",
      "Output tokens",
      "Cost USD",
    ]);
    expect(exported.csv?.rows[0]).toEqual(["2026-10-02", "Chat", "custom", 1000, 500, 1.5]);
    expect(exported.csv?.rows).toHaveLength(3);
  });

  // Bug: a stored entry without a usable cost was already kept out of the
  // totals and shown as "—" in the log, but it turned the By-feature line
  // into "$NaN" and the chart's day into NaN.
  it("keeps an entry without a usable cost out of the breakdown and chart sums", async () => {
    useWorkspaceStore.setState({
      tokenSpend: [
        entry("ok", "2026-10-02", 2, { feature: "Chat" }),
        entry("broken", "2026-10-02", Number.NaN, { feature: "Chat" }),
      ],
    });
    render(<TokenCostTrackerClient />);
    expect(kpi("Total spend")).toHaveTextContent("$2.00");
    expect(screen.getByRole("listitem")).toHaveTextContent("Chat$2.00");
    const broken = within(screen.getByRole("table")).getAllByRole("row")[2];
    expect(within(broken).getAllByRole("cell")[4]).toHaveTextContent("—");
    await screen.findByTestId("daily-chart");
    expect(chart.data).toEqual([{ date: "2026-10-02", cost: 2, tokens: 300 }]);
  });
});

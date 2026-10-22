import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * $100 Test: adding items, allocating money (each item capped at the money
 * other items left), the Allocated / Remaining KPIs and the "distribute
 * fully" banner, the order by allocation, removing, and the CSV export.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

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

import { HundredDollarTestClient } from "@/app/(tools)/hundred-dollar-test/hundred-dollar-test-client";

const item = (
  id: string,
  title: string,
  allocation: number,
  framework: PrioritizationItem["framework"] = "hundred-dollar"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score: allocation,
  fields: { allocation },
  status: "open",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const all = () => useWorkspaceStore.getState().prioritizations ?? [];
const rows = () => all().filter((x) => x.framework === "hundred-dollar");
const stored = (id: string) => all().find((x) => x.id === id);
const kpi = (label: string) => screen.getByText(label).parentElement!;
const amount = (title: string) => screen.getByLabelText(`Dollars allocated to ${title}`);
const allocate = (title: string, value: string) =>
  fireEvent.change(amount(title), { target: { value } });
const order = () =>
  screen.getAllByRole("listitem").map((li) => li.querySelector(".truncate")?.textContent);
const banner = () => screen.queryByText(/to finalise|over budget/);

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prioritizations: [] });
});

describe("$100 Test: empty state", () => {
  it("shows the whole $100 remaining and no allocations list or banner", () => {
    render(<HundredDollarTestClient />);
    expect(kpi("Items")).toHaveTextContent("0");
    expect(kpi("Allocated")).toHaveTextContent("$0.00");
    expect(kpi("Remaining")).toHaveTextContent("$100.00");
    expect(screen.queryByText("Allocations")).toBeNull();
    expect(banner()).toBeNull();
  });
});

describe("$100 Test: adding items", () => {
  it("needs a title", () => {
    render(<HundredDollarTestClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Item to vote on"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("adds an item with nothing allocated and asks to distribute the budget", () => {
    render(<HundredDollarTestClient />);
    fireEvent.change(screen.getByLabelText("Item to vote on"), {
      target: { value: "  Search  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      framework: "hundred-dollar",
      title: "Search",
      score: 0,
      fields: { allocation: 0 },
      status: "open",
    });
    expect(screen.getByLabelText("Item to vote on")).toHaveValue("");
    expect(kpi("Items")).toHaveTextContent("1");
    expect(amount("Search")).toHaveValue(0);
    expect(banner()).toHaveTextContent(
      "Allocate the remaining $100.00 to finalise — the $100 test only works when the budget is fully distributed."
    );
  });
});

describe("$100 Test: allocating", () => {
  it("stores the amount as both allocation and score, and updates the KPIs", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("a", "Search", 0), item("b", "Exports", 0)],
    });
    render(<HundredDollarTestClient />);
    allocate("Search", "40");
    expect(stored("a")).toMatchObject({ score: 40, fields: { allocation: 40 } });
    expect(history.log).toHaveBeenCalledWith("allocation_changed", { id: "a", n: 40 });
    expect(kpi("Allocated")).toHaveTextContent("$40.00");
    expect(kpi("Remaining")).toHaveTextContent("$60.00");
    expect(banner()).toHaveTextContent("Allocate the remaining $60.00 to finalise");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops the banner and turns Remaining green once all $100 is given out", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("a", "Search", 60), item("b", "Exports", 0)],
    });
    render(<HundredDollarTestClient />);
    allocate("Exports", "40");
    expect(within(kpi("Remaining")).getByText("$0.00")).toHaveClass("text-success");
    expect(banner()).toBeNull();
  });

  it("treats cent-level float drift as fully allocated", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("a", "A", 0.1), item("b", "B", 0.2), item("c", "C", 99.7)],
    });
    render(<HundredDollarTestClient />);
    expect(kpi("Allocated")).toHaveTextContent("$100.00");
    expect(kpi("Remaining")).toHaveTextContent("$0.00");
    expect(banner()).toBeNull();
  });

  it("caps a single item at $100 and explains why", () => {
    useWorkspaceStore.setState({ prioritizations: [item("a", "Search", 0)] });
    render(<HundredDollarTestClient />);
    allocate("Search", "150");
    expect(stored("a")?.fields?.allocation).toBe(100);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The whole budget is $100, so Search got $100.00, not $150.00."
    );
  });

  it("takes text that isn't a number as $0", () => {
    useWorkspaceStore.setState({ prioritizations: [item("a", "Search", 30)] });
    render(<HundredDollarTestClient />);
    allocate("Search", "");
    expect(stored("a")?.fields?.allocation).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps cents as typed", () => {
    useWorkspaceStore.setState({ prioritizations: [item("a", "Search", 0)] });
    render(<HundredDollarTestClient />);
    allocate("Search", "33.33");
    expect(stored("a")?.fields?.allocation).toBe(33.33);
    expect(kpi("Remaining")).toHaveTextContent("$66.67");
  });

  it("only counts this tool's items against the budget", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("a", "Search", 0), item("w", "WSJF row", 90, "wsjf")],
    });
    render(<HundredDollarTestClient />);
    allocate("Search", "100");
    expect(stored("a")?.fields?.allocation).toBe(100);
    expect(kpi("Items")).toHaveTextContent("1");
  });

  it("flags stored allocations that add up to more than $100", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("a", "Search", 70), item("b", "Exports", 50)],
    });
    render(<HundredDollarTestClient />);
    expect(kpi("Allocated")).toHaveTextContent("$120.00");
    expect(within(kpi("Remaining")).getByText(/20\.00/)).toHaveClass("text-danger");
    expect(banner()).toHaveTextContent(
      "You’re over budget by $20.00. Reduce allocations to bring the total to $100."
    );
    // Nothing is left for another raise.
    allocate("Exports", "60");
    expect(stored("b")?.fields?.allocation).toBe(30);
  });
});

describe("$100 Test: the allocations list", () => {
  it("orders items by allocation, biggest first", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("a", "Search", 10), item("b", "Exports", 50), item("c", "SSO", 0)],
    });
    render(<HundredDollarTestClient />);
    expect(order()).toEqual(["Exports", "Search", "SSO"]);
    allocate("SSO", "40");
    expect(order()).toEqual(["Exports", "SSO", "Search"]);
  });

  it("removes only the item whose bin was clicked", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        item("a", "Search", 30),
        item("b", "Exports", 50),
        item("w", "WSJF row", 5, "wsjf"),
      ],
    });
    render(<HundredDollarTestClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Search" }));
    expect(all().map((x) => x.id)).toEqual(["b", "w"]);
    expect(history.log).toHaveBeenCalledWith("item_removed", { id: "a" });
    expect(kpi("Remaining")).toHaveTextContent("$50.00");
  });

  it("exports one CSV row per item with its allocation", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        item("a", "Search", 30),
        { ...item("b", "Exports", 0), fields: undefined },
        item("w", "WSJF row", 5, "wsjf"),
      ],
    });
    render(<HundredDollarTestClient />);
    expect(exported.csv).toEqual({
      headers: ["Title", "Allocation"],
      rows: [
        ["Search", 30],
        ["Exports", 0],
      ],
    });
  });
});

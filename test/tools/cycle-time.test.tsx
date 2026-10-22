import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Cycle Time Analyzer: the pure helpers (day deltas, nearest-rank
 * percentiles, std dev, buckets), the scatter text alternative, the
 * tool-local store, and the client (stats row, work-items table edits,
 * add/remove/reset, SLE tab, CSV export rows).
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
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

import { CycleTimeClient } from "@/app/(tools)/cycle-time/cycle-time-client";
import { useCycleTimeStore } from "@/app/(tools)/cycle-time/use-cycle-time-store";
import {
  BUCKETS,
  calcCycleTime,
  percentile,
  round,
  stdDev,
} from "@/app/(tools)/cycle-time/helpers";
import { histogramText, scatterText } from "@/app/(tools)/cycle-time/chart-text";
import type { WorkItem } from "@/app/(tools)/cycle-time/types";

const item = (id: string, name: string, startDate: string, endDate: string): WorkItem => ({
  id,
  name,
  startDate,
  endDate,
});

/** Cycle times 2, 3, 5, 10 days plus one unfinished item. */
const SEED: WorkItem[] = [
  item("a", "Login", "2026-10-01", "2026-10-03"),
  item("b", "Search", "2026-10-01", "2026-10-04"),
  item("c", "Billing", "2026-10-01", "2026-10-06"),
  item("d", "Export", "2026-10-01", "2026-10-11"),
  item("e", "Reports", "2026-10-02", ""),
];

const items = () => useCycleTimeStore.getState().items;
const seed = (list: WorkItem[]) => useCycleTimeStore.setState({ items: list });

/** The text of the cycle-time StatCard whose label is `label`. */
const stat = (label: string) => screen.getByText(label).parentElement!.textContent;

const openTab = (name: string | RegExp) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  seed([item("default:item-1", "", "", "")]);
});

describe("cycle-time helpers", () => {
  it("counts whole days between two dates", () => {
    expect(calcCycleTime("2026-10-01", "2026-10-08")).toBe(7);
    expect(calcCycleTime("2026-10-01", "2026-10-01")).toBe(0);
    // Across a month and a year boundary.
    expect(calcCycleTime("2026-12-30", "2027-01-02")).toBe(3);
    // A 25-hour DST day (where the zone has one) still rounds to whole days.
    expect(calcCycleTime("2026-10-24", "2026-11-03")).toBe(10);
  });

  it("returns null for missing, invalid or reversed dates", () => {
    expect(calcCycleTime("", "2026-10-08")).toBeNull();
    expect(calcCycleTime("2026-10-01", "")).toBeNull();
    expect(calcCycleTime("garbage", "2026-10-08")).toBeNull();
    expect(calcCycleTime("2026-10-08", "2026-10-01")).toBeNull();
  });

  it("uses nearest-rank percentiles on sorted data", () => {
    const sorted = [2, 3, 5, 10];
    expect(percentile(sorted, 50)).toBe(3);
    expect(percentile(sorted, 75)).toBe(5);
    expect(percentile(sorted, 85)).toBe(10);
    expect(percentile(sorted, 1)).toBe(2);
    expect(percentile(sorted, 100)).toBe(10);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([], 85)).toBe(0);
  });

  it("computes the population standard deviation", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(stdDev([5])).toBe(0);
    expect(stdDev([])).toBe(0);
    expect(stdDev([3, 3, 3])).toBe(0);
  });

  it("rounds to the requested number of decimals", () => {
    expect(round(3.14159)).toBe(3.1);
    expect(round(3.14159, 3)).toBe(3.142);
    expect(round(7, 0)).toBe(7);
  });

  it("puts every whole number of days in exactly one bucket", () => {
    for (let d = 0; d <= 60; d++) {
      expect(BUCKETS.filter((b) => d >= b.min && d <= b.max)).toHaveLength(1);
    }
    expect(BUCKETS.find((b) => 0 >= b.min && 0 <= b.max)?.label).toBe("≤1 day");
    expect(BUCKETS.find((b) => 400 >= b.min && 400 <= b.max)?.label).toBe("15+ days");
  });
});

describe("cycle-time chart text", () => {
  it("says so when no item has a cycle time", () => {
    expect(scatterText([], { median: 0, p85: 0 }).summary).toBe("No items with a cycle time yet.");
    expect(histogramText([], { median: 0, p85: 0 }, 0).summary).toBe(
      "No items with a cycle time yet."
    );
  });

  it("describes a single scatter point", () => {
    const text = scatterText([{ idx: 1, cycleTime: 1, name: "Login" }], { median: 1, p85: 1 });
    expect(text.summary).toBe("One item, with a cycle time of 1 day.");
    expect(text.table.rows).toEqual([[1, "Login", 1]]);
  });

  it("describes the scatter range and labels blank names Untitled", () => {
    const text = scatterText(
      [
        { idx: 1, cycleTime: 2, name: "Login" },
        { idx: 2, cycleTime: 9, name: "   " },
        { idx: 3, cycleTime: 4, name: "Billing" },
      ],
      { median: 4, p85: 9 }
    );
    expect(text.summary).toBe(
      "Cycle times of 3 items, in the order added, range from 2 to 9 days; the median is 4 days and 85% took 9 days or less."
    );
    expect(text.table.columns).toEqual(["Item #", "Item", "Cycle time (days)"]);
    expect(text.table.rows[1]).toEqual([2, "Untitled", 9]);
  });

  it("names the first of tied tallest histogram bars", () => {
    const text = histogramText(
      [
        { bucket: "≤1 day", count: 2 },
        { bucket: "2 days", count: 2 },
      ],
      { median: 1, p85: 2 },
      2
    );
    expect(text.summary).toMatch(/most common range is ≤1 day \(2 items\)\.$/);
    expect(text.table.rows).toEqual([
      ["≤1 day", 2],
      ["2 days", 2],
    ]);
  });
});

describe("cycle-time store", () => {
  it("adds, updates, removes and resets items", () => {
    const s = useCycleTimeStore.getState();
    s.addItem();
    expect(items()).toHaveLength(2);
    const added = items()[1];
    expect(added).toMatchObject({ name: "", startDate: "", endDate: "" });
    s.updateItem(added.id, { name: "Login", startDate: "2026-10-01" });
    expect(items()[1]).toMatchObject({ name: "Login", startDate: "2026-10-01" });
    expect(items()[0].name).toBe("");
    s.removeItem("default:item-1");
    expect(items().map((i) => i.id)).toEqual([added.id]);
    s.reset();
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ name: "", startDate: "", endDate: "" });
    expect(items()[0].id).not.toBe(added.id);
  });
});

describe("Cycle Time Analyzer: empty state", () => {
  it("prompts for dates and shows zero stats", () => {
    render(<CycleTimeClient />);
    expect(screen.getByText("Add items with start and end dates to see analysis")).toBeVisible();
    expect(screen.getByText("0 / 1 with cycle time")).toBeInTheDocument();
    expect(stat("Average")).toBe("Average0days");
    expect(stat("85th Percentile")).toBe("85th Percentile0days");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("disables removing the only item", () => {
    render(<CycleTimeClient />);
    expect(screen.getByRole("button", { name: "Remove item" })).toBeDisabled();
  });
});

describe("Cycle Time Analyzer: seeded items", () => {
  beforeEach(() => seed(SEED.map((i) => ({ ...i }))));

  it("derives average, median, P85 and std dev from finished items only", () => {
    render(<CycleTimeClient />);
    expect(screen.getByText("4 / 5 with cycle time")).toBeInTheDocument();
    expect(stat("Average")).toBe("Average5days");
    expect(stat("Median (50th %ile)")).toMatch(/^Median \(50th %ile\)3days95% CI \[/);
    expect(stat("85th Percentile")).toMatch(/^85th Percentile10days95% CI \[/);
    expect(stat("Std Deviation")).toBe("Std Deviation3.1days");
  });

  it("omits the bootstrap CI below 3 finished items", () => {
    seed(SEED.slice(0, 2).map((i) => ({ ...i })));
    render(<CycleTimeClient />);
    expect(stat("Median (50th %ile)")).toBe("Median (50th %ile)2days");
  });

  it("shows each row's cycle time, or a dash when unfinished", () => {
    render(<CycleTimeClient />);
    const row = (name: string) => screen.getByDisplayValue(name).closest("tr")!;
    expect(within(row("Login")).getByText("2d")).toBeInTheDocument();
    expect(within(row("Export")).getByText("10d")).toBeInTheDocument();
    expect(within(row("Reports")).getByText("—")).toBeInTheDocument();
  });

  it("summarises the histogram from the finished items", () => {
    render(<CycleTimeClient />);
    expect(
      screen.getByText(
        "4 items: half finished within 3 days, 85% within 10 and 95% within 10; the most common range is 2 days (1 item)."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("P50 (3d)")).toBeInTheDocument();
    expect(screen.getByText("P85 (10d)")).toBeInTheDocument();
  });

  it("exports one CSV row per item with N/A for unfinished ones", () => {
    seed([...SEED.slice(0, 1), item("x", "", "2026-10-01", "")]);
    render(<CycleTimeClient />);
    expect(exported.csv?.headers).toEqual([
      "Item Name",
      "Description",
      "Start Date",
      "End Date",
      "Cycle Time (days)",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Login", "", "2026-10-01", "2026-10-03", 2],
      ["(unnamed)", "", "2026-10-01", "", "N/A"],
    ]);
  });

  it("commits a renamed item on blur", () => {
    render(<CycleTimeClient />);
    const name = screen.getByDisplayValue("Login");
    fireEvent.change(name, { target: { value: "Sign-in" } });
    expect(items()[0].name).toBe("Login");
    fireEvent.blur(name);
    expect(items()[0].name).toBe("Sign-in");
  });

  it("stores a blank description as undefined", () => {
    seed([{ ...SEED[0], description: "Old" }]);
    render(<CycleTimeClient />);
    const desc = screen.getByLabelText("Item description");
    fireEvent.change(desc, { target: { value: "   " } });
    fireEvent.blur(desc);
    expect(items()[0].description).toBeUndefined();
  });

  it("recomputes the row and stats when an end date changes", () => {
    render(<CycleTimeClient />);
    fireEvent.change(screen.getByLabelText("End date for Reports"), {
      target: { value: "2026-10-12" },
    });
    expect(items()[4].endDate).toBe("2026-10-12");
    expect(screen.getByText("5 / 5 with cycle time")).toBeInTheDocument();
    // [2, 3, 5, 10, 10] → mean 6.
    expect(stat("Average")).toBe("Average6days");
  });

  it("treats an end date before the start as no cycle time", () => {
    render(<CycleTimeClient />);
    fireEvent.change(screen.getByLabelText("End date for Login"), {
      target: { value: "2026-09-30" },
    });
    expect(screen.getByText("3 / 5 with cycle time")).toBeInTheDocument();
  });

  it("adds a blank item, removes the clicked one, and resets to one blank item", () => {
    render(<CycleTimeClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    expect(items()).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Remove Search" }));
    expect(items().map((i) => i.name)).toEqual(["Login", "Billing", "Export", "Reports", ""]);
    expect(history.log).toHaveBeenCalledWith("item_removed", { itemId: "b" });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ name: "", startDate: "", endDate: "" });
  });
});

describe("Cycle Time Analyzer: SLE tab", () => {
  beforeEach(() => seed(SEED.map((i) => ({ ...i }))));

  const target = () => screen.getByLabelText("Target Percentile (%)");
  const statement = () => screen.getByText("Service Level Expectation").nextElementSibling!;

  it("states the 85th-percentile SLE and marks it in the percentile table", () => {
    render(<CycleTimeClient />);
    openTab("SLE");
    expect(statement()).toHaveTextContent("85% of items complete within 10 days");
    const table = screen.getByText("All Percentile Thresholds").nextElementSibling as HTMLElement;
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "50th3 daysHalf of items finish within this time",
      "75th5 daysMost items finish within this time",
      "85thtarget10 daysRecommended SLE target",
      "90th10 daysHigh-confidence commitment",
      "95th10 daysVery high confidence, near worst-case",
      "99th10 daysNear-maximum observed time",
    ]);
  });

  it("recomputes the SLE for a new target and clamps it to 1–99", () => {
    render(<CycleTimeClient />);
    openTab("SLE");
    fireEvent.change(target(), { target: { value: "50" } });
    expect(statement()).toHaveTextContent("50% of items complete within 3 days");
    fireEvent.change(target(), { target: { value: "150" } });
    expect(statement()).toHaveTextContent("99% of items complete within 10 days");
  });

  // Bug: Number("") is 0, clamped to 1 — clearing the field to type a new
  // target snapped it to "1" (so typing "90" produced "190").
  it("lets the target field be cleared while typing", () => {
    render(<CycleTimeClient />);
    openTab("SLE");
    fireEvent.change(target(), { target: { value: "" } });
    expect(target()).toHaveValue(null);
    // The SLE keeps the last valid target while the field is blank.
    expect(statement()).toHaveTextContent("85% of items complete within 10 days");
    fireEvent.change(target(), { target: { value: "75" } });
    expect(statement()).toHaveTextContent("75% of items complete within 5 days");
    fireEvent.blur(target());
    expect(target()).toHaveValue(75);
  });

  it("restores the last valid target when left blank", () => {
    render(<CycleTimeClient />);
    openTab("SLE");
    fireEvent.change(target(), { target: { value: "" } });
    fireEvent.blur(target());
    expect(target()).toHaveValue(85);
  });

  it("keeps an SLE target-days entry and lets it be cleared", () => {
    render(<CycleTimeClient />);
    openTab("SLE");
    const days = screen.getByLabelText("SLE Target (days)");
    fireEvent.change(days, { target: { value: "7" } });
    fireEvent.blur(days);
    expect(days).toHaveValue(7);
    fireEvent.change(days, { target: { value: "" } });
    fireEvent.blur(days);
    expect(days).toHaveValue(null);
  });
});

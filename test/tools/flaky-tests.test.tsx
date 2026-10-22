import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyTest } from "@/lib/stores/workspace-types";

/**
 * Flaky Test Scoreboard: KPI tiles (active / quarantined / fixed this
 * quarter / average rate), the add form, sort field + direction, status
 * changes (fixedAt stamping), delete, the median prediction, the top-10
 * and weekly chart data, and the CSV export rows.
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
// Every next/dynamic component (the charts and ChartCard's ResponsiveContainer)
// becomes a placeholder that exposes its props, so chart data can be read.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic({ children, ...props }: { children?: ReactNode }) {
      return (
        <div data-testid="dynamic" data-props={JSON.stringify(props)}>
          {children}
        </div>
      );
    },
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { FlakyTestsClient } from "@/app/(tools)/flaky-tests/flaky-tests-client";

const FB_ID = "flakyTestBoard:current";

const flaky = (id: string, name: string, failureRate: number, over: Partial<FlakyTest> = {}) =>
  ({
    id,
    name,
    failureRate,
    status: "active",
    firstSeenAt: "2026-10-01",
    ...over,
  }) as FlakyTest;

const seed = (list: FlakyTest[]) =>
  useWorkspaceStore.setState({ flakyTestBoards: [{ id: FB_ID, tests: list }] });
const tests = () =>
  (useWorkspaceStore.getState().flakyTestBoards ?? []).find((d) => d.id === FB_ID)?.tests ?? [];
const byId = (id: string) => tests().find((t) => t.id === id)!;

/** The text of the compact StatCard whose label is `label` (the KPI row comes first). */
const tile = (label: string) =>
  screen.getAllByText(label)[0].parentElement!.parentElement!.textContent;

/** Data of the first dynamic chart whose rows carry `key`. */
const chartData = <T,>(key: string): T[] => {
  for (const el of screen.queryAllByTestId("dynamic")) {
    const props = JSON.parse(el.getAttribute("data-props") ?? "{}") as { data?: T[] };
    if (props.data?.[0] && key in (props.data[0] as object)) return props.data;
  }
  return [];
};

/** Test names in the order the list shows them. */
const listed = () =>
  screen
    .getAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Remove /, ""));

function choose(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const rate = () => screen.getByLabelText(/Failure rate \(%\)/);
const addButton = () => screen.getByRole("button", { name: /Add test/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 12));
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ flakyTestBoards: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Flaky tests: empty state", () => {
  it("shows zero KPIs, the empty list and no charts", () => {
    render(<FlakyTestsClient />);
    expect(tile("Active")).toBe("Active0");
    expect(tile("Quarantined")).toBe("Quarantined0");
    expect(tile("Fixed this quarter")).toBe("Fixed this quarter0");
    expect(tile("Avg failure rate")).toBe("Avg failure rate0%");
    expect(screen.getByText(/No flaky tests logged yet/)).toBeInTheDocument();
    expect(screen.queryByText("Top 10 flakiest tests")).not.toBeInTheDocument();
    expect(screen.queryByText("New flakies per week")).not.toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });
});

describe("Flaky tests: KPIs", () => {
  it("counts statuses and averages the failure rate over unfixed tests", () => {
    seed([
      flaky("a", "login", 0.3),
      flaky("b", "search", 0.1, { status: "quarantined" }),
      flaky("c", "billing", 0.9, { status: "fixed", fixedAt: "2026-10-05" }),
    ]);
    render(<FlakyTestsClient />);
    expect(tile("Active")).toBe("Active1");
    expect(tile("Quarantined")).toBe("Quarantined1");
    // (30 + 10) / 2 — the fixed test's 90 % is left out.
    expect(tile("Avg failure rate")).toBe("Avg failure rate20%");
  });

  it("counts tests fixed since the first day of the current quarter", () => {
    seed([
      flaky("a", "on the first day", 0.1, { status: "fixed", fixedAt: "2026-10-01" }),
      flaky("b", "last quarter", 0.1, { status: "fixed", fixedAt: "2026-09-30" }),
      flaky("c", "reopened", 0.1, { status: "active", fixedAt: "2026-10-10" }),
      flaky("d", "no date", 0.1, { status: "fixed" }),
      flaky("e", "bad date", 0.1, { status: "fixed", fixedAt: "soon" }),
    ]);
    render(<FlakyTestsClient />);
    expect(tile("Fixed this quarter")).toBe("Fixed this quarter1");
  });

  it("shows each test's rounded failure rate", () => {
    seed([flaky("a", "login", 0.125, { suite: "auth.spec.ts", owner: "@platform" })]);
    render(<FlakyTestsClient />);
    expect(screen.getByLabelText("Failure rate 13%")).toBeInTheDocument();
    expect(screen.getByText("auth.spec.ts")).toBeInTheDocument();
    expect(screen.getByText("@platform")).toBeInTheDocument();
  });
});

describe("Flaky tests: add form", () => {
  it("adds a trimmed active test at the top, dated today, and clears the form", () => {
    seed([flaky("old", "older", 0.5)]);
    render(<FlakyTestsClient />);
    type("Test name", "  UserService > signs in  ");
    type("Suite (optional)", " auth.spec.ts ");
    type("Owner (optional)", "   ");
    fireEvent.change(rate(), { target: { value: "12.5" } });
    type("Description (optional)", "  Times out on CI  ");
    fireEvent.click(addButton());
    expect(tests()[0]).toMatchObject({
      name: "UserService > signs in",
      suite: "auth.spec.ts",
      owner: undefined,
      failureRate: 0.125,
      status: "active",
      firstSeenAt: "2026-10-23",
      description: "Times out on CI",
    });
    expect(tests()[1].id).toBe("old");
    expect(screen.getByLabelText("Test name")).toHaveValue("");
    expect(rate()).toHaveValue("");
    expect(history.log).toHaveBeenCalledWith(
      "test_added",
      expect.objectContaining({ name: "UserService > signs in", failureRate: 0.125 })
    );
  });

  it("caps a pasted-in test name at 240 characters", () => {
    render(<FlakyTestsClient />);
    type("Test name", "x".repeat(500));
    fireEvent.change(rate(), { target: { value: "5" } });
    fireEvent.click(addButton());
    expect(tests()[0].name).toHaveLength(240);
  });

  it("clamps the rate to 0–100 on blur", () => {
    render(<FlakyTestsClient />);
    fireEvent.change(rate(), { target: { value: "150" } });
    fireEvent.blur(rate());
    expect(rate()).toHaveValue("100");
    fireEvent.change(rate(), { target: { value: "-4" } });
    fireEvent.blur(rate());
    expect(rate()).toHaveValue("0");
    fireEvent.change(rate(), { target: { value: "lots" } });
    fireEvent.blur(rate());
    expect(rate()).toHaveValue("");
  });

  it("accepts a 0 % rate", () => {
    render(<FlakyTestsClient />);
    type("Test name", "rarely flaky");
    fireEvent.change(rate(), { target: { value: "0" } });
    fireEvent.click(addButton());
    expect(tests()[0].failureRate).toBe(0);
  });

  it("does not add a test with an out-of-range rate", () => {
    render(<FlakyTestsClient />);
    type("Test name", "too flaky");
    fireEvent.change(rate(), { target: { value: "101" } });
    fireEvent.click(addButton());
    expect(tests()).toEqual([]);
  });

  it("stays disabled without a name", () => {
    render(<FlakyTestsClient />);
    fireEvent.change(rate(), { target: { value: "10" } });
    type("Test name", "   ");
    expect(addButton()).toBeDisabled();
  });

  it("predicts the median rate of unfixed tests once 3 are logged", () => {
    seed([
      flaky("a", "a", 0.1),
      flaky("b", "b", 0.2),
      flaky("c", "c", 0.3, { status: "quarantined" }),
      flaky("d", "d", 0.4),
      flaky("e", "e", 0.99, { status: "fixed" }),
    ]);
    render(<FlakyTestsClient />);
    // Even count: the mean of the two middle values (20 and 30).
    expect(rate()).toHaveAttribute("placeholder", "25");
    fireEvent.click(screen.getByRole("button", { name: "Predicted: 25, accept" }));
    expect(rate()).toHaveValue("25");
  });

  it("has no prediction below 3 unfixed tests", () => {
    seed([flaky("a", "a", 0.1), flaky("b", "b", 0.2)]);
    render(<FlakyTestsClient />);
    expect(rate()).toHaveAttribute("placeholder", "e.g. 12.5");
    expect(screen.queryByRole("button", { name: /Predicted/ })).not.toBeInTheDocument();
  });
});

describe("Flaky tests: sorting", () => {
  beforeEach(() =>
    seed([
      flaky("a", "beta", 0.2, { status: "quarantined", firstSeenAt: "2026-10-03" }),
      flaky("b", "alpha", 0.5, { status: "fixed", firstSeenAt: "2026-10-01" }),
      flaky("c", "gamma", 0.1, { status: "active", firstSeenAt: "2026-10-02" }),
    ])
  );

  it("lists the flakiest first by default and flips with the direction button", () => {
    render(<FlakyTestsClient />);
    expect(listed()).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.click(screen.getByRole("button", { name: "Descending order" }));
    expect(listed()).toEqual(["gamma", "beta", "alpha"]);
    expect(screen.getByRole("button", { name: "Ascending order" })).toHaveTextContent("Asc");
  });

  it("sorts by name, status and first-seen date", () => {
    render(<FlakyTestsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Descending order" }));
    choose(screen.getByRole("combobox", { name: "Sort by" }), "Name");
    expect(listed()).toEqual(["alpha", "beta", "gamma"]);
    choose(screen.getByRole("combobox", { name: "Sort by" }), "Status");
    expect(listed()).toEqual(["gamma", "alpha", "beta"]);
    choose(screen.getByRole("combobox", { name: "Sort by" }), "First seen");
    expect(listed()).toEqual(["alpha", "gamma", "beta"]);
  });

  it("never reorders the stored tests", () => {
    render(<FlakyTestsClient />);
    choose(screen.getByRole("combobox", { name: "Sort by" }), "Name");
    expect(tests().map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("Flaky tests: status and delete", () => {
  it("quarantines a test", () => {
    seed([flaky("a", "login", 0.3), flaky("b", "search", 0.1)]);
    render(<FlakyTestsClient />);
    choose(screen.getByRole("combobox", { name: "Status for search" }), "Quarantined");
    expect(byId("b").status).toBe("quarantined");
    expect(byId("a").status).toBe("active");
    expect(tile("Quarantined")).toBe("Quarantined1");
    expect(history.log).toHaveBeenCalledWith("test_quarantined", { testId: "b", name: "search" });
  });

  it("stamps fixedAt with today when fixed and keeps it when reopened", () => {
    seed([flaky("a", "login", 0.3)]);
    render(<FlakyTestsClient />);
    choose(screen.getByRole("combobox", { name: "Status for login" }), "Fixed");
    expect(byId("a")).toMatchObject({ status: "fixed", fixedAt: "2026-10-23" });
    expect(tile("Fixed this quarter")).toBe("Fixed this quarter1");
    choose(screen.getByRole("combobox", { name: "Status for login" }), "Active");
    expect(byId("a")).toMatchObject({ status: "active", fixedAt: "2026-10-23" });
    expect(tile("Fixed this quarter")).toBe("Fixed this quarter0");
  });

  // Bug: fixedAt is "the date the test was LAST fixed", but re-fixing a
  // reopened test kept the first fix's date, so it dropped out of "Fixed
  // this quarter".
  it("re-stamps fixedAt when a reopened test is fixed again", () => {
    seed([flaky("a", "login", 0.3, { status: "active", fixedAt: "2026-05-02" })]);
    render(<FlakyTestsClient />);
    choose(screen.getByRole("combobox", { name: "Status for login" }), "Fixed");
    expect(byId("a").fixedAt).toBe("2026-10-23");
    expect(tile("Fixed this quarter")).toBe("Fixed this quarter1");
  });

  it("removes exactly the clicked test", () => {
    seed([flaky("a", "login", 0.3), flaky("b", "search", 0.1), flaky("c", "billing", 0.2)]);
    render(<FlakyTestsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove billing" }));
    expect(tests().map((t) => t.id)).toEqual(["a", "b"]);
    expect(history.log).toHaveBeenCalledWith("test_removed", { testId: "c", name: "billing" });
  });
});

describe("Flaky tests: charts and export", () => {
  it("charts the 10 flakiest unfixed tests, truncating long names", () => {
    const list = Array.from({ length: 12 }, (_, i) => flaky(`t${i}`, `test ${i}`, (i + 1) / 20));
    list.push(flaky("fixed", "fixed test", 1, { status: "fixed" }));
    list.push(flaky("long", "a".repeat(40), 0.95));
    seed(list);
    render(<FlakyTestsClient />);
    const data = chartData<{ name: string; failureRatePct: number; flagged: boolean }>(
      "failureRatePct"
    );
    expect(data).toHaveLength(10);
    expect(data[0]).toEqual({ name: `${"a".repeat(27)}…`, failureRatePct: 95, flagged: true });
    expect(data.map((d) => d.failureRatePct)).toEqual([95, 60, 55, 50, 45, 40, 35, 30, 25, 20]);
    // 20 % is not above the 20 % flag line.
    expect(data[9].flagged).toBe(false);
    expect(data.some((d) => d.name === "fixed test")).toBe(false);
  });

  it("counts new flakies per Monday-started week, filling empty weeks with 0", () => {
    seed([
      flaky("a", "a", 0.1, { firstSeenAt: "2026-09-02" }), // Wed → week of Mon 31 Aug
      flaky("b", "b", 0.1, { firstSeenAt: "2026-09-21" }), // Mon
      flaky("c", "c", 0.1, { firstSeenAt: "2026-09-27" }), // Sun → same week
      flaky("d", "d", 0.1, { firstSeenAt: "not a date" }),
    ]);
    render(<FlakyTestsClient />);
    expect(screen.getByText("New flakies per week")).toBeInTheDocument();
    expect(chartData("week")).toEqual([
      { week: "2026-08-31", count: 1 },
      { week: "2026-09-07", count: 0 },
      { week: "2026-09-14", count: 0 },
      { week: "2026-09-21", count: 2 },
    ]);
  });

  it("hides the weekly chart with fewer than 4 weeks", () => {
    seed([flaky("a", "a", 0.1, { firstSeenAt: "2026-09-02" })]);
    render(<FlakyTestsClient />);
    expect(screen.queryByText("New flakies per week")).not.toBeInTheDocument();
  });

  it("exports one CSV row per test with the rate as a percentage", () => {
    seed([
      flaky("a", "login", 0.125, { suite: "auth", status: "fixed", fixedAt: "2026-10-02" }),
      flaky("b", "search", 0.3),
    ]);
    render(<FlakyTestsClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Suite",
      "Owner",
      "Failure %",
      "Status",
      "First Seen",
      "Fixed",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["login", "auth", "", "12.5", "fixed", "2026-10-01", "2026-10-02", ""],
      ["search", "", "", "30.0", "active", "2026-10-01", "", ""],
    ]);
  });
});

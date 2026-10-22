import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrSample } from "@/lib/stores/workspace-types";

/**
 * Code review metrics: KPIs derived from logged PR samples, the manual
 * "Log PR sample" form, CSV bulk import (headerless, header-mapped, quoted
 * cells, validation toasts), delete, and the CSV export rows.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
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
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => "t", {
    success: (m: string) => {
      toasts.success.push(m);
      return "t";
    },
    error: (m: string) => {
      toasts.error.push(m);
      return "t";
    },
    info: () => "t",
    warning: () => "t",
  }),
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { CodeReviewMetricsClient } from "@/app/(tools)/code-review-metrics/code-review-metrics-client";

const CR_ID = "codeReviewLog:current";

const pr = (id: string, over: Partial<PrSample> = {}): PrSample => ({
  id,
  prNumber: `#${id}`,
  author: "ana",
  openedAt: "2026-09-01T09:00",
  mergedAt: "2026-09-01T11:00",
  reviewerCount: 2,
  commentCount: 4,
  linesChanged: 100,
  ...over,
});

const seed = (samples: PrSample[]) =>
  useWorkspaceStore.setState({ codeReviewLogs: [{ id: CR_ID, samples }] });

const samples = () =>
  (useWorkspaceStore.getState().codeReviewLogs ?? []).find((d) => d.id === CR_ID)?.samples ?? [];

/** The text of the compact StatCard whose label is `label`. */
const stat = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

/** Props of the first dynamic chart whose `data` rows carry `key`. */
const chartData = <T,>(key: string): T[] => {
  for (const el of screen.queryAllByTestId("dynamic")) {
    const props = JSON.parse(el.getAttribute("data-props") ?? "{}") as { data?: T[] };
    if (props.data?.[0] && key in (props.data[0] as object)) return props.data;
  }
  return [];
};

const csvBox = () => screen.getByLabelText("CSV rows to import");
const importCsv = (csv: string) => {
  fireEvent.change(csvBox(), { target: { value: csv } });
  fireEvent.click(screen.getByRole("button", { name: /Parse & import/ }));
};

beforeEach(() => {
  exported.csv = undefined;
  toasts.success.length = 0;
  toasts.error.length = 0;
  history.log.mockClear();
  useWorkspaceStore.setState({ codeReviewLogs: [] });
});

describe("Code review metrics: empty state", () => {
  it("shows the empty list, dashes and zeros, and no charts", () => {
    render(<CodeReviewMetricsClient />);
    expect(screen.getByText(/No PR samples logged/)).toBeInTheDocument();
    expect(stat("Cycle mean")).toContain("—");
    expect(stat("Cycle P85")).toContain("—");
    expect(stat("Avg review depth")).toContain("0.0");
    expect(stat("Avg PR size")).toContain("0");
    expect(screen.queryByText("Weekly cycle-time mean (XmR)")).not.toBeInTheDocument();
    expect(screen.queryByText("PR size vs. cycle hours")).not.toBeInTheDocument();
    expect(screen.queryByText("Top PR authors by comments received")).not.toBeInTheDocument();
    expect(screen.queryByText(/still open/)).not.toBeInTheDocument();
  });

  it("keeps the Add PR and import buttons disabled until their inputs are filled", () => {
    render(<CodeReviewMetricsClient />);
    expect(screen.getByRole("button", { name: /Add PR/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Parse & import/ })).toBeDisabled();
    fireEvent.change(csvBox(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Parse & import/ })).toBeDisabled();
  });
});

describe("Code review metrics: derived KPIs", () => {
  it("uses the mean (not a median) while fewer than 3 PRs are merged", () => {
    seed([
      pr("1", { mergedAt: "2026-09-01T11:00" }), // 2h
      pr("2", { mergedAt: "2026-09-01T15:00", commentCount: 8, linesChanged: 301 }), // 6h
      pr("3", { mergedAt: undefined, commentCount: 0, linesChanged: 0 }),
    ]);
    render(<CodeReviewMetricsClient />);
    expect(stat("Cycle mean")).toContain("4.0h");
    expect(stat("Cycle mean")).toContain("n<3, CI unavailable");
    expect(screen.queryByText("Cycle median")).not.toBeInTheDocument();
    expect(stat("Cycle P85")).toContain("—");
    // (4 + 8 + 0) / 3 comments, (100 + 301 + 0) / 3 lines — over ALL samples.
    expect(stat("Avg review depth")).toContain("4.0");
    expect(stat("Avg PR size")).toContain("134");
    expect(screen.getByText("1 PR(s) still open")).toBeInTheDocument();
  });

  it("switches to a bootstrapped median and P85 once 3 PRs are merged", () => {
    seed([
      pr("1", { mergedAt: "2026-09-01T11:00" }), // 2h
      pr("2", { mergedAt: "2026-09-01T13:00" }), // 4h
      pr("3", { mergedAt: "2026-09-02T15:00" }), // 30h
    ]);
    render(<CodeReviewMetricsClient />);
    expect(stat("Cycle median")).toContain("4.0h");
    expect(stat("Cycle median")).toMatch(/95% CI/);
    // Linear-interpolated P85 of [2, 4, 30]: 4 + 0.7 × 26 = 22.2.
    expect(stat("Cycle P85")).toContain("22.2h");
    expect(screen.getByText("Weekly cycle-time mean (XmR)")).toBeInTheDocument();
    expect(screen.getByText("PR size vs. cycle hours")).toBeInTheDocument();
  });

  it("ignores a merge timestamp earlier than the open timestamp", () => {
    seed([
      pr("1", { mergedAt: "2026-09-01T11:00" }), // 2h
      pr("2", { mergedAt: "2026-08-31T09:00" }), // merged before opened → no cycle
    ]);
    render(<CodeReviewMetricsClient />);
    expect(stat("Cycle mean")).toContain("2.0h");
  });

  it("ignores unparseable timestamps instead of showing NaN", () => {
    seed([pr("1", { openedAt: "not a date", mergedAt: "2026-09-01T11:00" })]);
    render(<CodeReviewMetricsClient />);
    expect(stat("Cycle mean")).toContain("—");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("lists PRs newest-first with cycle time, size, comments and reviewers", () => {
    seed([
      pr("1", { author: "ana", description: "Refactor auth" }),
      pr("2", { author: "ben", mergedAt: undefined, linesChanged: 12 }),
    ]);
    render(<CodeReviewMetricsClient />);
    const removeButtons = screen.getAllByRole("button", { name: /Remove PR sample by/ });
    expect(removeButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove PR sample by @ben",
      "Remove PR sample by @ana",
    ]);
    const ben = removeButtons[0].closest("div")!;
    expect(ben).toHaveTextContent("#2");
    expect(ben).toHaveTextContent("open");
    expect(ben).toHaveTextContent("12L");
    const ana = removeButtons[1].closest("div")!;
    expect(ana).toHaveTextContent("2.0h");
    expect(ana).toHaveTextContent("4 comments");
    expect(ana).toHaveTextContent("2 reviewers");
    expect(screen.getByText("Refactor auth")).toBeInTheDocument();
  });

  it("removes exactly the clicked PR", () => {
    seed([pr("1", { author: "ana" }), pr("2", { author: "ben" }), pr("3", { author: "cy" })]);
    render(<CodeReviewMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove PR sample by @ben" }));
    expect(samples().map((s) => s.id)).toEqual(["1", "3"]);
    expect(history.log).toHaveBeenCalledWith(
      "pr_removed",
      expect.objectContaining({ sampleId: "2", author: "ben" })
    );
  });

  it("ranks top authors by total comments received on their PRs", () => {
    seed([
      pr("1", { author: "ana", commentCount: 3 }),
      pr("2", { author: "ben", commentCount: 9 }),
      pr("3", { author: "ana", commentCount: 4, mergedAt: undefined }),
    ]);
    render(<CodeReviewMetricsClient />);
    expect(chartData("comments")).toEqual([
      { author: "ben", comments: 9 },
      { author: "ana", comments: 7 },
    ]);
  });

  it("plots only merged PRs on the size-vs-cycle scatter", () => {
    seed([
      pr("1", { linesChanged: 50, mergedAt: "2026-09-01T10:30" }),
      pr("2", { mergedAt: undefined }),
    ]);
    render(<CodeReviewMetricsClient />);
    expect(chartData("linesChanged")).toEqual([
      { linesChanged: 50, cycleHours: 1.5, prNumber: "#1", author: "ana" },
    ]);
  });

  it("averages cycle hours per ISO week of the merge, oldest week first", () => {
    seed([
      pr("1", { openedAt: "2026-09-08T09:00", mergedAt: "2026-09-08T19:00" }), // W37, 10h
      pr("2", { openedAt: "2026-09-01T09:00", mergedAt: "2026-09-01T11:00" }), // W36, 2h
      pr("3", { openedAt: "2026-09-02T09:00", mergedAt: "2026-09-02T13:00" }), // W36, 4h
    ]);
    render(<CodeReviewMetricsClient />);
    expect(chartData("week")).toEqual([
      { week: "2026-W36", meanHours: 3 },
      { week: "2026-W37", meanHours: 10 },
    ]);
  });

  // Bug: the ISO week was taken from the UTC date of a local merge time, so
  // away from UTC a merge just after local midnight landed in the wrong week.
  it("buckets a merge by its local day, not its UTC day", () => {
    seed([
      pr("1", { openedAt: "2026-09-06T20:00", mergedAt: "2026-09-06T23:30" }), // Sun, W36
      pr("2", { openedAt: "2026-09-06T20:00", mergedAt: "2026-09-07T00:30" }), // Mon, W37
    ]);
    render(<CodeReviewMetricsClient />);
    expect(chartData("week")).toEqual([
      { week: "2026-W36", meanHours: 3.5 },
      { week: "2026-W37", meanHours: 4.5 },
    ]);
  });

  it("exports one CSV row per PR with cycle hours to 2 decimals", () => {
    seed([pr("1", { mergedAt: "2026-09-01T10:20" }), pr("2", { mergedAt: undefined })]);
    render(<CodeReviewMetricsClient />);
    expect(exported.csv?.headers).toEqual([
      "PR Number",
      "Author",
      "Opened At",
      "Merged At",
      "Cycle Hours",
      "Reviewer Count",
      "Comment Count",
      "Lines Changed",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["#1", "ana", "2026-09-01T09:00", "2026-09-01T10:20", "1.33", 2, 4, 100, ""],
      ["#2", "ana", "2026-09-01T09:00", "", "", 2, 4, 100, ""],
    ]);
  });
});

describe("Code review metrics: Log PR sample form", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("PR # (optional)"), { target: { value: " #42 " } });
    fireEvent.change(screen.getByLabelText("Author"), { target: { value: "  dana " } });
    fireEvent.change(screen.getByLabelText("Opened at"), {
      target: { value: "2026-09-03T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Merged at (optional)"), {
      target: { value: "2026-09-03T12:30" },
    });
    fireEvent.change(screen.getByLabelText("Reviewers"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Comments"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Lines changed"), { target: { value: "240" } });
  };

  it("adds a trimmed sample and clears the form", () => {
    render(<CodeReviewMetricsClient />);
    fill();
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  Split the parser  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add PR/ }));
    const [s] = samples();
    expect(s).toMatchObject({
      prNumber: "#42",
      author: "dana",
      openedAt: "2026-09-03T09:00",
      mergedAt: "2026-09-03T12:30",
      reviewerCount: 2,
      commentCount: 7,
      linesChanged: 240,
      description: "Split the parser",
    });
    expect(s.id).toEqual(expect.any(String));
    expect(screen.getByLabelText("Author")).toHaveValue("");
    expect(screen.getByLabelText("Reviewers")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Add PR/ })).toBeDisabled();
    expect(stat("Cycle mean")).toContain("3.5h");
    expect(history.log).toHaveBeenCalledWith(
      "pr_logged",
      expect.objectContaining({ author: "dana", linesChanged: 240 })
    );
  });

  it("stores blank optional fields as undefined", () => {
    render(<CodeReviewMetricsClient />);
    fill();
    fireEvent.change(screen.getByLabelText("PR # (optional)"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Merged at (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Add PR/ }));
    const [s] = samples();
    expect(s.prNumber).toBeUndefined();
    expect(s.mergedAt).toBeUndefined();
    expect(s.description).toBeUndefined();
    expect(screen.getByText("1 PR(s) still open")).toBeInTheDocument();
  });

  it("accepts 0 as a valid count", () => {
    render(<CodeReviewMetricsClient />);
    fill();
    fireEvent.change(screen.getByLabelText("Comments"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Add PR/ }));
    expect(samples()[0].commentCount).toBe(0);
  });

  it("stays disabled while the author is blank or a count is missing", () => {
    render(<CodeReviewMetricsClient />);
    fill();
    const add = screen.getByRole("button", { name: /Add PR/ });
    expect(add).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Author"), { target: { value: "   " } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Author"), { target: { value: "dana" } });
    fireEvent.change(screen.getByLabelText("Lines changed"), { target: { value: "" } });
    expect(add).toBeDisabled();
  });

  it("does not add a sample with a non-numeric count", () => {
    render(<CodeReviewMetricsClient />);
    fill();
    fireEvent.change(screen.getByLabelText("Reviewers"), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: /Add PR/ }));
    expect(samples()).toEqual([]);
  });

  it("rounds a count on blur and clears a negative or non-numeric one", () => {
    render(<CodeReviewMetricsClient />);
    const reviewers = screen.getByLabelText("Reviewers");
    fireEvent.change(reviewers, { target: { value: "2.6" } });
    fireEvent.blur(reviewers);
    expect(reviewers).toHaveValue("3");
    fireEvent.change(reviewers, { target: { value: "-1" } });
    fireEvent.blur(reviewers);
    expect(reviewers).toHaveValue("");
    fireEvent.change(reviewers, { target: { value: "abc" } });
    fireEvent.blur(reviewers);
    expect(reviewers).toHaveValue("");
  });

  // Bug: Number("") is 0, so tabbing through (or clearing) a count filled in
  // a "0" the user never typed and could enable "Add PR".
  it("leaves a blank count blank on blur", () => {
    render(<CodeReviewMetricsClient />);
    const comments = screen.getByLabelText("Comments");
    fireEvent.blur(comments);
    expect(comments).toHaveValue("");
    fireEvent.change(comments, { target: { value: "5" } });
    fireEvent.change(comments, { target: { value: "" } });
    fireEvent.blur(comments);
    expect(comments).toHaveValue("");
  });
});

describe("Code review metrics: CSV import", () => {
  it("imports headerless rows positionally and clears the draft", () => {
    render(<CodeReviewMetricsClient />);
    importCsv(
      [
        "#1,alice,2026-09-01T09:00,2026-09-01T17:30,2,14,120,Refactor auth",
        "#2,bob,2026-09-02T09:00,,1,3,40",
      ].join("\n")
    );
    expect(samples()).toEqual([
      expect.objectContaining({
        prNumber: "#1",
        author: "alice",
        mergedAt: "2026-09-01T17:30",
        reviewerCount: 2,
        commentCount: 14,
        linesChanged: 120,
        description: "Refactor auth",
      }),
      expect.objectContaining({
        prNumber: "#2",
        author: "bob",
        mergedAt: undefined,
        linesChanged: 40,
        description: undefined,
      }),
    ]);
    expect(toasts.success).toEqual(["Imported 2 PR(s)"]);
    expect(csvBox()).toHaveValue("");
  });

  it("maps columns by header name, in any order, with CRLF line endings", () => {
    render(<CodeReviewMetricsClient />);
    importCsv(
      [
        "linesChanged,commentCount,reviewerCount,author,openedAt,mergedAt,prNumber",
        "80,5,3,carol,2026-09-04T10:00,2026-09-04T12:00,#9",
      ].join("\r\n")
    );
    expect(samples()).toEqual([
      expect.objectContaining({
        prNumber: "#9",
        author: "carol",
        openedAt: "2026-09-04T10:00",
        reviewerCount: 3,
        commentCount: 5,
        linesChanged: 80,
      }),
    ]);
  });

  it("round-trips the tool's own CSV export header", () => {
    render(<CodeReviewMetricsClient />);
    importCsv(
      [
        "PR Number,Author,Opened At,Merged At,Cycle Hours,Reviewer Count,Comment Count,Lines Changed,Description",
        "#5,erin,2026-09-01T09:00,2026-09-01T10:00,1.00,1,2,30,Docs",
      ].join("\n")
    );
    expect(samples()).toEqual([
      expect.objectContaining({
        prNumber: "#5",
        author: "erin",
        reviewerCount: 1,
        commentCount: 2,
        linesChanged: 30,
        description: "Docs",
      }),
    ]);
  });

  it("keeps quoted commas and escaped quotes inside one cell", () => {
    render(<CodeReviewMetricsClient />);
    importCsv('#7,"lee, jr",2026-09-01T09:00,,1,2,3,"Fix ""login"", logout"');
    expect(samples()[0]).toMatchObject({ author: "lee, jr", description: 'Fix "login", logout' });
  });

  it("does not mistake a data row that mentions 'review' for a header", () => {
    render(<CodeReviewMetricsClient />);
    importCsv("#8,fay,2026-09-01T09:00,,1,2,3,needs review");
    expect(toasts.error).toEqual([]);
    expect(samples()).toHaveLength(1);
    expect(samples()[0].description).toBe("needs review");
  });

  it("counts short, author-less and non-numeric rows as skipped", () => {
    render(<CodeReviewMetricsClient />);
    importCsv(
      [
        "#1,alice,2026-09-01T09:00,,1,2,3",
        "#2,bob,2026-09-01T09:00", // too few cells
        "#3,,2026-09-01T09:00,,1,2,3", // no author
        "#4,dan,2026-09-01T09:00,,x,2,3", // non-numeric reviewers
      ].join("\n")
    );
    expect(samples().map((s) => s.author)).toEqual(["alice"]);
    expect(toasts.success).toEqual(["Imported 1 PR(s) (3 skipped)"]);
  });

  it("clamps negative counts to 0 and rounds fractions", () => {
    render(<CodeReviewMetricsClient />);
    importCsv("#1,alice,2026-09-01T09:00,,-2,2.4,9.5");
    expect(samples()[0]).toMatchObject({ reviewerCount: 0, commentCount: 2, linesChanged: 10 });
  });

  it("toasts the missing column when a header lacks a required one", () => {
    render(<CodeReviewMetricsClient />);
    importCsv(
      ["prNumber,author,mergedAt,reviewerCount,commentCount,linesChanged,description", "x"].join(
        "\n"
      )
    );
    expect(toasts.error).toEqual(["CSV header missing required column: openedAt"]);
    expect(samples()).toEqual([]);
    // The draft is kept so the user can fix it.
    expect(csvBox()).not.toHaveValue("");
  });

  it("toasts when no row is valid and appends nothing", () => {
    seed([pr("1")]);
    render(<CodeReviewMetricsClient />);
    importCsv("garbage,line");
    expect(toasts.error).toEqual(["No valid rows parsed — check headers and number columns"]);
    expect(samples().map((s) => s.id)).toEqual(["1"]);
  });

  it("appends imported rows after existing samples", () => {
    seed([pr("1")]);
    render(<CodeReviewMetricsClient />);
    importCsv("#2,zed,2026-09-01T09:00,,1,2,3");
    expect(samples().map((s) => s.author)).toEqual(["ana", "zed"]);
    const list = screen.getAllByRole("button", { name: /Remove PR sample by/ });
    expect(within(list[0].closest("div")!).getByText("@zed")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { DEFAULT_CALENDAR, workingHoursBetween } from "@/lib/sprints/calendar";
import {
  CODE_REVIEW_LOG_ID,
  parseReviewCsv,
  reviewSummary,
  reviewVerdict,
  windowMinutes,
} from "@/lib/quality/review";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type CodeReviewLog,
  type PrSample,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { CODE_REVIEW_LOG } from "../stores/phase8-fixtures";

/**
 * Code Review Metrics: time to first review and cycle time in the team's
 * working hours (the cadence's days and holidays, clipped to an optional
 * working window; no default 09:00–17:00), medians quoted from three PRs
 * and P85 from five (never a mean), a team view by PR size (no author
 * ranking), draft-then-save with inline errors, a CSV import through
 * lib/utils/csv with row errors listed and Undo, edit in place, delete with
 * Undo, an in-memory example, Markdown, and the page and
 * tool.code_review_metrics.list_state quoting the same numbers.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
const logSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: logSpy }),
}));
vi.mock("@/app/(tools)/code-review-metrics/charts", () => ({
  BandChart: () => null,
  WeeklyMedianChart: () => null,
  PrSizeScatterChart: () => null,
}));

import "@/lib/actions/tools/code-review-metrics";
import { CodeReviewMetricsClient } from "@/app/(tools)/code-review-metrics/code-review-metrics-client";
import { buildExample } from "@/app/(tools)/code-review-metrics/example";
import { reviewMarkdown } from "@/app/(tools)/code-review-metrics/markdown";
import {
  emptySampleDraft,
  validateSample,
  type SampleDraftText,
} from "@/app/(tools)/code-review-metrics/sample-form";
import { validateWindow } from "@/app/(tools)/code-review-metrics/working-window";
import { bandChartText, weeklyChartText } from "@/app/(tools)/code-review-metrics/view";

const TODAY = todayLocalISO();

const pr = (id: string, extra: Partial<PrSample> = {}): PrSample => ({
  id,
  author: "Ana",
  openedAt: "2026-10-05T09:00",
  mergedAt: "2026-10-05T13:00",
  reviewerCount: 1,
  commentCount: 2,
  linesChanged: 50,
  ...extra,
});

const doc = () =>
  (useWorkspaceStore.getState().codeReviewLogs ?? []).find((d) => d.id === CODE_REVIEW_LOG_ID) ??
  null;
const samples = () => doc()?.samples ?? [];
const seed = (log: CodeReviewLog | null) =>
  useWorkspaceStore.setState({ codeReviewLogs: log ? [log] : [], ceremonyCadences: [] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CodeReviewMetricsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  act(() => call?.[1]?.action?.onClick());
};

const agentState = async () => {
  const action = registry.get("tool.code_review_metrics.list_state")!;
  return (await action.handler!({}, { userId: "u", source: "agent", squadProfileIds: [] })) as {
    verdict: string;
    medianCycleWorkingHours: number | null;
    workingBasis: { label: string };
  };
};

const draft = (patch: Partial<SampleDraftText> = {}): SampleDraftText => ({
  ...emptySampleDraft(),
  author: "Ana",
  openedAt: "2026-10-05T09:00",
  reviewerCount: "1",
  commentCount: "0",
  linesChanged: "10",
  ...patch,
});
const NOW = "2026-10-27T12:00";

beforeEach(() => {
  seed(null);
  toastSpy.mockReset();
  logSpy.mockReset();
});

/* ── The shared maths the page reads ─────────────────────────────────── */

describe("working hours (lib/sprints/calendar)", () => {
  const window = { startMinute: 9 * 60, endMinute: 17 * 60 };

  it("skips the weekend, counting whole days without a window", () => {
    // Friday 17:00 → Monday 10:00: 7 h of Friday, 10 h of Monday.
    expect(workingHoursBetween("2026-10-23T17:00", "2026-10-26T10:00")).toBe(17);
    expect(
      workingHoursBetween("2026-10-23T17:00", "2026-10-26T10:00", DEFAULT_CALENDAR, window)
    ).toBe(1);
  });

  it("skips a holiday, clips to the window, and reads edge cases", () => {
    const calendar = { ...DEFAULT_CALENDAR, holidays: ["2026-10-26"] };
    expect(workingHoursBetween("2026-10-23T16:00", "2026-10-27T10:00", calendar, window)).toBe(2);
    expect(
      workingHoursBetween("2026-10-21T07:00", "2026-10-21T20:00", DEFAULT_CALENDAR, window)
    ).toBe(8);
    expect(workingHoursBetween("2026-10-21T10:00", "2026-10-21T10:00")).toBe(0);
    expect(workingHoursBetween("2026-10-21T10:00", "2026-10-20T10:00")).toBeNull();
    expect(workingHoursBetween("2026-10-21", "2026-10-22")).toBe(24);
    // A zone suffix is ignored: the time is read as written.
    expect(workingHoursBetween("2026-10-21T10:00Z", "2026-10-21T12:00+02:00")).toBe(2);
  });
});

describe("the headline: a median from three PRs, P85 from five, never a mean", () => {
  const merged = (n: number) =>
    Array.from({ length: n }, (_, k) =>
      pr(`p${k}`, {
        openedAt: "2026-10-21T09:00",
        mergedAt: `2026-10-21T${String(10 + k * 2).padStart(2, "0")}:00`,
      })
    );

  it("has no median at two", () => {
    const s = reviewSummary(merged(2));
    expect(s.headline.medianCycleWorkingH).toBeNull();
    expect(reviewVerdict(s)).toBe("Log 1 more merged pull request to see the typical review time.");
  });

  it("quotes the nearest-rank median at three and P85 at five", () => {
    expect(reviewSummary(merged(3)).headline).toMatchObject({
      medianCycleWorkingH: 3,
      p85CycleWorkingH: null,
    });
    expect(reviewSummary(merged(5)).headline).toMatchObject({
      medianCycleWorkingH: 5,
      p85CycleWorkingH: 9,
    });
  });
});

describe("the forms' checks", () => {
  it("refuses dates out of order and in the future, inline", () => {
    const order = validateSample(draft({ mergedAt: "2026-10-04T09:00" }), NOW, []);
    expect(!order.ok && order.errors.mergedAt).toBe("It can't be merged before it was opened.");
    const review = validateSample(draft({ firstReviewAt: "2026-10-04T09:00" }), NOW, []);
    expect(!review.ok && review.errors.firstReviewAt).toBe(
      "The first review can't come before it was opened."
    );
    const future = validateSample(draft({ openedAt: "2026-10-28T09:00" }), NOW, []);
    expect(!future.ok && future.errors.openedAt).toBe("That's in the future.");
  });

  it("needs every count, and refuses a PR number logged already", () => {
    const blank = validateSample(draft({ commentCount: "" }), NOW, []);
    expect(!blank.ok && blank.errors.commentCount).toBe("Enter the number of review comments.");
    const dup = validateSample(draft({ prNumber: "412" }), NOW, CODE_REVIEW_LOG.samples);
    expect(!dup.ok && dup.errors.prNumber).toBe("Already logged: PR 412.");
    expect(
      validateSample(draft({ prNumber: "412" }), NOW, CODE_REVIEW_LOG.samples, "pr_1").ok
    ).toBe(true);
  });

  it("needs both window times, the end after the start", () => {
    expect(validateWindow({ start: "", end: "" })).toEqual({
      ok: false,
      errors: { start: 'Enter both times as "HH:MM" (24-hour).' },
    });
    expect(validateWindow({ start: "17:00", end: "09:00" })).toEqual({
      ok: false,
      errors: { end: "The window must end after it starts." },
    });
    expect(validateWindow({ start: "09:00", end: "17:30" }).ok).toBe(true);
  });

  it("imports CSV rows with a blank number as a row error, never 0, and skips duplicates", () => {
    const csv = [
      "prNumber,author,openedAt,mergedAt,reviewerCount,commentCount,linesChanged",
      "1,ana,2026-10-05T09:00,2026-10-05T15:00,1,2,50",
      "2,ben,2026-10-06T09:00,2026-10-06T12:00,1,,80",
      "412,bo,2026-10-07T09:00,2026-10-07T10:00,1,1,10",
    ].join("\n");
    const r = parseReviewCsv(csv, { existing: CODE_REVIEW_LOG.samples, now: NOW });
    expect(r.samples.map((s) => s.prNumber)).toEqual(["1"]);
    expect(r.errors).toEqual([
      { row: 3, message: "commentCount: Enter the number of review comments." },
    ]);
    expect(r.duplicates).toEqual([{ row: 4, prNumber: "412" }]);
  });
});

describe("chart text, Markdown and the example", () => {
  it("names the slowest size band and lists each band", () => {
    const ex = buildExample(TODAY);
    const s = reviewSummary(ex.samples, DEFAULT_CALENDAR, windowMinutes(ex.workingWindow));
    const text = bandChartText(s.bySize);
    expect(text.summary).toMatch(/^Over 400 lines take longest to merge/);
    expect(text.table.rows.map((r) => r[0])).toEqual([
      "Up to 100 lines",
      "101–400 lines",
      "Over 400 lines",
    ]);
  });

  it("leaves a week with too few merges as a gap in the weekly table", () => {
    const text = weeklyChartText([
      { week: "2026-W40", n: 2, medianCycleWorkingH: null },
      { week: "2026-W41", n: 3, medianCycleWorkingH: 4 },
    ]);
    expect(text.table.rows).toEqual([
      ["Week 40, 2026", 2, "—"],
      ["Week 41, 2026", 3, "4"],
    ]);
  });

  it("exports the verdict, the basis, the size bands and every PR", () => {
    const md = reviewMarkdown(CODE_REVIEW_LOG, DEFAULT_CALENDAR);
    expect(md).toContain("Working hours: Mon–Fri, 09:00–17:30");
    expect(md).toContain("## By PR size");
    expect(md).toContain("| 412 | Alice |");
    expect(md).toContain("Dates out of order");
    expect(md).not.toMatch(/Top PR authors/);
  });

  it("is eight weeks of example PRs, two open, two large ones with no comments", () => {
    const ex = buildExample(TODAY);
    expect(ex.samples).toHaveLength(24);
    expect(ex.samples.every((s) => s.id.startsWith("example-"))).toBe(true);
    const s = reviewSummary(ex.samples, DEFAULT_CALENDAR);
    expect(s.open).toBe(2);
    expect(s.awaitingReview).toBe(1);
    expect(s.largeNoComments).toBe(2);
    expect(s.invalid).toBe(0);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("opens on an empty state and an in-memory example, with no author ranking", () => {
    renderPage();
    expect(screen.getByText(/No pull requests logged yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(/^Half of pull requests get a first review within/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 large PRs \(over 400 lines\) were merged with no review comment/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Top PR authors/)).toBeNull();
    expect(doc()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/No pull requests logged yet/)).toBeInTheDocument();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("shows inline errors and saves nothing for a bad draft", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add PR" }));
    expect(await screen.findByText("Enter who opened the pull request.")).toBeInTheDocument();
    expect(screen.getByText("Enter when it was opened.")).toBeInTheDocument();
    expect(screen.getByText("Enter the lines changed.")).toBeInTheDocument();
    expect(doc()).toBeNull();
  });

  it("adds a PR without the '@', keeping the working window an agent set", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Author/), { target: { value: "@chen" } });
    fireEvent.change(screen.getByLabelText(/^Opened/), { target: { value: "2026-10-20T09:00" } });
    fireEvent.change(screen.getByLabelText(/^First review/), {
      target: { value: "2026-10-20T11:00" },
    });
    fireEvent.change(screen.getByLabelText(/^Merged/), { target: { value: "2026-10-21T10:00" } });
    fireEvent.change(screen.getByLabelText(/^Reviewers/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Review comments/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Lines changed/), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Add PR" }));
    await waitFor(() => expect(samples()).toHaveLength(3));
    expect(samples()[2]).toMatchObject({ author: "chen", firstReviewAt: "2026-10-20T11:00" });
    expect(doc()?.workingWindow).toEqual(CODE_REVIEW_LOG.workingWindow);
  });

  it("quotes the same numbers as the agent, and names the basis", async () => {
    const ps = [
      pr("a", { openedAt: "2026-10-21T09:00", mergedAt: "2026-10-21T11:00" }),
      pr("b", { openedAt: "2026-10-21T09:00", mergedAt: "2026-10-21T13:00" }),
      pr("c", { openedAt: "2026-10-23T16:00", mergedAt: "2026-10-26T10:00" }),
    ];
    seed({ id: CODE_REVIEW_LOG_ID, samples: ps });
    useWorkspaceStore.setState({
      ceremonyCadences: [{ id: CEREMONY_CADENCE_ID, holidays: ["2026-10-26"] }] as never,
    });
    renderPage();
    const agent = await agentState();
    expect(screen.getByText(agent.verdict)).toBeInTheDocument();
    expect(agent.workingBasis.label).toBe("Mon–Fri, holidays excluded, whole days");
    expect(
      screen.getByText("In working hours: Mon–Fri, holidays excluded, whole days.")
    ).toBeInTheDocument();
    expect(screen.getByText(`${agent.medianCycleWorkingHours} h`)).toBeInTheDocument();
  });

  it("sets and clears the working window, and the KPI basis follows", async () => {
    seed({ id: CODE_REVIEW_LOG_ID, samples: [pr("a")] });
    renderPage();
    expect(screen.getByText("In working hours: Mon–Fri, whole days.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Day starts/), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText(/^Day ends/), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save working hours" }));
    await waitFor(() => expect(doc()?.workingWindow).toEqual({ start: "09:00", end: "17:00" }));
    expect(screen.getByText("In working hours: Mon–Fri, 09:00–17:00.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Count whole days instead" }));
    await waitFor(() => expect(doc()).not.toHaveProperty("workingWindow"));
  });

  it("flags a legacy row whose merge comes before it opened", () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    expect(screen.getAllByText("Dates out of order").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/1 PR with dates out of order is counted but not timed/)
    ).toBeInTheDocument();
  });

  it("checks a CSV, lists row errors inline, imports the rest, and Undo removes them", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    const csv = [
      "prNumber,author,openedAt,mergedAt,reviewerCount,commentCount,linesChanged",
      "1,ana,2026-10-05T09:00,2026-10-05T15:00,1,2,50",
      "2,ben,2026-10-06T09:00,2026-10-06T12:00,1,,80",
      "412,bo,2026-10-07T09:00,2026-10-07T10:00,1,1,10",
    ].join("\n");
    fireEvent.change(screen.getByLabelText("CSV rows"), { target: { value: csv } });
    fireEvent.click(screen.getByRole("button", { name: "Check rows" }));
    const errors = screen.getByRole("list", { name: "Rows that can't be imported" });
    expect(
      within(errors).getByText("Row 3: commentCount: Enter the number of review comments.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 row skipped as already logged \(row 4: PR 412\)/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 pull request" }));
    await waitFor(() => expect(samples()).toHaveLength(3));
    expect(samples()[2]).toMatchObject({ prNumber: "1", commentCount: 2 });
    expect(doc()?.workingWindow).toEqual(CODE_REVIEW_LOG.workingWindow);
    undoLast();
    await waitFor(() => expect(samples()).toHaveLength(2));
  });

  it("edits a PR in place and deletes one with Undo", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit PR 412" })[0]);
    const panel = screen.getByRole("heading", { name: "Edit PR 412" }).parentElement as HTMLElement;
    fireEvent.change(within(panel).getByLabelText(/^Lines changed/), { target: { value: "500" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(samples()[0].linesChanged).toBe(500));
    expect(samples()[0]).toMatchObject({ author: "Alice", firstReviewAt: "2026-10-19T09:15" });

    fireEvent.click(screen.getAllByRole("button", { name: "Delete PR 412" })[0]);
    await waitFor(() => expect(samples().map((s) => s.id)).toEqual(["pr_legacy"]));
    undoLast();
    await waitFor(() => expect(samples().map((s) => s.id)).toEqual(["pr_1", "pr_legacy"]));
  });

  it("deletes all after a confirm, keeps the working window, and Undo restores", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(samples()).toEqual([]));
    expect(doc()?.workingWindow).toEqual(CODE_REVIEW_LOG.workingWindow);
    undoLast();
    await waitFor(() => expect(samples()).toHaveLength(2));
  });
});

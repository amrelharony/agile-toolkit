import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CODE_REVIEW_LOG_ID } from "@/lib/quality/review";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CodeReviewLog } from "@/lib/stores/workspace-types";
import { CODE_REVIEW_LOG } from "../stores/phase8-fixtures";

/**
 * Code Review Metrics, after review: the working window's minutes are
 * memoised on its times (the review summary isn't worked out again on
 * every render), the working-hours form stays mounted across a save (focus
 * stays on Save; an agent's change never replaces unsaved typing; "Count
 * whole days instead" hands focus to the first time), and focus has
 * somewhere to go after a delete, a delete-all or an import.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: vi.fn() }),
}));
vi.mock("@/app/(tools)/code-review-metrics/charts", () => ({
  BandChart: () => null,
  WeeklyMedianChart: () => null,
  PrSizeScatterChart: () => null,
}));
const summarySpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/quality/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quality/review")>();
  return {
    ...actual,
    reviewSummary: (...args: Parameters<typeof actual.reviewSummary>) => {
      summarySpy.calls += 1;
      return actual.reviewSummary(...args);
    },
  };
});

import { CodeReviewMetricsClient } from "@/app/(tools)/code-review-metrics/code-review-metrics-client";

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

const press = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

beforeEach(() => {
  seed(null);
  toastSpy.mockReset();
  summarySpy.calls = 0;
});

describe("the working window's minutes", () => {
  it("are memoised: a render that changes nothing doesn't work the summary out again", () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    const before = summarySpy.calls;
    // Opening the confirm re-renders the page with the same PRs and window.
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(summarySpy.calls).toBe(before);
    // A new window does.
    act(() => seed({ ...CODE_REVIEW_LOG, workingWindow: { start: "08:00", end: "16:00" } }));
    expect(summarySpy.calls).toBeGreaterThan(before);
  });
});

describe("the working-hours form", () => {
  it("keeps focus on Save working hours after a save", async () => {
    seed({ id: CODE_REVIEW_LOG_ID, samples: [] });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Day starts/), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText(/^Day ends/), { target: { value: "17:00" } });
    const save = screen.getByRole("button", { name: "Save working hours" });
    press(save);
    await waitFor(() => expect(doc()?.workingWindow).toEqual({ start: "09:00", end: "17:00" }));
    expect(screen.getByRole("button", { name: "Save working hours" })).toBe(save);
    expect(save).toHaveFocus();
  });

  it("hands focus to the first time after 'Count whole days instead'", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    press(screen.getByRole("button", { name: "Count whole days instead" }));
    await waitFor(() => expect(doc()).not.toHaveProperty("workingWindow"));
    expect(screen.queryByRole("button", { name: "Count whole days instead" })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^Day starts/)).toHaveFocus());
    expect(screen.getByLabelText(/^Day starts/)).toHaveValue("");
  });

  it("takes in an agent's window, but never over unsaved typing", () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    const start = screen.getByLabelText(/^Day starts/);
    expect(start).toHaveValue("09:00");
    act(() => seed({ ...CODE_REVIEW_LOG, workingWindow: { start: "08:00", end: "16:00" } }));
    expect(start).toHaveValue("08:00");

    fireEvent.change(start, { target: { value: "10:00" } });
    act(() => seed({ ...CODE_REVIEW_LOG, workingWindow: { start: "07:00", end: "15:00" } }));
    expect(start).toHaveValue("10:00");
    expect(screen.getByLabelText(/^Day ends/)).toHaveValue("16:00");
  });
});

describe("focus after a delete, a delete-all or an import", () => {
  it("moves to the neighbouring PR's Edit, then to the log form", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    // Newest first: PR 412, then the legacy PR without a number.
    press(screen.getAllByRole("button", { name: "Delete PR 412" })[0]);
    await waitFor(() => expect(samples().map((s) => s.id)).toEqual(["pr_legacy"]));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Edit the PR opened/ })[0]).toHaveFocus()
    );
    press(screen.getAllByRole("button", { name: /^Delete the PR opened/ })[0]);
    await waitFor(() => expect(samples()).toEqual([]));
    await waitFor(() => expect(screen.getByLabelText(/^PR number/)).toHaveFocus());
  });

  it("moves to the log form after Delete all", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(samples()).toEqual([]));
    await waitFor(() => expect(screen.getByLabelText(/^PR number/)).toHaveFocus());
  });

  it("moves back to the CSV box after an import", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    const box = screen.getByLabelText("CSV rows");
    fireEvent.change(box, {
      target: {
        value: [
          "prNumber,author,openedAt,mergedAt,reviewerCount,commentCount,linesChanged",
          "1,ana,2026-10-05T09:00,2026-10-05T15:00,1,2,50",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check rows" }));
    press(screen.getByRole("button", { name: "Import 1 pull request" }));
    await waitFor(() => expect(samples()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Import 1 pull request" })).toBeNull();
    expect(box).toHaveFocus();
  });
});

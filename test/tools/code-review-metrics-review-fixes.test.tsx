import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CODE_REVIEW_LOG_ID, workingBasisLabel } from "@/lib/quality/review";
import { cadenceCalendar, normalizeCadence } from "@/lib/sprints/cadence";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CodeReviewLog, PrSample } from "@/lib/stores/workspace-types";
import { CODE_REVIEW_LOG } from "../stores/phase8-fixtures";

/**
 * Code Review Metrics, after review: the working window's minutes are
 * memoised on its times (the review summary isn't worked out again on
 * every render), the working-hours form stays mounted across a save (focus
 * stays on Save; an agent's change never replaces unsaved typing; "Count
 * whole days instead" hands focus to the first time), and focus has
 * somewhere to go after a delete, a delete-all or an import. Then: an
 * import checks the PR numbers again (a PR logged since the check isn't
 * stored twice), the check's sentence is announced, the KPI hints under the
 * minimum sample read as a sentence, and the AI prompts call the headline a
 * median of working hours and leave out the by-author questions.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const promptSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: (props: unknown) => {
    promptSpy(props);
    return null;
  },
}));
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
import { moreToSee } from "@/app/(tools)/code-review-metrics/view";

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
  promptSpy.mockReset();
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

const HEADER = "prNumber,author,openedAt,mergedAt,reviewerCount,commentCount,linesChanged";
const ROW_1 = "1,ana,2026-10-05T09:00,2026-10-05T15:00,1,2,50";
const ROW_2 = "2,ben,2026-10-06T09:00,2026-10-06T12:00,1,1,80";
/** PR 1, logged by an agent's add_sample between "Check rows" and the import. */
const LOGGED_SINCE: PrSample = {
  id: "pr_agent",
  prNumber: " 1 ",
  author: "Agent",
  openedAt: "2026-10-05T09:00",
  reviewerCount: 1,
  commentCount: 0,
  linesChanged: 10,
};

const live = () => screen.getByTestId("live-polite");
const pasteAndCheck = (rows: string[]) => {
  fireEvent.change(screen.getByLabelText("CSV rows"), {
    target: { value: [HEADER, ...rows].join("\n") },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check rows" }));
};
const prNumbers = () => samples().map((s) => (s.prNumber ?? "").trim());

describe("an import checks the PR numbers again", () => {
  it("drops a row whose PR was logged since the check, and says so", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    pasteAndCheck([ROW_1, ROW_2]);
    act(() => seed({ ...CODE_REVIEW_LOG, samples: [...CODE_REVIEW_LOG.samples, LOGGED_SINCE] }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 pull requests" }));
    await waitFor(() => expect(samples()).toHaveLength(4));
    expect(prNumbers().filter((n) => n === "1")).toHaveLength(1);
    expect(samples().find((s) => s.prNumber?.trim() === "1")?.id).toBe("pr_agent");
    expect(prNumbers()).toContain("2");
    expect(toastSpy).toHaveBeenCalledWith(
      "Imported 1 pull request",
      expect.objectContaining({ description: "1 row skipped, logged since the check" })
    );
    await waitFor(() =>
      expect(live()).toHaveTextContent(
        "Imported 1 pull request; 1 row skipped, logged since the check"
      )
    );
  });

  it("imports nothing, and offers no Undo, when every row was logged since", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    pasteAndCheck([ROW_1]);
    act(() => seed({ ...CODE_REVIEW_LOG, samples: [...CODE_REVIEW_LOG.samples, LOGGED_SINCE] }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 pull request" }));
    await waitFor(() =>
      expect(live()).toHaveTextContent("Nothing imported: 1 row was logged since the check")
    );
    expect(samples()).toHaveLength(3);
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("the CSV check's result", () => {
  it("is announced as one sentence, and shown under the box", async () => {
    seed(CODE_REVIEW_LOG);
    renderPage();
    pasteAndCheck([
      ROW_1,
      "2,ben,2026-10-06T09:00,2026-10-06T12:00,1,,80",
      "412,bo,2026-10-07T09:00,2026-10-07T10:00,1,1,10",
    ]);
    const sentence =
      "1 row ready to import. 1 row can't be imported (listed below). 1 row skipped as already logged (row 4: PR 412).";
    await waitFor(() => expect(live()).toHaveTextContent(sentence));
    // Shown under the box too, outside any live region of its own (one
    // mounted with its text would be missed, or read twice).
    const shown = screen.getAllByText(sentence).filter((el) => el !== live());
    expect(shown).toHaveLength(1);
    expect(shown[0].closest('[role="status"], [aria-live]')).toBeNull();
  });
});

describe("the KPI hints under the minimum sample", () => {
  it("say what to log as a sentence, with the right plural", () => {
    const merged: [string, string] = ["merged PR", "merged PRs"];
    expect(moreToSee(2, "average", merged)).toBe("Log 1 more merged PR to see it");
    expect(moreToSee(0, "average", merged)).toBe("Log 3 more merged PRs to see it");
    expect(
      moreToSee(4, "distribution", ["PR with a first review", "PRs with a first review"])
    ).toBe("Log 1 more PR with a first review to see it");
  });

  it("read that way on the page", () => {
    // One timed, merged PR with a first review; the legacy one is out of order.
    seed(CODE_REVIEW_LOG);
    renderPage();
    expect(screen.getByText("Log 2 more PRs with a first review to see it")).toBeInTheDocument();
    expect(screen.getByText("Log 2 more merged PRs to see it")).toBeInTheDocument();
    expect(screen.getByText("Log 4 more merged PRs to see it")).toBeInTheDocument();
    expect(screen.queryByText(/Shows once/)).toBeNull();
  });
});

describe("the AI prompts", () => {
  const WINDOW = { start: "09:00", end: "17:30" };
  const merged = (n: number, day: string): PrSample => ({
    id: `pr_${n}`,
    prNumber: String(n),
    author: "Ana",
    openedAt: `${day}T09:00`,
    firstReviewAt: `${day}T10:00`,
    mergedAt: `${day}T12:00`,
    reviewerCount: 1,
    commentCount: 2,
    linesChanged: 50,
  });
  type Props = { config: { prompts: { description: string; prompt: string }[] } };
  const prompts = () => (promptSpy.mock.calls.at(-1)?.[0] as Props).config.prompts;

  it("are the shared prompts: medians in working hours on the page's basis, no author figures", () => {
    // Monday to Wednesday, 3 working hours each.
    seed({
      id: CODE_REVIEW_LOG_ID,
      samples: [merged(10, "2026-10-19"), merged(11, "2026-10-20"), merged(12, "2026-10-21")],
      workingWindow: WINDOW,
    });
    renderPage();
    const basis = workingBasisLabel(cadenceCalendar(normalizeCadence(undefined)), WINDOW);
    const [bottlenecks] = prompts();
    expect(bottlenecks.prompt).toContain(`Working hours count ${basis}.`);
    expect(bottlenecks.prompt).toContain(
      "Median cycle, opened to merged: 3 h working (3 h elapsed)"
    );
    for (const p of prompts()) {
      expect(p.prompt).not.toMatch(/avg cycle/i);
      expect(p.prompt).toContain("| Cycle (working h) |");
      expect(p.prompt).not.toContain("Ana");
      expect(p.description).not.toContain("by author");
    }
  });

  it("say what a median still needs while no PR is merged", () => {
    const open = { ...merged(20, "2026-10-19"), mergedAt: undefined };
    seed({ id: CODE_REVIEW_LOG_ID, samples: [open] });
    renderPage();
    const [bottlenecks] = prompts();
    expect(bottlenecks.prompt).toContain("Median cycle, opened to merged: — (needs 3 merged PRs)");
    expect(bottlenecks.prompt).not.toContain("—h");
  });
});

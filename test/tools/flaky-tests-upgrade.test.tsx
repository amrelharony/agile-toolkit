import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { addDays } from "@/lib/impediments/model";
import {
  FLAKY_BOARD_ID,
  flakySummary,
  flakyVerdict,
  meanFailureRate,
  weightedFailureRate,
} from "@/lib/quality/flaky";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyTest } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { FLAKY_BOARD } from "../stores/phase8-fixtures";

/**
 * Flaky Test Scoreboard: failures and runs instead of a typed rate
 * (failureRate kept equal on every write), draft-then-save with inline
 * errors, the rate weighted by runs (legacy rate-only rows left out and
 * counted), a "quarantined N days" alert from 14 days, a "few runs" note
 * under 10 runs, fixedAt kept on reopen, edit in place, a list that keeps
 * its order while statuses change, delete with Undo, an in-memory example,
 * Markdown, and the page and tool.flaky_tests.list_state agreeing.
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
vi.mock("@/app/(tools)/flaky-tests/charts", () => ({
  FlakiestTestsChart: () => null,
  WeeklyNewChart: () => null,
  WeeklyControlChart: () => null,
}));

import "@/lib/actions/tools/flaky-tests";
import { FlakyTestsClient } from "@/app/(tools)/flaky-tests/flaky-tests-client";
import { buildExample } from "@/app/(tools)/flaky-tests/example";
import { flakyMarkdown } from "@/app/(tools)/flaky-tests/markdown";
import { emptyTestDraft, validateTest, type TestDraft } from "@/app/(tools)/flaky-tests/test-form";
import { offendersChartText, quarantineText, rateText } from "@/app/(tools)/flaky-tests/view";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n);

const flaky = (id: string, name: string, extra: Partial<FlakyTest> = {}): FlakyTest => ({
  id,
  name,
  failureRate: 0.1,
  failures: 1,
  runs: 10,
  status: "active",
  firstSeenAt: ago(10),
  ...extra,
});

const tests = () =>
  (useWorkspaceStore.getState().flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID)
    ?.tests ?? [];
const seed = (...list: FlakyTest[]) =>
  useWorkspaceStore.setState({ flakyTestBoards: [{ id: FLAKY_BOARD_ID, tests: list }] });
const test = (id: string) => tests().find((t) => t.id === id);

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <FlakyTestsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  act(() => call?.[1]?.action?.onClick());
};
const card = (name: string) => screen.getByRole("article", { name });
const listNames = () =>
  within(screen.getByRole("list", { name: "Flaky tests" }))
    .getAllByRole("article")
    .map((a) => a.querySelector("h3")?.textContent);

const draft = (patch: Partial<TestDraft> = {}): TestDraft => ({ ...emptyTestDraft(), ...patch });

beforeEach(() => {
  useWorkspaceStore.setState({ flakyTestBoards: [] });
  toastSpy.mockReset();
  logSpy.mockReset();
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("a test's draft", () => {
  it("needs a name, failures and runs, never a 0 for a blank", () => {
    expect(validateTest(draft(), TODAY)).toEqual({
      ok: false,
      errors: {
        name: "Enter the test's name.",
        failures: "Enter how many runs failed.",
        runs: "Enter how many times it ran.",
      },
    });
  });

  it("refuses more failures than runs, and 0 runs", () => {
    const more = validateTest(draft({ name: "a", failures: "5", runs: "4" }), TODAY);
    expect(!more.ok && more.errors.failures).toBe("It can't fail more often than it ran.");
    const none = validateTest(draft({ name: "a", failures: "0", runs: "0" }), TODAY);
    expect(!none.ok && none.errors.runs).toBe("Enter a whole number of 1 or more.");
  });

  it("backdates the first-seen day, fills a blank with today, and refuses the future", () => {
    expect(
      validateTest(draft({ name: "a", failures: "1", runs: "3", firstSeenAt: ago(30) }), TODAY)
    ).toMatchObject({
      ok: true,
      values: { firstSeenAt: ago(30), failures: 1, runs: 3 },
    });
    expect(validateTest(draft({ name: "a", failures: "1", runs: "3" }), TODAY)).toMatchObject({
      ok: true,
      values: { firstSeenAt: TODAY },
    });
    const future = validateTest(
      draft({ name: "a", failures: "1", runs: "3", firstSeenAt: addDays(TODAY, 1) }),
      TODAY
    );
    expect(!future.ok && future.errors.firstSeenAt).toBe("The day can't be after today.");
  });

  it("refuses a first-seen day after the test's quarantine", () => {
    const t = flaky("q", "q", { status: "quarantined", quarantinedAt: ago(5) });
    const v = validateTest(
      draft({ name: "q", failures: "1", runs: "3", firstSeenAt: ago(2) }),
      TODAY,
      t
    );
    expect(!v.ok && v.errors.firstSeenAt).toBe(
      `It can't come after the day it went into quarantine (${ago(5)}).`
    );
  });

  it("lets a legacy rate-only row be edited without inventing run counts", () => {
    const legacy: FlakyTest = {
      id: "l",
      name: "old",
      failureRate: 0.3,
      status: "active",
      firstSeenAt: ago(90),
    };
    const v = validateTest(draft({ name: "old renamed", firstSeenAt: ago(90) }), TODAY, legacy);
    expect(v).toEqual({ ok: true, values: { name: "old renamed", firstSeenAt: ago(90) } });
  });
});

describe("the shared numbers the page shows", () => {
  it("weighs the rate by runs: a 1-of-2 test no longer outweighs a 30-of-200 one", () => {
    const list = [
      flaky("a", "a", { failures: 1, runs: 2, failureRate: 0.5 }),
      flaky("b", "b", { failures: 30, runs: 200, failureRate: 0.15 }),
    ];
    expect(weightedFailureRate(list).rate).toBeCloseTo(31 / 202);
    expect(meanFailureRate(list)).toBeCloseTo(0.325);
  });

  it("raises the quarantine alert at 14 days, not 13", () => {
    const at = (days: number) =>
      flaky(`q${days}`, `q${days}`, { status: "quarantined", quarantinedAt: ago(days) });
    expect(flakySummary([at(13)], TODAY).longQuarantined).toEqual([]);
    expect(flakySummary([at(14)], TODAY).longQuarantined).toEqual([
      { id: "q14", name: "q14", days: 14 },
    ]);
    expect(quarantineText(at(13), TODAY)).toBe("Quarantined 13 days");
    expect(quarantineText(flaky("u", "u", { status: "quarantined" }), TODAY)).toBe(
      "Quarantined (date unknown)"
    );
  });

  it("writes a rate as failures of runs, and a legacy row's bare rate", () => {
    expect(rateText(flaky("a", "a", { failures: 3, runs: 40, failureRate: 0.075 }))).toBe(
      "3 of 40 runs (7.5%)"
    );
    expect(
      rateText({ id: "l", name: "l", failureRate: 0.3, status: "active", firstSeenAt: TODAY })
    ).toBe("30% (no run counts)");
  });

  it("names the worst offender and its evidence", () => {
    const text = offendersChartText([
      {
        id: "a",
        name: "a",
        status: "active",
        failureRate: 0.5,
        failures: 4,
        runs: 8,
        fewRuns: true,
      },
    ]);
    expect(text.summary).toBe("a fails most often: 50% of 8 runs, from few runs.");
  });
});

describe("Markdown and the example", () => {
  it("exports the verdict, long quarantines and every test", () => {
    const md = flakyMarkdown(FLAKY_BOARD.tests, TODAY);
    expect(md).toContain(`> ${flakyVerdict(flakySummary(FLAKY_BOARD.tests, TODAY))}`);
    expect(md).toContain("| login › SSO | — | — | — | — | 30% | Active |");
    expect(md).toContain("| checkout › VAT rounding | e2e | Lee | 30 | 200 | 15% | Quarantined |");
  });

  it("is in memory, with a long quarantine, a few-runs test and a fix this quarter", () => {
    const ex = buildExample(TODAY);
    expect(ex.tests.every((t) => t.id.startsWith("example-"))).toBe(true);
    expect(
      ex.tests.every((t) => t.failureRate === (t.failures as number) / (t.runs as number))
    ).toBe(true);
    const s = flakySummary(ex.tests, TODAY);
    expect(s.longQuarantined.map((q) => q.days)).toEqual([20]);
    expect(s.fewRuns).toBe(1);
    expect(s.fixedThisQuarter).toBe(1);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("opens on an empty state and an in-memory example with its alert", () => {
    renderPage();
    expect(screen.getByText(/No flaky tests logged yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByText(/Quarantined 14 days or more:/)).toBeInTheDocument();
    expect(tests()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/No flaky tests logged yet/)).toBeInTheDocument();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("shows inline errors and adds nothing for a bad draft", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Test name/), { target: { value: "auth › signs in" } });
    fireEvent.change(screen.getByLabelText(/^Failed runs/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/^Runs/), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add test" }));
    expect(await screen.findByText("It can't fail more often than it ran.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Failed runs/)).toHaveFocus();
    expect(tests()).toEqual([]);
  });

  it("adds a backdated test with its counts, and the agent reads the same verdict", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Test name/), { target: { value: "auth › signs in" } });
    fireEvent.change(screen.getByLabelText(/^Failed runs/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Runs/), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText(/^First seen/), { target: { value: ago(12) } });
    fireEvent.click(screen.getByRole("button", { name: "Add test" }));
    await waitFor(() => expect(tests()).toHaveLength(1));
    expect(tests()[0]).toMatchObject({
      name: "auth › signs in",
      failures: 3,
      runs: 40,
      failureRate: 3 / 40,
      status: "active",
      firstSeenAt: ago(12),
    });
    const verdict = "1 open flaky test fails 7.5% of 40 runs.";
    expect(screen.getByText(verdict)).toBeInTheDocument();
    const action = registry.get("tool.flaky_tests.list_state")!;
    const agent = (await action.handler!(
      {},
      { userId: "u", source: "agent", squadProfileIds: [] }
    )) as {
      verdict: string;
      weightedFailureRate: { rate: number };
    };
    expect(agent.verdict).toBe(verdict);
    expect(agent.weightedFailureRate.rate).toBeCloseTo(0.075);
  });

  it("weighs the KPI by runs and counts the legacy row it leaves out", () => {
    seed(...FLAKY_BOARD.tests);
    renderPage();
    // Open: ft_1 (30 of 200) and the rate-only ft_legacy; ft_2 is fixed.
    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(
      screen.getByText("Over 200 runs; 1 test without run counts not included")
    ).toBeInTheDocument();
    expect(within(card("login › SSO")).getByText("30% (no run counts)")).toBeInTheDocument();
  });

  it("notes a rate from few runs but still shows it", () => {
    seed(flaky("f", "tiny", { failures: 2, runs: 4, failureRate: 0.5 }));
    renderPage();
    expect(within(card("tiny")).getByText("2 of 4 runs (50%)")).toBeInTheDocument();
    expect(within(card("tiny")).getByText(/Few runs \(under 10\)/)).toBeInTheDocument();
  });

  it("stamps quarantine, alerts from 14 days, and keeps fixedAt when reopened", async () => {
    seed(
      flaky("q", "long one", { status: "quarantined", quarantinedAt: ago(14) }),
      flaky("f", "fixed one", { status: "fixed", fixedAt: ago(3) })
    );
    renderPage();
    expect(screen.getByText(/long one \(14 days\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status for fixed one"), {
      target: { value: "active" },
    });
    await waitFor(() => expect(test("f")?.status).toBe("active"));
    expect(test("f")?.fixedAt).toBe(ago(3));
    expect(within(card("fixed one")).getByText(`Last fixed ${ago(3)}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status for fixed one"), {
      target: { value: "quarantined" },
    });
    await waitFor(() => expect(test("f")?.quarantinedAt).toBe(TODAY));
    expect(within(card("fixed one")).getByText("Quarantined today")).toBeInTheDocument();
  });

  it("keeps the list's order while a status changes, until Re-sort", async () => {
    seed(flaky("a", "alpha"), flaky("b", "beta"), flaky("c", "gamma"));
    renderPage();
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "status" } });
    expect(listNames()).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.change(screen.getByLabelText("Status for alpha"), { target: { value: "fixed" } });
    await waitFor(() => expect(test("a")?.status).toBe("fixed"));
    expect(listNames()).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.click(screen.getByRole("button", { name: /Re-sort/ }));
    expect(listNames()).toEqual(["beta", "gamma", "alpha"]);
  });

  it("edits a test in place, keeping failureRate equal to failures ÷ runs", async () => {
    seed(flaky("a", "alpha", { failures: 1, runs: 10, failureRate: 0.1 }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit alpha" }));
    const editor = screen.getByRole("region", { name: "Edit “alpha”" });
    fireEvent.change(within(editor).getByLabelText(/^Runs/), { target: { value: "40" } });
    fireEvent.change(within(editor).getByLabelText(/^Test name/), { target: { value: "alpha 2" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(test("a")).toMatchObject({ name: "alpha 2", runs: 40, failureRate: 1 / 40 })
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit alpha 2" })).toHaveFocus());
  });

  it("deletes a test with Undo", async () => {
    seed(flaky("a", "alpha"), flaky("b", "beta"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete alpha" }));
    await waitFor(() => expect(tests().map((t) => t.id)).toEqual(["b"]));
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted “alpha”");
    undoLast();
    await waitFor(() => expect(tests().map((t) => t.id)).toEqual(["a", "b"]));
  });

  it("deletes all after a confirm, with Undo", async () => {
    seed(flaky("a", "alpha"), flaky("b", "beta"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(tests()).toEqual([]));
    undoLast();
    await waitFor(() => expect(tests()).toHaveLength(2));
  });
});

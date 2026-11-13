import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX, type RootCauseAnalysis } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

/**
 * Root Cause: a problem taken back to its causes with 5 Whys (a ladder
 * with "is this really why?" checks) or a fishbone (categories, causes and
 * counts, and a Pareto chart), then a root cause, a countermeasure and a
 * send to Retro Actions. Links both ways with Post-Mortem. Every delete has
 * Undo, AI suggestions are accepted one by one, and the example stays an
 * example: never sent, never logged.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
const lastUndo = () => undo.all[undo.all.length - 1];
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: (...args: unknown[]) => cheers.push(args) }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
// Recharts has nothing to measure in jsdom: the chart's sentence and table are tested.
vi.mock("@/app/(tools)/root-cause/pareto-chart", () => ({ ParetoChart: () => null }));

import { RootCauseClient } from "@/app/(tools)/root-cause/root-cause-client";
import { buildExample } from "@/app/(tools)/root-cause/example";
import { rootCauseToMarkdown } from "@/app/(tools)/root-cause/markdown";
import { validateWhy } from "@/app/(tools)/root-cause/five-whys";
import { validateCause } from "@/app/(tools)/root-cause/fishbone";
import { validateAnalysisDraft } from "@/app/(tools)/root-cause/new-analysis-form";
import { countermeasureText } from "@/app/(tools)/root-cause/outcome";
import { paretoText } from "@/app/(tools)/root-cause/pareto";
import { CHECKS_MAX, readChecks, useRootCauseChecks } from "@/app/(tools)/root-cause/checks-store";
import { PM_ID } from "@/app/(tools)/post-mortem/constants";
import {
  categoriesTask,
  fallbackCountermeasures,
  fallbackNextWhys,
} from "@/lib/ai/tasks/root-cause";
import { ROOT_CAUSE_ACTIONS } from "@/lib/history/event-actions";
import { RETRO_BOARD_ID } from "@/lib/handoffs/targets/retro-board";
import { paretoRows } from "@/lib/root-cause/model";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().rootCauseAnalyses ?? [];
const byTitle = (title: string) => stored().find((a) => a.title === title);
const retroCards = () => (ws().retroBoards ?? []).find((b) => b.id === RETRO_BOARD_ID)?.cards ?? [];
const actions = () => logs.map((l) => l.action);

function analysis(
  over: Partial<RootCauseAnalysis> & Pick<RootCauseAnalysis, "id">
): RootCauseAnalysis {
  return {
    title: "Releases rolled back",
    problem: "Two of the last three releases were rolled back.",
    method: "five-whys",
    whys: [],
    causes: [],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...over,
  };
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <RootCauseClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** Blur-commit a field: type, then leave it. */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

beforeEach(() => {
  undo.all = [];
  logs.length = 0;
  cheers.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  window.history.replaceState(null, "", "/root-cause");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({ rootCauseAnalyses: [], retroBoards: [], postMortemLogs: [] });
  useRootCauseChecks.setState({ checks: {}, hiddenCategories: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ── The pure parts ─────────────────────────────────────────────────── */

describe("the checks", () => {
  it("a why needs text within the cap", () => {
    expect(validateWhy("  ")).toBe("Write why it happened.");
    expect(validateWhy("x".repeat(TOOL_TEXT_MAX.text + 1))).toMatch(/Keep it to/);
    expect(validateWhy("Staging is tiny.")).toBeNull();
  });

  it("a cause needs text, a category and a whole count from 0", () => {
    expect(validateCause({ category: "Tools", text: "Split logs", count: "2" })).toEqual({
      ok: true,
      value: { category: "Tools", text: "Split logs", count: 2 },
    });
    const bad = validateCause({ category: " ", text: "", count: "1.5" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["category", "count", "text"]);
    expect(validateCause({ category: "Tools", text: "x", count: "-1" }).ok).toBe(false);
    expect(validateCause({ category: "Tools", text: "x", count: "" }).ok).toBe(false);
  });

  it("a new analysis needs a name for the problem, within the caps", () => {
    expect(validateAnalysisDraft({ title: " ", problem: "", method: "fishbone" })).toEqual({
      ok: false,
      errors: { title: "Name the problem in a few words." },
    });
    const long = validateAnalysisDraft({
      title: "x".repeat(TOOL_TEXT_MAX.short + 1),
      problem: "y".repeat(TOOL_TEXT_MAX.text + 1),
      method: "five-whys",
    });
    expect(long.ok).toBe(false);
    expect(
      validateAnalysisDraft({ title: " Deploys fail ", problem: " Often ", method: "fishbone" })
    ).toEqual({
      ok: true,
      values: { title: "Deploys fail", problem: "Often", method: "fishbone" },
    });
  });

  it("stored why checks are read safely and capped", () => {
    expect(readChecks({ "a:w1": "yes", "a:w2": "no", "a:w3": "maybe", bad: "yes" })).toEqual({
      "a:w1": "yes",
      "a:w2": "no",
    });
    expect(readChecks(["a:w1"])).toEqual({});
    const many = Object.fromEntries(
      Array.from({ length: CHECKS_MAX + 20 }, (_, i) => [`a:w${i}`, "yes"])
    );
    expect(Object.keys(readChecks(many))).toHaveLength(CHECKS_MAX);
  });
});

describe("the Pareto sentence", () => {
  it("names the vital few and how much of the counts they cover", () => {
    const [, checkout] = buildExample();
    const text = paretoText(paretoRows(checkout.causes));
    expect(text.summary).toBe(
      "4 of 6 causes account for 88% of the counts: “No alert on the checkout error rate”, “Support tickets reach the team only once a day”, “The dashboard shows yesterday's numbers” and “The on-call engineer was new and not onboarded”."
    );
    expect(text.table.columns).toEqual([
      "Cause",
      "Category",
      "How often",
      "Running share",
      "Vital few",
    ]);
    expect(text.table.rows[0]).toEqual([
      "No alert on the checkout error rate",
      "Measurement",
      6,
      "35%",
      "Yes",
    ]);
  });

  it("says when no few causes stand out", () => {
    const even = paretoRows([
      { id: "a", category: "Tools", text: "A", count: 1 },
      { id: "b", category: "Tools", text: "B", count: 1 },
    ]);
    expect(paretoText(even).summary).toMatch(/spread out/);
  });
});

describe("the Markdown", () => {
  it("holds each analysis: whys, fishbone, Pareto and the outcome", () => {
    const md = rootCauseToMarkdown(buildExample(), {
      verdict: "One verdict.",
      postMortemTitle: () => undefined,
    });
    expect(md).toContain("# Root-cause analyses");
    expect(md).toContain("> One verdict.");
    expect(md).toContain("## Releases rolled back the same day");
    expect(md).toContain("1. Why? A database migration failed in production.");
    expect(md).toContain("**Measurement**");
    expect(md).toContain("- No alert on the checkout error rate (6)");
    expect(md).toContain(
      "| No alert on the checkout error rate (vital few) | Measurement | 6 | 35% |"
    );
    expect(md).toContain(
      "**Root cause:** Nobody owns keeping staging's data close to production's."
    );
    expect(md).toContain("Check: no rollback caused by a migration over the next three releases.");
  });

  it("escapes pipes in a table cell and says when there's nothing", () => {
    const md = rootCauseToMarkdown([
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [
          { id: "c1", category: "Tools", text: "CI | CD broke", count: 2 },
          { id: "c2", category: "Tools", text: "Slow", count: 1 },
        ],
      }),
    ]);
    expect(md).toContain("CI \\| CD broke");
    expect(rootCauseToMarkdown([])).toContain("No analysis yet.");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the empty page", () => {
  it("offers an example and a form to start, and exports nothing yet", () => {
    renderPage();
    expect(screen.getByText(/No analysis yet\. Name a problem below/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load an example/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start the analysis/ })).toBeInTheDocument();
    expect(exported.markdown).toContain("No analysis yet.");
  });

  it("loads the example as example rows, logs nothing, and clears only them", () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_mine", title: "Ours" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New analysis/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => {
      for (const a of buildExample()) ws().upsertRootCauseAnalysis(a);
    });
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(stored().map((a) => a.id)).toEqual(["rca_mine"]);
    expect(logs).toEqual([]);
  });

  it("loads the example from the empty state", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(stored()).toHaveLength(2);
    expect(stored().every((a) => isExampleId(a.id))).toBe(true);
    expect(screen.getByRole("navigation", { name: "Analyses" })).toBeInTheDocument();
  });
});

describe("starting an analysis", () => {
  it("refuses a nameless problem, then starts one on the chosen method and logs it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Start the analysis/ }));
    expect(screen.getByText("Name the problem in a few words.")).toBeInTheDocument();
    expect(stored()).toEqual([]);
    fireEvent.change(screen.getByLabelText(/The problem, in a few words/), {
      target: { value: "Checkout errors noticed late" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fishbone" }));
    fireEvent.click(screen.getByRole("button", { name: /Start the analysis/ }));
    const a = byTitle("Checkout errors noticed late")!;
    expect(a).toMatchObject({ method: "fishbone", whys: [], causes: [] });
    expect(a.id).toMatch(/^rca_/);
    expect(a.createdAt).toBe(a.updatedAt);
    expect(logs[0]).toEqual({
      action: ROOT_CAUSE_ACTIONS.ANALYSIS_CREATED,
      payload: { analysisId: a.id, title: a.title, method: "fishbone" },
    });
    expect(screen.getByRole("heading", { name: "Fishbone" })).toBeInTheDocument();
  });

  it("opens the analysis named in ?analysis=", () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_a", title: "First", updatedAt: "2026-11-05" })
    );
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_b", title: "Second", updatedAt: "2026-11-01" })
    );
    window.history.replaceState(null, "", "/root-cause?analysis=rca_b");
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Analyses" });
    expect(within(nav).getByRole("button", { name: /Second/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByLabelText("The problem")).toHaveValue("Second");
  });
});

describe("5 Whys", () => {
  beforeEach(() => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1" }));
  });

  const addWhy = (text: string) => {
    fireEvent.change(screen.getByPlaceholderText(/Because…/), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: /Add why/ }));
  };

  it("climbs the ladder: each why answers the line above, logged with its count", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Add why/ }));
    expect(screen.getByText("Write why it happened.")).toBeInTheDocument();
    addWhy("A migration failed in production.");
    addWhy("It never ran on production-sized data.");
    const chain = screen.getByRole("list", { name: "Why chain" });
    expect(within(chain).getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByText(/If we fixed it, would “A migration failed in production\.” stop\?/)
    ).toBeInTheDocument();
    expect(stored()[0].whys.map((w) => w.text)).toEqual([
      "A migration failed in production.",
      "It never ran on production-sized data.",
    ]);
    expect(
      logs.filter((l) => l.action === ROOT_CAUSE_ACTIONS.WHY_ADDED).map((l) => l.payload)
    ).toEqual([
      { analysisId: "rca_1", count: 1 },
      { analysisId: "rca_1", count: 2 },
    ]);
  });

  it("asks 'is this really why?', and a Not really asks for another answer", () => {
    renderPage();
    addWhy("A migration failed.");
    fireEvent.click(screen.getByRole("button", { name: /Not really/ }));
    expect(screen.getByText(/Then it isn't the cause yet/)).toBeInTheDocument();
    const key = `rca_1:${stored()[0].whys[0].id}`;
    expect(useRootCauseChecks.getState().checks[key]).toBe("no");
    fireEvent.click(screen.getByRole("button", { name: /Yes/ }));
    expect(useRootCauseChecks.getState().checks[key]).toBe("yes");
    expect(screen.queryByText(/Then it isn't the cause yet/)).toBeNull();
    // Pressing it again clears the answer.
    fireEvent.click(screen.getByRole("button", { name: /Yes/ }));
    expect(useRootCauseChecks.getState().checks[key]).toBeUndefined();
  });

  it("deletes a why with Undo, back in its place", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        whys: [
          { id: "w1", text: "One" },
          { id: "w2", text: "Two" },
          { id: "w3", text: "Three" },
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete why 2" }));
    expect(stored()[0].whys.map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(lastUndo().label).toBe("Deleted “Two”");
    act(() => lastUndo().revert());
    expect(stored()[0].whys.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("marks a why as the root cause, logs the milestone and cheers", () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_1", whys: [{ id: "w1", text: "Nobody owns staging data." }] })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Mark as root cause: why 1" }));
    expect(stored()[0].rootCause).toBe("Nobody owns staging data.");
    expect(actions()).toContain(ROOT_CAUSE_ACTIONS.ROOT_CAUSE_FOUND);
    expect(cheers).toEqual([["root-cause", "milestone"]]);
    expect(screen.getByLabelText("Root cause")).toHaveValue("Nobody owns staging data.");
    // The list and the analysis both say where it stands.
    expect(screen.getAllByText("Root cause named", { exact: false }).length).toBeGreaterThan(0);
  });

  it("logs a typed root cause as found once; fixing its wording later is an edit, with no cheer", () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1" }));
    renderPage();
    commit(screen.getByLabelText("Root cause"), "Nobody owns staging data");
    expect(stored()[0].rootCause).toBe("Nobody owns staging data");
    expect(actions()).toEqual([ROOT_CAUSE_ACTIONS.ROOT_CAUSE_FOUND]);
    expect(cheers).toHaveLength(1);
    logs.length = 0;
    commit(screen.getByLabelText("Root cause"), "Nobody owns the staging data");
    expect(stored()[0].rootCause).toBe("Nobody owns the staging data");
    expect(logs).toEqual([
      {
        action: ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED,
        payload: { analysisId: "rca_1", field: "rootCause" },
      },
    ]);
    expect(cheers).toHaveLength(1);
    // Leaving the field unchanged logs nothing.
    logs.length = 0;
    commit(screen.getByLabelText("Root cause"), "Nobody owns the staging data");
    expect(logs).toEqual([]);
  });

  it("marking another why as the root cause names the new one, but cheers only the first", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        whys: [
          { id: "w1", text: "The deploy broke." },
          { id: "w2", text: "Nobody owns staging data." },
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Mark as root cause: why 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as root cause: why 2" }));
    expect(stored()[0].rootCause).toBe("Nobody owns staging data.");
    expect(actions().filter((a) => a === ROOT_CAUSE_ACTIONS.ROOT_CAUSE_FOUND)).toHaveLength(2);
    expect(cheers).toEqual([["root-cause", "milestone"]]);
  });

  it("suggests next whys without AI; each one added goes on the ladder with Undo", () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_1", whys: [{ id: "w1", text: "The migration broke." }] })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    const [first] = fallbackNextWhys("", ["The migration broke."]);
    fireEvent.click(screen.getByRole("button", { name: `Add: ${first}` }));
    expect(stored()[0].whys.map((w) => w.text)).toEqual(["The migration broke.", first]);
    expect(lastUndo().label).toBe("Added a why");
    act(() => lastUndo().revert());
    expect(stored()[0].whys.map((w) => w.text)).toEqual(["The migration broke."]);
  });

  it("offers the next whys as alternatives: no Add all, and the rest go once one is picked", async () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_1", whys: [{ id: "w1", text: "The migration broke." }] })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    const candidates = fallbackNextWhys("", ["The migration broke."]);
    expect(candidates.length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: /^Add: / })).toHaveLength(candidates.length);
    expect(screen.queryByRole("button", { name: /^Add all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Add: ${candidates[1]}` }));
    expect(stored()[0].whys.map((w) => w.text)).toEqual(["The migration broke.", candidates[1]]);
    // The others answered the line that was last: they don't stay to be chained under it.
    expect(screen.queryByRole("button", { name: /^Add: / })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Possible next whys" })).toBeNull();
    // Focus lands on the field for the next why, not on the page.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/Because…/))
    );
  });

  it("moves focus to the next why after a delete", async () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        whys: [
          { id: "w1", text: "One" },
          { id: "w2", text: "Two" },
          { id: "w3", text: "Three" },
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete why 2" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Why 2: Three. Edit" })
      )
    );
  });

  it("stops offering a new why once the chain is full", () => {
    const whys = Array.from({ length: TOOL_LIST_MAX.whys }, (_, i) => ({
      id: `w${i}`,
      text: `Why ${i}`,
    }));
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1", whys }));
    renderPage();
    expect(screen.queryByRole("button", { name: /Add why/ })).toBeNull();
    expect(screen.getByText(/the most it can/)).toBeInTheDocument();
  });
});

describe("Fishbone", () => {
  beforeEach(() => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1", method: "fishbone" }));
  });

  const addCause = (category: string, text: string, count = "1") => {
    const form = screen.getByRole("form", { name: "Add a cause" });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: category } });
    fireEvent.change(within(form).getByLabelText("Cause"), { target: { value: text } });
    fireEvent.change(within(form).getByLabelText("How often"), { target: { value: count } });
    fireEvent.click(within(form).getByRole("button", { name: /Add cause/ }));
  };

  it("shows the six starting categories, and adds causes with counts", () => {
    renderPage();
    for (const c of ["People", "Process", "Tools", "Environment", "Measurement", "Other"]) {
      expect(screen.getByRole("group", { name: new RegExp(`^${c}:`) })).toBeInTheDocument();
    }
    addCause("Measurement", "No alert on errors", "6");
    addCause("Process", "Tickets once a day", "3");
    expect(stored()[0].causes.map((c) => [c.category, c.text, c.count])).toEqual([
      ["Measurement", "No alert on errors", 6],
      ["Process", "Tickets once a day", 3],
    ]);
    expect(screen.getByRole("group", { name: "Measurement: 1 cause" })).toBeInTheDocument();
    expect(actions().filter((a) => a === ROOT_CAUSE_ACTIONS.CAUSE_ADDED)).toHaveLength(2);
  });

  it("refuses a bad count and keeps the draft", () => {
    renderPage();
    addCause("Tools", "Split logs", "2.5");
    expect(screen.getByText(/A whole number from 0/)).toBeInTheDocument();
    expect(stored()[0].causes).toEqual([]);
  });

  it("counts a cause up and down, never below zero", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [{ id: "c1", category: "Tools", text: "Split logs", count: 1 }],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "One more for “Split logs”" }));
    expect(stored()[0].causes[0].count).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "One less for “Split logs”" }));
    fireEvent.click(screen.getByRole("button", { name: "One less for “Split logs”" }));
    expect(stored()[0].causes[0].count).toBe(0);
    expect(screen.getByRole("button", { name: "One less for “Split logs”" })).toBeDisabled();
  });

  it("renames a category, moving its causes, and takes the team's own", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [{ id: "c1", category: "Tools", text: "Split logs", count: 1 }],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Rename Tools" }));
    const input = screen.getByLabelText("New name for Tools");
    fireEvent.change(input, { target: { value: "Tooling" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored()[0].causes[0].category).toBe("Tooling");
    // The starting category doesn't come back empty beside its new name.
    expect(screen.queryByRole("group", { name: /^Tools:/ })).toBeNull();
    expect(screen.getByRole("group", { name: "Tooling: 1 cause" })).toBeInTheDocument();
    // Focus follows the box to its new name.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Tooling" }));
    fireEvent.change(screen.getByLabelText("Your own category"), {
      target: { value: "Suppliers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(screen.getByRole("group", { name: "Suppliers: 0 causes" })).toBeInTheDocument();
    addCause("Suppliers", "The provider changed its codes");
    expect(stored()[0].causes[1].category).toBe("Suppliers");
  });

  it("renames or removes an empty starting category, for this analysis, with Undo", () => {
    renderPage();
    // An empty box can be renamed: the starting name goes, the new one stays.
    fireEvent.click(screen.getByRole("button", { name: "Rename People" }));
    const input = screen.getByLabelText("New name for People");
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("group", { name: /^People:/ })).toBeNull();
    expect(screen.getByRole("group", { name: "Staff: 0 causes" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Staff" }));
    // Nothing was stored: a category is only the name on its causes.
    expect(stored()[0].causes).toEqual([]);

    // An empty box can be removed, with Undo; focus moves to the next box.
    fireEvent.click(screen.getByRole("button", { name: "Remove Environment" }));
    expect(screen.queryByRole("group", { name: /^Environment:/ })).toBeNull();
    expect(lastUndo().label).toBe("Removed Environment");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Measurement" }));
    expect(
      within(screen.getByRole("form", { name: "Add a cause" }))
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).not.toContain("Environment");
    act(() => lastUndo().revert());
    expect(screen.getByRole("group", { name: "Environment: 0 causes" })).toBeInTheDocument();

    // A box with causes can't be removed (its causes would have nowhere to go).
    act(() => {
      ws().upsertRootCauseAnalysis(
        analysis({
          id: "rca_1",
          method: "fishbone",
          causes: [{ id: "c1", category: "Tools", text: "Split logs", count: 1 }],
        })
      );
    });
    expect(screen.queryByRole("button", { name: "Remove Tools" })).toBeNull();
  });

  it("brings a hidden starting category back when a cause is filed under it", () => {
    useRootCauseChecks.setState({ checks: {}, hiddenCategories: { rca_1: ["Tools"] } });
    renderPage();
    expect(screen.queryByRole("group", { name: /^Tools:/ })).toBeNull();
    act(() => {
      ws().upsertRootCauseAnalysis(
        analysis({
          id: "rca_1",
          method: "fishbone",
          causes: [{ id: "c1", category: "Tools", text: "Split logs", count: 1 }],
        })
      );
    });
    expect(screen.getByRole("group", { name: "Tools: 1 cause" })).toBeInTheDocument();
  });

  it("keeps focus on a count button that's still there when the other turns off", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [{ id: "c1", category: "Tools", text: "Split logs", count: 1 }],
      })
    );
    renderPage();
    const less = screen.getByRole("button", { name: "One less for “Split logs”" });
    less.focus();
    fireEvent.click(less);
    expect(less).toBeDisabled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "One more for “Split logs”" })
    );
  });

  it("deletes a cause with Undo", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [
          { id: "c1", category: "Tools", text: "Split logs", count: 1 },
          { id: "c2", category: "People", text: "New on call", count: 2 },
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Split logs”" }));
    expect(stored()[0].causes.map((c) => c.id)).toEqual(["c2"]);
    act(() => lastUndo().revert());
    expect(stored()[0].causes.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("moves focus to the next cause in its box after a delete, else to the box's name", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [
          { id: "c1", category: "Tools", text: "Split logs", count: 1 },
          { id: "c2", category: "Tools", text: "No dashboard", count: 2 },
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Split logs”" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "No dashboard. Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete “No dashboard”" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Tools" }));
  });

  it("sorts causes into categories without AI, each move accepted with Undo", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [
          { id: "c1", category: "Other", text: "No alert on the error rate", count: 1 },
          { id: "c2", category: "People", text: "Lunch ran late", count: 1 },
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sort without AI" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move: Move “No alert on the error rate” to Measurement" })
    );
    expect(stored()[0].causes[0].category).toBe("Measurement");
    act(() => lastUndo().revert());
    expect(stored()[0].causes[0].category).toBe("Other");
  });

  it("offers only moves into the board's own categories, in its spelling, one per cause", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        method: "fishbone",
        causes: [
          { id: "c1", category: "Other", text: "No alert on the error rate", count: 1 },
          { id: "c2", category: "Other", text: "Split logs", count: 1 },
        ],
      })
    );
    vi.spyOn(categoriesTask, "fallback").mockReturnValue({
      moves: [
        { causeId: "c1", category: "Monitoring" },
        { causeId: "c2", category: "tools" },
        { causeId: "c2", category: "measurement" },
        { causeId: "gone", category: "Tools" },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sort without AI" }));
    const moves = screen.getAllByRole("button", { name: /^Move: / });
    expect(moves.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Move: Move “Split logs” to Tools",
    ]);
    fireEvent.click(moves[0]);
    expect(stored()[0].causes[1].category).toBe("Tools");
    // A made-up category never reaches the board.
    expect(screen.queryByRole("group", { name: /^Monitoring:/ })).toBeNull();
  });

  it("asks for two counted causes before the Pareto chart, then names the vital few", () => {
    renderPage();
    expect(
      screen.getByText(/Add 2 more causes with a count to see the Pareto chart/)
    ).toBeInTheDocument();
    act(() => {
      ws().upsertRootCauseAnalysis(
        analysis({
          id: "rca_1",
          method: "fishbone",
          causes: [
            { id: "c1", category: "Tools", text: "Split logs", count: 8 },
            { id: "c2", category: "People", text: "New on call", count: 1 },
            { id: "c3", category: "Process", text: "Tickets daily", count: 1 },
          ],
        })
      );
    });
    expect(screen.getByRole("heading", { name: /Pareto/ })).toBeInTheDocument();
    expect(screen.getByText(/One cause account for 80% of the counts/)).toBeInTheDocument();
  });
});

describe("the outcome", () => {
  it("suggests countermeasures without AI once there's a root cause; Use fills it with Undo", () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_1", rootCause: "No owner for staging data." })
    );
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Suggest without AI" })[1]);
    const [first] = fallbackCountermeasures("No owner for staging data.");
    fireEvent.click(screen.getByRole("button", { name: `Use: ${first.text}` }));
    expect(stored()[0].countermeasure).toBe(`${first.text}\nCheck: ${first.check}`);
    expect(countermeasureText(first)).toBe(stored()[0].countermeasure);
    act(() => lastUndo().revert());
    expect(stored()[0].countermeasure).toBeUndefined();
  });

  it("offers countermeasures as alternatives: no Use all, and focus lands on the one used", async () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_1", rootCause: "No owner for staging data." })
    );
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Suggest without AI" })[1]);
    const options = fallbackCountermeasures("No owner for staging data.");
    expect(screen.getAllByRole("button", { name: /^Use: / })).toHaveLength(options.length);
    expect(screen.queryByRole("button", { name: /^Use all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Use: ${options[2].text}` }));
    expect(stored()[0].countermeasure).toBe(countermeasureText(options[2]));
    // One countermeasure, one Undo: the list is gone rather than left to overwrite it.
    expect(undo.all).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Use: / })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/^Countermeasure:/))
    );
  });

  it("sends the countermeasure to Retro Actions once, then links to it", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        rootCause: "No owner for staging data.",
        countermeasure: "Name an owner for staging data.\nCheck: no rollback in three releases.",
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Send to Retro Actions/ }));
    const [card] = retroCards();
    expect(card).toMatchObject({
      text: "Name an owner for staging data.",
      isActionItem: true,
      sourceRef: { tool: "root-cause", id: "rca_1" },
    });
    expect(stored()[0].sentTo).toEqual([
      expect.objectContaining({ route: "retro-action", targetId: card.id }),
    ]);
    expect(actions()).toContain(ROOT_CAUSE_ACTIONS.COUNTERMEASURE_SENT);
    expect(screen.getByRole("link", { name: /In Retro Actions · Open/ })).toHaveAttribute(
      "href",
      "/retro-actions"
    );
    expect(screen.queryByRole("button", { name: /Send to Retro Actions/ })).toBeNull();
    expect(screen.getByText("Someone owns it there until it's done.")).toBeInTheDocument();
  });

  it("stops saying In Retro Actions once that action was deleted there", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        rootCause: "No owner for staging data.",
        countermeasure: "Name an owner for staging data.",
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Send to Retro Actions/ }));
    expect(screen.getAllByText(/In Retro Actions/).length).toBeGreaterThan(0);
    // The action is deleted in Retro Actions.
    act(() => {
      useWorkspaceStore.setState({
        retroBoards: (ws().retroBoards ?? []).map((b) => ({ ...b, cards: [] })),
      });
    });
    expect(screen.getByRole("button", { name: /Send to Retro Actions/ })).toBeEnabled();
    expect(screen.queryByText(/In Retro Actions/)).toBeNull();
    expect(screen.getAllByText(/Countermeasure agreed/).length).toBeGreaterThan(0);
  });

  it("can't send before there's a countermeasure, or from the example", () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1" }));
    renderPage();
    expect(screen.getByRole("button", { name: /Send to Retro Actions/ })).toBeDisabled();
    cleanup();
    useWorkspaceStore.setState({ rootCauseAnalyses: buildExample() });
    renderPage();
    expect(screen.getByRole("button", { name: /Send to Retro Actions/ })).toBeDisabled();
    expect(screen.getByText("Example analyses stay here: nothing is sent.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Amr|without AI/ })).toBeNull();
  });

  it("links to a post-mortem and back, and says when one was deleted", () => {
    useWorkspaceStore.setState({
      postMortemLogs: [
        {
          id: PM_ID,
          postmortems: [
            {
              id: "pm1",
              title: "Checkout outage",
              incidentDate: "2026-11-03",
              status: "draft",
              summary: "",
              factors: [],
              timeline: [],
              actionItems: [],
            },
          ],
        },
      ] as never,
    });
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1" }));
    renderPage();
    fireEvent.change(screen.getByLabelText("Post-mortem"), { target: { value: "pm1" } });
    expect(stored()[0].postMortemId).toBe("pm1");
    expect(screen.getByRole("link", { name: /Open the post-mortem/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Post-mortem"), { target: { value: "" } });
    expect(stored()[0].postMortemId).toBeUndefined();
    act(() => ws().upsertRootCauseAnalysis({ ...stored()[0], postMortemId: "pm-gone" }));
    expect(
      screen.getByRole("option", { name: "A post-mortem that was deleted" })
    ).toBeInTheDocument();
  });

  it("names where it came from, with a link back", () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_1",
        postMortemId: "pm1",
        sourceRef: { tool: "post-mortem", id: "factor:x", doc: "pm1" },
      })
    );
    renderPage();
    expect(screen.getByRole("link", { name: "From post-mortem" })).toHaveAttribute(
      "href",
      "/post-mortem"
    );
  });
});

describe("editing and deleting an analysis", () => {
  it("renames the problem on blur and keeps the name when it's blanked", () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1" }));
    renderPage();
    commit(screen.getByLabelText("The problem"), "Rollbacks after release");
    expect(stored()[0].title).toBe("Rollbacks after release");
    commit(screen.getByLabelText("The problem"), "   ");
    expect(stored()[0].title).toBe("Rollbacks after release");
    commit(screen.getByLabelText("What happened, as a fact"), "Twice in October.");
    expect(stored()[0].problem).toBe("Twice in October.");
    expect(stored()[0].updatedAt > "2026-11-01T09:00:00.000Z").toBe(true);
  });

  it("deletes an analysis with Undo, logged, and moves to the next one", () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_a", title: "First", updatedAt: "2026-11-05" })
    );
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_b", title: "Second", updatedAt: "2026-11-01" })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Delete analysis/ }));
    expect(stored().map((a) => a.id)).toEqual(["rca_b"]);
    expect(actions()).toContain(ROOT_CAUSE_ACTIONS.ANALYSIS_REMOVED);
    expect(screen.getByLabelText("The problem")).toHaveValue("Second");
    act(() => lastUndo().revert());
    expect(
      stored()
        .map((a) => a.id)
        .sort()
    ).toEqual(["rca_a", "rca_b"]);
    expect(screen.getByLabelText("The problem")).toHaveValue("First");
  });

  it("moves focus to the analysis shown after choosing, starting or deleting one", () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_a", title: "First", updatedAt: "2026-11-05" })
    );
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_b", title: "Second", updatedAt: "2026-11-01" })
    );
    renderPage();
    const heading = (title: string) => screen.getByText(title, { selector: "span[tabindex='-1']" });
    // Opening the page doesn't steal focus.
    expect(document.activeElement).toBe(document.body);
    // On a phone the chosen analysis opens below the list: focus goes to it.
    fireEvent.click(screen.getByRole("button", { name: /^Second/ }));
    expect(document.activeElement).toBe(heading("Second"));
    fireEvent.click(screen.getByRole("button", { name: /Delete analysis/ }));
    expect(stored().map((a) => a.id)).toEqual(["rca_a"]);
    expect(document.activeElement).toBe(heading("First"));
  });

  it("logs nothing for edits to the example, and cheers for none", () => {
    useWorkspaceStore.setState({ rootCauseAnalyses: buildExample() });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Releases rolled back the same day/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Mark as root cause: why/ })[0]);
    expect(logs).toEqual([]);
    expect(cheers).toEqual([]);
  });

  it("puts the verdict and every analysis in the export", async () => {
    ws().upsertRootCauseAnalysis(
      analysis({ id: "rca_1", rootCause: "No owner.", updatedAt: "2026-11-05" })
    );
    renderPage();
    await waitFor(() => expect(exported.markdown).toContain("## Releases rolled back"));
    expect(exported.markdown).toContain(
      "> 1 analysis has a root cause but no countermeasure yet: agree what the team will change."
    );
    expect(exported.markdown).toContain("**Root cause:** No owner.");
  });
});

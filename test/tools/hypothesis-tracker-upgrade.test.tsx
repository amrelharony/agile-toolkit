import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hypothesis } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { todayLocalISO } from "@/lib/utils/formatters";
import { isExampleId } from "@/lib/utils/example-id";
import { HYPOTHESIS_TRACKER_ID, validationRate } from "@/lib/hypotheses/model";
import { registry } from "@/lib/actions/registry";
import { HYPOTHESES } from "../stores/phase8-fixtures";

/**
 * Hypothesis Tracker, upgraded (Phase 8): draft-then-save through
 * lib/hypotheses' validateHypothesis; a status filter with "Needs detail"
 * for hand-off drafts, which can't run until they're complete; a numeric
 * target whose measured result suggests a verdict the team applies; a
 * validation rate without inconclusive results ("—" with no decisive
 * one), the same as the agent reads; backdatable days; where a hypothesis
 * came from; delete with Undo; the time to learn behind Advanced
 * analysis; an example and a Markdown export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/hypothesis-tracker/charts", () => ({ SurvivalCurveChart: () => null }));

import { HypothesisTrackerClient } from "@/app/(tools)/hypothesis-tracker/hypothesis-tracker-client";
import { buildExample } from "@/app/(tools)/hypothesis-tracker/example";
import { hypothesesToMarkdown } from "@/app/(tools)/hypothesis-tracker/markdown";
import {
  countedRows,
  filterCounts,
  rateOf,
  rateText,
  targetText,
  timeToLearn,
} from "@/app/(tools)/hypothesis-tracker/view";
import "@/lib/actions/tools/hypothesis-tracker";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n) as string;

const hyp = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `belief ${id}`,
  willDo: "do a thing",
  toLearn: "learn a thing",
  successMetric: "it works",
  status: "drafted",
  raisedAt: ago(10),
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const one = (id: string) => stored().find((h) => h.id === id);
const seed = (...list: Hypothesis[]) =>
  useWorkspaceStore.setState({
    hypothesisTrackers: list.length > 0 ? [{ id: HYPOTHESIS_TRACKER_ID, hypotheses: list }] : [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <HypothesisTrackerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (believe: string) => screen.getByRole("article", { name: believe });
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.hypothesis_tracker.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  seed();
});

/* ── The page's reading of the list ─────────────────────────────────── */

describe("the rate, the filter and the target", () => {
  it("leaves inconclusive results out of the rate and reads — with no decisive one", () => {
    const list = [
      hyp("a", { status: "validated", resolvedAt: ago(1) }),
      hyp("b", { status: "inconclusive", resolvedAt: ago(1) }),
      hyp("c", { status: "running" }),
    ];
    const r = rateOf(countedRows(list));
    expect(r).toMatchObject({ validated: 1, inconclusive: 1, decisive: 1, open: 1, rate: 1 });
    expect(rateText(r)).toBe("100%");
    const none = rateOf(countedRows([hyp("x", { status: "inconclusive", resolvedAt: ago(1) })]));
    expect(none.rate).toBeNull();
    expect(rateText(none)).toBe("—");
    expect(rateText(rateOf(countedRows([])))).toBe("—");
  });

  it("counts the team's rows only, and the example's while it is alone", () => {
    const example = buildExample(TODAY);
    expect(countedRows(example).example).toBe(true);
    expect(rateOf(countedRows(example)).decisive).toBe(2);
    const mixed = [...example, hyp("real", { status: "validated", resolvedAt: ago(1) })];
    expect(countedRows(mixed)).toMatchObject({ example: false });
    expect(rateOf(countedRows(mixed))).toMatchObject({ validated: 1, decisive: 1 });
  });

  it("counts each filter option, Needs detail for hand-off drafts", () => {
    const counts = filterCounts([
      hyp("a"),
      hyp("b", { status: "running" }),
      hyp("c", { status: "validated", resolvedAt: ago(1) }),
      hyp("d", { status: "invalidated", resolvedAt: ago(1) }),
      hyp("e", { status: "inconclusive", resolvedAt: ago(1) }),
      hyp("f", { willDo: "", successMetric: "" }),
    ]);
    expect(counts).toEqual({
      all: 6,
      open: 3,
      validated: 1,
      invalidated: 1,
      inconclusive: 1,
      "needs-detail": 1,
    });
  });

  it("says a target in words, both ways", () => {
    expect(targetText({ direction: "increase", value: 12, unit: "%", baseline: 10 })).toBe(
      "at least 12% (from 10%)"
    );
    expect(targetText({ direction: "decrease", value: 3, unit: "days" })).toBe("at most 3 days");
  });

  it("shows the time to learn only from five results", () => {
    const resolved = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        hyp(`r${i}`, { status: "validated", raisedAt: ago(20), resolvedAt: ago(20 - (i + 2)) })
      );
    const few = timeToLearn(resolved(4), new Date());
    expect(few).toMatchObject({ resolved: 4, enough: false, median: null, points: [] });
    const enough = timeToLearn(resolved(5), new Date());
    expect(enough.enough).toBe(true);
    expect(enough.median).not.toBeNull();
    expect(enough.summary).toMatch(/^Half of the tests gave a result within \d+ days/);
    expect(enough.table.rows.length).toBe(enough.points.length);
    // A result in a status with none (legacy) isn't a result.
    expect(
      timeToLearn([hyp("x", { status: "running", resolvedAt: ago(1) })], new Date()).resolved
    ).toBe(0);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("adding a hypothesis", () => {
  it("saves nothing until every line is there, then Enter adds it first", () => {
    seed(hyp("old"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New hypothesis" }));
    fireEvent.click(screen.getByRole("button", { name: "Add hypothesis" }));
    expect(stored()).toHaveLength(1);
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Say what you believe/)])
    );
    // The first invalid field has focus.
    expect(document.activeElement).toBe(screen.getByLabelText(/^We believe/));

    fireEvent.change(screen.getByLabelText(/^We believe/), { target: { value: "  teams pay  " } });
    fireEvent.change(screen.getByLabelText(/^We will/), { target: { value: "ask 10 teams" } });
    fireEvent.change(screen.getByLabelText(/^To learn/), { target: { value: "if they pay" } });
    fireEvent.change(screen.getByLabelText(/^Success looks like/), {
      target: { value: "3 say yes" },
    });
    const form = screen.getByLabelText(/^We believe/).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Raised on/), { target: { value: ago(4) } });
    fireEvent.submit(form);
    expect(stored()).toHaveLength(2);
    expect(stored()[0]).toMatchObject({
      believe: "teams pay",
      status: "drafted",
      raisedAt: ago(4),
    });
    expect(stored()[0].target).toBeUndefined();
    expect(stored()[0].actual).toBeUndefined();
  });

  it("refuses a future day and a baseline on the wrong side of the target", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New hypothesis" }));
    for (const [label, value] of [
      [/^We believe/, "b"],
      [/^We will/, "w"],
      [/^To learn/, "l"],
      [/^Success looks like/, "s"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText(/^Raised on/), {
      target: { value: addDays(TODAY, 1) },
    });
    fireEvent.change(screen.getByLabelText(/^The number should/), {
      target: { value: "increase" },
    });
    fireEvent.change(screen.getByLabelText(/^Target/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Baseline/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Add hypothesis" }));
    expect(stored()).toHaveLength(0);
    expect(screen.getByText(/hasn't happened yet/)).toBeInTheDocument();
    expect(screen.getByText(/must be above the baseline/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Raised on/), { target: { value: ago(3) } });
    fireEvent.change(screen.getByLabelText(/^Target/), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/^Unit/), { target: { value: "%" } });
    fireEvent.click(screen.getByRole("button", { name: "Add hypothesis" }));
    expect(stored()[0].target).toEqual({
      direction: "increase",
      value: 15,
      unit: "%",
      baseline: 12,
    });
  });

  it("logs a past test with its result day, never before it was raised", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New hypothesis" }));
    for (const [label, value] of [
      [/^We believe/, "b"],
      [/^We will/, "w"],
      [/^To learn/, "l"],
      [/^Success looks like/, "s"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText(/^Raised on/), { target: { value: ago(10) } });
    fireEvent.change(screen.getByLabelText(/^Status/), { target: { value: "validated" } });
    expect(screen.getByLabelText(/^Result on/)).toHaveValue(TODAY);
    fireEvent.change(screen.getByLabelText(/^Result on/), { target: { value: ago(12) } });
    fireEvent.click(screen.getByRole("button", { name: "Add hypothesis" }));
    expect(stored()).toHaveLength(0);
    expect(screen.getByText(/can't come before the day it was raised/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Result on/), { target: { value: ago(2) } });
    fireEvent.click(screen.getByRole("button", { name: "Add hypothesis" }));
    expect(stored()[0]).toMatchObject({ status: "validated", resolvedAt: ago(2) });
  });
});

describe("a card", () => {
  it("suggests a verdict from the measured result and applies it only on a click", () => {
    seed(
      hyp("t", {
        believe: "trials convert",
        status: "running",
        target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
      })
    );
    renderPage();
    const c = card("trials convert");
    expect(within(c).getByText("at least 12% (from 10%)")).toBeInTheDocument();
    const result = within(c).getByLabelText(/^Measured result/);
    fireEvent.change(result, { target: { value: "abc" } });
    fireEvent.blur(result);
    expect(within(c).getByText("Enter a number.")).toBeInTheDocument();
    expect(one("t")?.actual).toBeUndefined();

    fireEvent.change(result, { target: { value: "14" } });
    fireEvent.blur(result);
    expect(one("t")).toMatchObject({ actual: 14, status: "running" });
    expect(
      within(card("trials convert")).getByText(
        /Target met: 14% against at least 12% \(up 4 from 10%\)/
      )
    ).toBeInTheDocument();

    fireEvent.click(
      within(card("trials convert")).getByRole("button", {
        name: /Mark “trials convert” validated/,
      })
    );
    expect(one("t")).toMatchObject({ status: "validated", resolvedAt: TODAY });
    // Applied: no button to apply it again.
    expect(
      within(card("trials convert")).queryByRole("button", { name: /Mark .* validated/ })
    ).toBeNull();
  });

  it("suggests invalidated when a fall misses, and blank clears the result (never 0)", () => {
    seed(
      hyp("d", {
        believe: "fewer days",
        status: "running",
        target: { direction: "decrease", value: 3, unit: "days" },
        actual: 4,
      })
    );
    renderPage();
    expect(
      within(card("fewer days")).getByText(/Target missed: 4 days against at most 3 days/)
    ).toBeInTheDocument();
    const result = within(card("fewer days")).getByLabelText(/^Measured result/);
    fireEvent.change(result, { target: { value: " " } });
    fireEvent.blur(result);
    expect(one("d")).not.toHaveProperty("actual");
  });

  it("keeps a hand-off draft drafted until what we'll do and the metric are in", () => {
    seed(
      hyp("h", {
        believe: "pricing confuses buyers",
        willDo: "",
        successMetric: "",
        toLearn: "",
        sourceRef: { tool: "cynefin", id: "c1" },
      })
    );
    renderPage();
    const c = card("pricing confuses buyers");
    expect(
      within(c).getByText(/Needs detail: what we'll do and the success metric/)
    ).toBeInTheDocument();
    // Where it came from.
    expect(within(c).getByRole("link", { name: /From Cynefin/ })).toHaveAttribute(
      "href",
      "/cynefin"
    );

    fireEvent.change(within(c).getByLabelText(/^Status of/), { target: { value: "running" } });
    expect(one("h")?.status).toBe("drafted");
    expect(within(c).getByRole("alert")).toHaveTextContent(
      /Add what we'll do and the success metric before it moves on/
    );

    fireEvent.click(within(c).getByRole("button", { name: "Add the detail" }));
    // The editor: a blank "to learn" may stay blank on a draft that never had one.
    fireEvent.change(screen.getByLabelText(/^We will/), {
      target: { value: "interview five buyers" },
    });
    fireEvent.change(screen.getByLabelText(/^Success looks like/), {
      target: { value: "four of five get it" },
    });
    fireEvent.change(screen.getByLabelText(/^Status/), { target: { value: "running" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(one("h")).toMatchObject({
      status: "running",
      willDo: "interview five buyers",
      sourceRef: { tool: "cynefin", id: "c1" },
    });
  });

  it("filters to Needs detail and back", () => {
    seed(hyp("ok", { believe: "complete one" }), hyp("draft", { believe: "a draft", willDo: "" }));
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Needs detail (1)" }));
    expect(screen.queryByRole("article", { name: "complete one" })).toBeNull();
    expect(card("a draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(card("complete one")).toBeInTheDocument();
  });

  it("backdates the raised day but not into the future, and not past its result", () => {
    seed(
      hyp("r", {
        believe: "resolved one",
        status: "validated",
        raisedAt: ago(10),
        resolvedAt: ago(5),
      })
    );
    renderPage();
    const c = card("resolved one");
    const raised = within(c).getByLabelText(/^Raised on, resolved one/);
    fireEvent.change(raised, { target: { value: addDays(TODAY, 2) } });
    fireEvent.blur(raised);
    expect(one("r")?.raisedAt).toBe(ago(10));
    fireEvent.change(raised, { target: { value: ago(3) } });
    fireEvent.blur(raised);
    expect(one("r")?.raisedAt).toBe(ago(10));
    expect(within(c).getByText(/can't come before the day it was raised/)).toBeInTheDocument();
    fireEvent.change(raised, { target: { value: ago(30) } });
    fireEvent.blur(raised);
    expect(one("r")?.raisedAt).toBe(ago(30));

    const result = within(card("resolved one")).getByLabelText(/^Result on, resolved one/);
    fireEvent.change(result, { target: { value: ago(20) } });
    fireEvent.blur(result);
    expect(one("r")?.resolvedAt).toBe(ago(20));
  });

  it("moving back to running clears the result day but keeps what was learned", () => {
    seed(
      hyp("b", {
        believe: "back again",
        status: "invalidated",
        resolvedAt: ago(2),
        outcome: "It didn't move.",
      })
    );
    renderPage();
    fireEvent.change(within(card("back again")).getByLabelText(/^Status of/), {
      target: { value: "running" },
    });
    expect(one("b")).toMatchObject({ status: "running", outcome: "It didn't move." });
    expect(one("b")).not.toHaveProperty("resolvedAt");
    expect(within(card("back again")).getByLabelText("What we learned")).toHaveValue(
      "It didn't move."
    );
  });

  it("deletes with Undo, back in its place with its id", () => {
    seed(
      hyp("a", { believe: "first" }),
      hyp("b", { believe: "second" }),
      hyp("c", { believe: "third" })
    );
    renderPage();
    fireEvent.click(within(card("second")).getByRole("button", { name: "Delete second" }));
    expect(stored().map((h) => h.id)).toEqual(["a", "c"]);
    undoLast();
    expect(stored().map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a legacy row as stored until it is edited", () => {
    const long = "x".repeat(2500);
    seed(
      hyp("legacy", {
        believe: "legacy one",
        description: long,
        raisedAt: "2026-01-05T09:00:00.000Z",
      })
    );
    renderPage();
    expect(card("legacy one")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit legacy one" }));
    fireEvent.change(screen.getByLabelText(/^We will/), { target: { value: "a new plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The long text is kept; the stamp reads as its day.
    expect(one("legacy")).toMatchObject({
      willDo: "a new plan",
      description: long,
      raisedAt: "2026-01-05",
    });
  });
});

describe("the summary", () => {
  it("shows the rate the agent reads, and the time to learn only behind Advanced analysis", async () => {
    seed(
      hyp("v", { status: "validated", resolvedAt: ago(1) }),
      hyp("i", { status: "invalidated", resolvedAt: ago(1) }),
      hyp("n", { status: "inconclusive", resolvedAt: ago(1) }),
      hyp("o", { status: "running" })
    );
    renderPage();
    expect(
      screen.getByText(
        "1 of 2 decisive tests held up (50%); 1 inconclusive isn't counted; 1 still open."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 decisive · 1 inconclusive not counted")).toBeInTheDocument();
    expect(
      screen.getByText(/Record 2 more results to see how long tests take/)
    ).toBeInTheDocument();

    const agent = await run<{ validationRate: number | null; decisive: number; verdict: string }>(
      "list_state"
    );
    expect(agent.validationRate).toBe(validationRate(stored()).rate);
    expect(agent.verdict).toBe(
      "1 of 2 decisive tests held up (50%); 1 inconclusive isn't counted; 1 still open."
    );
  });

  it("reads — with no decisive result, on the page and for the agent", async () => {
    seed(hyp("n", { status: "inconclusive", resolvedAt: ago(1) }));
    renderPage();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("no decisive result yet")).toBeInTheDocument();
    expect((await run<{ validationRate: number | null }>("list_state")).validationRate).toBeNull();
  });

  it("an agent's validated add stamps its result day, and the page counts it", async () => {
    const added = await run<{ added: boolean; id: string }>("add_hypothesis", {
      believe: "agents add",
      willDo: "w",
      toLearn: "l",
      successMetric: "s",
      status: "validated",
    });
    expect(added.added).toBe(true);
    expect(one(added.id)).toMatchObject({ status: "validated", resolvedAt: TODAY });
    renderPage();
    expect(screen.getByText("1 of 1 decisive test held up (100%).")).toBeInTheDocument();
  });

  it("reads the fixture's legacy rows as the agent does", async () => {
    seed(...HYPOTHESES.hypotheses);
    renderPage();
    expect(card("Teams will pay for a second seat")).toBeInTheDocument();
    expect(
      within(card("Teams will pay for a second seat")).getByText(
        /Target missed: 5.5% against at least 8%/
      )
    ).toBeInTheDocument();
    const agent = await run<{ validationRate: number | null; inconclusive: number }>("list_state");
    expect(agent).toMatchObject({ validationRate: null, inconclusive: 1 });
    expect(screen.getByText("no decisive result yet")).toBeInTheDocument();
  });
});

describe("first run, example and export", () => {
  it("offers the example from the empty state, and clears only it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().every((h) => isExampleId(h.id))).toBe(true);
    expect(stored()).toHaveLength(6);
    // The example's own numbers fill the summary.
    expect(
      screen.getByText(/1 of 2 decisive tests held up \(50%\)/, { selector: "p" })
    ).toBeInTheDocument();
    expect(screen.getByText("(the example)")).toBeInTheDocument();

    act(() => {
      ws().upsertHypothesisTracker({
        id: HYPOTHESIS_TRACKER_ID,
        hypotheses: [hyp("mine"), ...stored()],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((h) => h.id)).toEqual(["mine"]);
  });

  it("the example passes the form's own checks", async () => {
    const { validateHypothesis, hypothesisDraftFrom } = await import("@/lib/hypotheses/model");
    for (const h of buildExample(TODAY)) {
      expect(validateHypothesis(hypothesisDraftFrom(h), TODAY).ok, h.id).toBe(true);
    }
  });

  it("exports Markdown with the verdict, the rate and each hypothesis's detail", () => {
    const list = [
      hyp("v", {
        believe: "exports get used",
        status: "validated",
        resolvedAt: ago(1),
        target: { direction: "increase", value: 50, unit: "%" },
        actual: 70,
        outcome: "Used twice or more.",
        sourceRef: { tool: "riskiest-assumption", id: "a1" },
      }),
      hyp("n", { believe: "unclear", status: "inconclusive", resolvedAt: ago(1) }),
      hyp("d", { believe: "a draft", willDo: "", successMetric: "" }),
    ];
    const md = hypothesesToMarkdown(list, rateOf(countedRows(list)));
    expect(md).toContain("# Hypothesis Tracker");
    expect(md).toContain(
      "> 1 of 1 decisive test held up (100%); 1 inconclusive isn't counted; 1 still open."
    );
    expect(md).toContain(
      "Validation rate: 100% (1 of 1 decisive; inconclusive results aren't counted)"
    );
    expect(md).toContain("## Validated (1)");
    expect(md).toContain("- **Target:** at least 50%");
    expect(md).toContain("- **Measured:** 70%");
    expect(md).toContain("Suggested verdict: validated.");
    expect(md).toContain("- **Source:** From riskiest assumption");
    expect(md).toContain("- **Needs detail:** what we'll do and the success metric");
    expect(hypothesesToMarkdown([], rateOf(countedRows([])))).toContain("No hypotheses yet.");
  });

  it("passes the same Markdown to the export button", () => {
    seed(hyp("a", { believe: "on screen" }));
    renderPage();
    expect(screen.getByTestId("export-markdown").textContent).toContain("### We believe on screen");
  });
});

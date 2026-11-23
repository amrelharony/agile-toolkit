import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AbTest, Hypothesis, ProductMetric } from "@/lib/stores/workspace-types";
import { AB_CALCULATOR_ACTIONS } from "@/lib/history/event-actions";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * A/B Calculator (shelved, on the full contract) on workspace.abTests: a
 * plan that sizes as you type (3,841 a version for 10% → 12%, ten days at
 * 800 a day, run whole weeks), the smallest effect by weeks, a read of the
 * counts with "Too early to call" until the plan is met and a note with no
 * plan, a save that checks the plan and the details first, open, edit and
 * delete with Undo, status, decision and note on a card, checks suggested
 * without AI (guardrails and risks, with Undo), the hypothesis read live,
 * the `?hypothesis=` link, the example and the Markdown export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ab-calculator",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { AbCalculatorClient } from "@/app/(tools)/ab-calculator/ab-calculator-client";
import { buildExample } from "@/app/(tools)/ab-calculator/example";
import { testsToMarkdown } from "@/app/(tools)/ab-calculator/markdown";
import {
  hypothesisLine,
  metricLine,
  planForHypothesis,
  validateDetails,
  emptyDetailsDraft,
} from "@/app/(tools)/ab-calculator/view";

const TODAY = todayLocalISO();
const AT = "2026-11-12T09:00:00.000Z";
const ws = () => useWorkspaceStore.getState();
const tests = () => ws().abTests ?? [];
const find = (id: string) => tests().find((t) => t.id === id);

const PLAN = {
  baseline: 0.1,
  mde: 0.2,
  mdeMode: "relative" as const,
  confidence: 0.95,
  power: 0.8,
  sided: "two" as const,
  dailyTraffic: 800,
};
const saved = (over: Partial<AbTest> = {}): AbTest => ({
  id: "t1",
  name: "Shorter form",
  plan: { ...PLAN },
  variants: [
    { id: "a", name: "A", visitors: 4020, conversions: 402 },
    { id: "b", name: "B", visitors: 3980, conversions: 477 },
  ],
  status: "running",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const hyp = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `belief ${id}`,
  willDo: "do a thing",
  toLearn: "learn a thing",
  successMetric: "sign-ups",
  status: "running",
  raisedAt: "2026-10-01",
  ...over,
});
const seed = (
  abTests: AbTest[],
  hypotheses: Hypothesis[] = [],
  productMetrics: ProductMetric[] = []
) =>
  useWorkspaceStore.setState({
    abTests,
    productMetrics,
    hypothesisTrackers: hypotheses.length ? [{ id: HYPOTHESIS_TRACKER_ID, hypotheses }] : [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <AbCalculatorClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const plan = (baseline: string, mde: string, traffic?: string) => {
  type(/^Current conversion rate/, baseline);
  type(/^Smallest change worth finding/, mde);
  if (traffic !== undefined) type(/^Visitors a day/, traffic);
};
const countsOf = (av: string, ac: string, bv: string, bc: string) => {
  type("A visitors", av);
  type("A conversions", ac);
  type("B visitors", bv);
  type("B conversions", bc);
};
const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });
const card = (name: string) => screen.getByRole("article", { name });
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const logged = (action: string) => logs.filter((l) => l.action === action);
const announced = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(text));

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  search.value = "";
  localStorage.clear();
  seed([]);
});
afterEach(() => vi.useRealTimers());

/* ── Plan ────────────────────────────────────────────────────────────── */

describe("plan", () => {
  it("waits for the rate and the change, then sizes the test as you type", () => {
    renderPage();
    expect(screen.getByText(/Enter the current rate and the smallest change/)).toBeInTheDocument();
    plan("10", "20");
    expect(screen.getByText("3,841 people a version, 7,682 in all")).toBeInTheDocument();
    expect(screen.getByText(/Add visitors a day to see how long that takes/)).toBeInTheDocument();
    type(/^Visitors a day/, "800");
    expect(screen.getByText(/10 days at 800 a day, so run 2 whole weeks\./)).toBeInTheDocument();
  });

  it("tables the smallest effect findable in 1 to 4 weeks", () => {
    renderPage();
    plan("10", "20", "800");
    const table = screen.getByRole("table", { name: "The smallest effect you could find" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(within(rows[2]).getByText("2 weeks")).toBeInTheDocument();
    expect(within(rows[2]).getByText("5,600")).toBeInTheDocument();
  });

  it("follows confidence, power, sides and how the change is counted", () => {
    renderPage();
    plan("10", "20");
    fireEvent.click(radio("Sides", "One-sided"));
    expect(screen.getByText("3,026 people a version, 6,052 in all")).toBeInTheDocument();
    fireEvent.click(radio("Sides", "Two-sided"));
    fireEvent.click(radio("Power", "90%"));
    expect(screen.getByText(/^5,142 people a version/)).toBeInTheDocument();
    fireEvent.click(radio("Power", "80%"));
    fireEvent.click(radio("Count the change as", "Points"));
    type(/^Smallest change worth finding/, "2");
    expect(screen.getByText(/^3,841 people a version/)).toBeInTheDocument();
  });

  it("says when to pick a bigger effect, and refuses a change past 100%", () => {
    renderPage();
    plan("0.01", "1");
    expect(screen.getByText(/Pick a bigger effect/)).toBeInTheDocument();
    plan("60", "80");
    expect(screen.getByText(/takes B's rate to 100% or more/)).toBeInTheDocument();
  });
});

/* ── Read ────────────────────────────────────────────────────────────── */

describe("read the result", () => {
  it("reads B against A at the plan's confidence once the sample is in", () => {
    renderPage();
    plan("10", "20", "800");
    countsOf("4020", "402", "3980", "477");
    const verdict = screen.getByText(/^B converted better than A by 2\.0 points/);
    expect(verdict).toHaveAttribute("role", "status");
    expect(verdict.textContent).toContain("(95% interval +0.6 to +3.4 points; p = 0.0045)");
    // Cards on a phone, a table from md up: both carry the rates.
    expect(screen.getAllByText("12.0%").length).toBeGreaterThan(0);
    expect(screen.getByText(/Split check: p 0\.65, as even as planned\./)).toBeInTheDocument();
  });

  it("calls it too early below the planned sample, and still shows the numbers", () => {
    renderPage();
    plan("10", "20");
    countsOf("4000", "400", "3100", "380");
    expect(screen.getByText("Too early to call: 3,100 of 3,841 per variant")).toBeInTheDocument();
    expect(screen.getByText(/^So far: B converted better than A/)).toBeInTheDocument();
  });

  it("shows the verdict without a plan, with a note to plan first next time", () => {
    renderPage();
    countsOf("1000", "200", "1000", "250");
    expect(screen.getByText(/^B converted better than A by 5\.0 points/)).toBeInTheDocument();
    expect(screen.getByText("Decide the sample before you start next time.")).toBeInTheDocument();
  });

  it("warns when the split is off, and says what a typed count needs", () => {
    renderPage();
    countsOf("10000", "1000", "10600", "1100");
    expect(screen.getByText(/^Check the setup before trusting this/)).toBeInTheDocument();
    type("B conversions", "20000");
    expect(screen.getByText("Can't be more than B's visitors.")).toBeInTheDocument();
  });
});

/* ── Save ────────────────────────────────────────────────────────────── */

describe("saving a test", () => {
  it("saves nothing until it has a name and a plan, then saves it with its counts", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(screen.getByText(/Name the test/)).toBeInTheDocument();
    expect(tests()).toEqual([]);
    type(/^Test name/, "Shorter form");
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(tests()).toEqual([]);
    await announced("Not saved yet: fix the plan or the counts first.");
    expect(screen.getByText("Enter the current conversion rate.")).toBeInTheDocument();

    plan("10", "20", "800");
    countsOf("4020", "402", "3980", "477");
    fireEvent.click(radio("Status", "Running"));
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(tests()).toHaveLength(1);
    const t = tests()[0];
    expect(t).toMatchObject({
      name: "Shorter form",
      plan: PLAN,
      status: "running",
      startedOn: TODAY,
      variants: [
        { id: "a", name: "A", visitors: 4020, conversions: 402 },
        { id: "b", name: "B", visitors: 3980, conversions: 477 },
      ],
    });
    expect(t.id).toMatch(/^abtest_/);
    expect(logged(AB_CALCULATOR_ACTIONS.TEST_SAVED)[0].payload).toEqual({
      testId: t.id,
      perVariant: 3841,
      days: 10,
    });
    expect(logged(AB_CALCULATOR_ACTIONS.COUNTS_RECORDED)[0].payload).toEqual({
      testId: t.id,
      significant: true,
    });
    // Saved, the calculator now edits it.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("opens a saved test in the calculator and saves its new counts", async () => {
    seed([
      saved({
        variants: saved().variants.map((v) => ({ ...v, visitors: 1000, conversions: 100 })),
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Open Shorter form in the calculator" }));
    await announced("Opened “Shorter form” in the calculator");
    expect(screen.getByLabelText(/^Current conversion rate/)).toHaveValue("10");
    expect(screen.getByLabelText("A visitors")).toHaveValue("1000");
    expect(screen.getByLabelText(/^Test name/)).toHaveValue("Shorter form");
    type("B visitors", "1200");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(find("t1")?.variants[1].visitors).toBe(1200);
    expect(logged(AB_CALCULATOR_ACTIONS.TEST_UPDATED)).toHaveLength(1);
    expect(logged(AB_CALCULATOR_ACTIONS.COUNTS_RECORDED)).toHaveLength(1);
    // Nothing changed: nothing saved again.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(logged(AB_CALCULATOR_ACTIONS.TEST_UPDATED)).toHaveLength(1);
    // New test empties the calculator.
    fireEvent.click(screen.getByRole("button", { name: "New test" }));
    expect(screen.getByLabelText(/^Test name/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save test" })).toBeInTheDocument();
  });
});

/* ── A saved test's card ─────────────────────────────────────────────── */

describe("a saved test", () => {
  it("reads its plan and result on the card", () => {
    seed([saved()]);
    renderPage();
    const c = card("Shorter form");
    expect(
      within(c).getByText(/^3,841 a version to find \+20\.0% of the current rate/)
    ).toBeInTheDocument();
    expect(within(c).getByText(/^B converted better than A/)).toBeInTheDocument();
  });

  it("deletes with Undo, back with its id", () => {
    seed([saved(), saved({ id: "t2", name: "Other", createdAt: "2026-11-01T00:00:00.000Z" })]);
    renderPage();
    fireEvent.click(
      within(card("Shorter form")).getByRole("button", { name: "Delete Shorter form" })
    );
    expect(find("t1")).toBeUndefined();
    expect(logged(AB_CALCULATOR_ACTIONS.TEST_REMOVED)[0].payload).toEqual({ testId: "t1" });
    undoLast();
    expect(find("t1")?.name).toBe("Shorter form");
  });

  it("moves its status, stamping the days, and records the decision and a note", () => {
    seed([saved({ status: "planned" })]);
    renderPage();
    const c = card("Shorter form");
    fireEvent.click(within(c).getByRole("radio", { name: "Done" }));
    expect(find("t1")).toMatchObject({ status: "done", startedOn: TODAY, endedOn: TODAY });
    expect(logged(AB_CALCULATOR_ACTIONS.TEST_UPDATED)).toHaveLength(1);
    fireEvent.click(within(card("Shorter form")).getByRole("radio", { name: "Ship B" }));
    expect(find("t1")?.decision).toBe("ship");
    expect(logged(AB_CALCULATOR_ACTIONS.DECISION_SET)[0].payload).toEqual({
      testId: "t1",
      decision: "ship",
    });
    fireEvent.click(within(card("Shorter form")).getByRole("radio", { name: "Not yet" }));
    expect(find("t1")).not.toHaveProperty("decision");
    const note = within(card("Shorter form")).getByLabelText("Note");
    fireEvent.change(note, { target: { value: "B goes to everyone." } });
    fireEvent.blur(note);
    expect(find("t1")?.note).toBe("B goes to everyone.");
  });

  it("suggests checks without AI: a guardrail and a risk go in with Undo", async () => {
    seed([saved()]);
    renderPage();
    fireEvent.click(
      await within(card("Shorter form")).findByRole("button", { name: "Suggest checks" })
    );
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Add: Guardrail: Error rate" }));
    expect(find("t1")?.guardrails).toEqual([
      { name: "Error rate", why: "B could convert more people while the step breaks for others." },
    ]);
    fireEvent.click(within(list).getByRole("button", { name: /^Add: Run whole weeks/ }));
    expect(find("t1")?.note).toBe("Run whole weeks, so weekdays and weekends both count.");
    undoLast();
    expect(find("t1")).not.toHaveProperty("note");
    expect(find("t1")?.guardrails).toHaveLength(1);
  });

  it("keeps at most three guardrails, and removes one with Undo", async () => {
    seed([
      saved({
        guardrails: [
          { name: "One", why: "a" },
          { name: "Two", why: "b" },
          { name: "Three", why: "c" },
        ],
      }),
    ]);
    renderPage();
    fireEvent.click(
      await within(card("Shorter form")).findByRole("button", { name: "Suggest checks" })
    );
    fireEvent.click(
      within(await screen.findByTestId("ai-suggestions")).getByRole("button", {
        name: "Add: Guardrail: Error rate",
      })
    );
    expect(find("t1")?.guardrails).toHaveLength(3);
    await announced(/keeps 3 guardrails/);
    fireEvent.click(screen.getByRole("button", { name: "Remove the guardrail Two" }));
    expect(find("t1")?.guardrails?.map((g) => g.name)).toEqual(["One", "Three"]);
    undoLast();
    expect(find("t1")?.guardrails?.map((g) => g.name)).toEqual(["One", "Two", "Three"]);
  });

  it("reads its hypothesis live, and sends the result to the hypothesis card, never writing it", () => {
    seed(
      [saved({ hypothesisId: "h1", decision: "ship" })],
      [hyp("h1", { believe: "short forms convert" })]
    );
    renderPage();
    const c = card("Shorter form");
    expect(within(c).getByText("Tests “short forms convert” · Running")).toBeInTheDocument();
    expect(within(c).getByRole("link", { name: "open the Hypothesis Tracker" })).toHaveAttribute(
      "href",
      "/hypothesis-tracker"
    );
    act(() =>
      useWorkspaceStore.setState({
        hypothesisTrackers: [{ id: HYPOTHESIS_TRACKER_ID, hypotheses: [] }],
      })
    );
    expect(within(card("Shorter form")).getByText("Hypothesis removed")).toBeInTheDocument();
  });
});

/* ── Links, example, export ──────────────────────────────────────────── */

describe("the ?hypothesis= link", () => {
  it("opens a new plan for the hypothesis, its baseline from a % target", async () => {
    search.value = "hypothesis=h1";
    seed(
      [],
      [
        hyp("h1", {
          believe: "a 30-day trial converts better",
          target: { direction: "increase", value: 12, unit: "%", baseline: 9 },
        }),
      ]
    );
    renderPage();
    await announced("A new plan for “a 30-day trial converts better”");
    expect(screen.getByLabelText(/^Current conversion rate/)).toHaveValue("9");
    expect(screen.getByLabelText(/^Test name/)).toHaveValue("a 30-day trial converts better");
    expect(screen.getByLabelText("Hypothesis it tests (optional)")).toHaveValue("h1");
  });

  it("says so when the hypothesis is gone", async () => {
    search.value = "hypothesis=gone";
    renderPage();
    await announced("That hypothesis isn't in the Hypothesis Tracker any more.");
  });
});

describe("first run, example and export", () => {
  it("offers the example from the empty state, unlogged, and clears only it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      tests()
        .map((t) => t.id)
        .sort()
    ).toEqual(["example-ab-annual", "example-ab-signup"]);
    expect(screen.getByText(/Example: a sign-up test/)).toBeInTheDocument();
    act(() => ws().upsertAbTest(saved({ id: "mine", name: "Mine" })));
    fireEvent.click(within(card("Shorter sign-up form")).getByRole("radio", { name: "Ship B" }));
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(tests().map((t) => t.id)).toEqual(["mine"]);
    undoLast();
    expect(tests()).toHaveLength(3);
  });

  it("the example's numbers are the published ones", () => {
    const [signup, annual] = buildExample(TODAY);
    const md = testsToMarkdown([signup, annual]);
    expect(md).toContain("## Shorter sign-up form");
    expect(md).toContain(
      "3,841 people a version, 7,682 in all, 10 days at 800 visitors a day (2 weeks)"
    );
    expect(md).toContain("| A | 4,020 | 402 | 10.0% (9.1% to 11.0%) |");
    expect(md).toContain("- **Difference:** +2.0 points (95% interval +0.6 to +3.4)");
    expect(md).toContain("- **Lift:** +19.8% (95% interval +5.7% to +35.8%)");
    expect(md).toContain("- **p:** 0.0045");
    expect(md).toContain("- **Split check:** p 0.65: the split is as even as planned.");
    expect(md).toContain("- **Guardrails:** Error rate");
    expect(md).toContain("## Annual plan banner");
    expect(md).toContain("- **Result:** No counts yet.");
    expect(md).toContain("## How to read this");
    expect(md).toContain("- A confidence interval is the range of effects these numbers fit.");
    expect(testsToMarkdown([])).toContain("No saved tests yet.");
  });

  it("passes the same Markdown to the export button", () => {
    seed([saved({ decision: "keep", note: "A stays." })]);
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("## Shorter form");
    expect(md).toContain("- **Decision:** Keep A");
    expect(md).toContain("- **Note:** A stays.");
  });

  it("explains how to read a result in two plain lines", () => {
    renderPage();
    expect(screen.getByText("How to read this")).toBeInTheDocument();
    expect(
      screen.getByText(
        "p is how often a difference this big or bigger would turn up if A and B were really the same."
      )
    ).toBeInTheDocument();
  });
});

describe("the page's own reading", () => {
  it("checks the details: a name, within the caps", () => {
    expect(validateDetails(emptyDetailsDraft())).toMatchObject({ ok: false });
    expect(validateDetails({ ...emptyDetailsDraft(), name: "x".repeat(201) })).toMatchObject({
      ok: false,
    });
    expect(
      validateDetails({ ...emptyDetailsDraft(), name: " A ", metricId: "", hypothesisId: "h1" })
    ).toEqual({
      ok: true,
      values: {
        name: "A",
        question: undefined,
        metricName: undefined,
        metricId: undefined,
        hypothesisId: "h1",
        status: "planned",
      },
    });
  });

  it("starts a plan for a hypothesis only from a % baseline inside 0–100", () => {
    expect(
      planForHypothesis(
        hyp("h", { target: { direction: "increase", value: 5, unit: "days", baseline: 9 } })
      ).plan.baselinePct
    ).toBe("");
    expect(
      planForHypothesis(
        hyp("h", { target: { direction: "increase", value: 12, unit: " % ", baseline: 9 } })
      ).plan.baselinePct
    ).toBe("9");
  });

  it("names a missing hypothesis or metric", () => {
    expect(hypothesisLine(undefined, [])).toBeNull();
    expect(hypothesisLine("x", [])?.text).toBe("Hypothesis removed");
    expect(metricLine("m1", "sign-ups", [])).toBe("sign-ups: metric removed");
    expect(metricLine(undefined, " typed ", [])).toBe("typed");
  });
});

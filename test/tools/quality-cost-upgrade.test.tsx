import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  QUALITY_COST_KEY,
  costBreakdown,
  failureShareTrend,
  failureShareVerdict,
  hoursTimesRate,
  normalizeQualityCostState,
  type QualityCostPeriod,
} from "@/lib/quality/cost";
import { currentQuarterIndex, dashQuarter } from "@/lib/roadmap/quarters";
import { registry } from "@/lib/actions/registry";

/**
 * Cost of Quality, quarter by quarter: a draft-then-save form per quarter
 * (QuarterPicker, amounts or hours × the hourly rate, inline errors), the
 * failure share's trend (ChartFigure from two quarters, Mann-Kendall in
 * Advanced analysis from six), the figures from before quarters offered as
 * "Save as a period" (never given a quarter on their own), edit in place,
 * delete and clear with Undo, an in-memory example, Markdown, and the page
 * and tool.quality_cost.list_periods reading the same blob the same way.
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
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/quality-cost/charts", () => ({
  CostDistributionChart: () => null,
  FailureShareChart: () => null,
}));

import "@/lib/actions/tools/quality-cost";
import { QualityCostClient } from "@/app/(tools)/quality-cost/quality-cost-client";
import { buildExample } from "@/app/(tools)/quality-cost/example";
import { qualityCostMarkdown } from "@/app/(tools)/quality-cost/markdown";
import {
  emptyPeriodDraft,
  validatePeriod,
  type PeriodDraft,
} from "@/app/(tools)/quality-cost/period-form";
import { distributionText, failureShareChartText } from "@/app/(tools)/quality-cost/view";

const NOW = currentQuarterIndex();
/** The quarter `back` quarters before this one, dash form. */
const q = (back: number) => dashQuarter(NOW - back);

const period = (
  id: string,
  quarter: string,
  costs: QualityCostPeriod["costs"],
  extra: Partial<QualityCostPeriod> = {}
): QualityCostPeriod => ({ id, period: quarter, costs, ...extra });

const blob = () => JSON.parse(window.localStorage.getItem(QUALITY_COST_KEY) ?? "null");
const seed = (value: unknown) =>
  window.localStorage.setItem(QUALITY_COST_KEY, JSON.stringify(value));

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <QualityCostClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  act(() => call?.[1]?.action?.onClick());
};

const draft = (patch: Partial<PeriodDraft> = {}): PeriodDraft => ({
  ...emptyPeriodDraft(),
  ...patch,
});
const amounts = (a: Partial<PeriodDraft["amounts"]>) => ({ ...emptyPeriodDraft().amounts, ...a });

beforeEach(() => {
  window.localStorage.clear();
  toastSpy.mockReset();
  logSpy.mockReset();
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("a quarter's draft", () => {
  it("needs a quarter and at least one cost, never a $0 default", () => {
    const v = validatePeriod(draft(), [], undefined);
    expect(v).toEqual({
      ok: false,
      errors: {
        period: "Pick the quarter these figures are for.",
        prevention: "Enter at least one cost.",
      },
    });
  });

  it("keeps a typed 0 and leaves a blank category out", () => {
    const v = validatePeriod(
      draft({ period: q(1), amounts: amounts({ prevention: "0", externalFailure: "$1,250.456" }) }),
      [],
      undefined
    );
    expect(v).toEqual({
      ok: true,
      values: { period: q(1), costs: { prevention: 0, externalFailure: 1250.46 } },
    });
  });

  it("refuses a negative or non-number amount inline", () => {
    const v = validatePeriod(
      draft({ period: q(1), amounts: amounts({ detection: "-5", internalFailure: "lots" }) }),
      [],
      undefined
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.detection).toBe("Enter an amount of 0 or more.");
      expect(v.errors.internalFailure).toBe("Enter an amount of 0 or more.");
    }
  });

  it("refuses a quarter already logged, except the one being edited", () => {
    const logged = [period("a", q(1), { prevention: 1 })];
    const d = draft({ period: q(1), amounts: amounts({ prevention: "5" }) });
    const v = validatePeriod(d, logged, undefined);
    expect(!v.ok && v.errors.period).toBe(`Already logged: edit ${q(1)} below.`);
    expect(validatePeriod(d, logged, undefined, "a").ok).toBe(true);
  });

  it("works a cost out as hours × the rate, and needs the rate first", () => {
    const byHours = { ...emptyPeriodDraft().byHours, prevention: true };
    const hours = { ...emptyPeriodDraft().hours, prevention: "40" };
    const noRate = validatePeriod(draft({ period: q(1), byHours, hours }), [], undefined);
    expect(noRate).toEqual({
      ok: false,
      errors: { "hours-prevention": "Enter the hourly rate first." },
    });
    expect(validatePeriod(draft({ period: q(1), byHours, hours }), [], 82.5)).toEqual({
      ok: true,
      values: { period: q(1), costs: { prevention: 3300 }, hours: { prevention: 40 } },
    });
    const bad = validatePeriod(
      draft({ period: q(1), byHours, hours: { ...hours, prevention: "-1" } }),
      [],
      50
    );
    expect(!bad.ok && bad.errors["hours-prevention"]).toBe("Enter hours of 0 or more.");
  });

  it("puts 'at least one cost' on the hours box when the first category takes hours", () => {
    const byHours = { ...emptyPeriodDraft().byHours, prevention: true };
    const v = validatePeriod(draft({ period: q(1), byHours }), [], 50);
    expect(!v.ok && v.errors).toEqual({ "hours-prevention": "Enter at least one cost." });
  });
});

describe("the shared maths the page reads", () => {
  it("tells absent from 0, and has no share at a total of 0", () => {
    expect(costBreakdown({ prevention: 0, internalFailure: 0 }).failureShare).toBeNull();
    expect(costBreakdown({ internalFailure: 100 }).failureShare).toBeNull();
    expect(costBreakdown({ prevention: 0, internalFailure: 100 }).failureShare).toBe(1);
    expect(costBreakdown({}).missing).toHaveLength(4);
  });

  it("hours × rate at 0, a negative and a huge value", () => {
    expect(hoursTimesRate(0, 90)).toBe(0);
    expect(hoursTimesRate(-1, 90)).toBeNull();
    expect(hoursTimesRate(10, -90)).toBeNull();
    expect(hoursTimesRate(1e9, 1e9)).toBe(1e18);
  });

  it("reads the old single-period blob the same however often it is normalised", () => {
    const legacy = {
      preventionCost: 500,
      detectionCost: 0,
      internalFailureCost: 300,
      externalFailureCost: 0,
    };
    const once = normalizeQualityCostState(legacy);
    expect(normalizeQualityCostState(once)).toEqual(once);
    expect(once).toEqual(legacy);
  });

  it("gates the trend test at six quarters with a share", () => {
    const ps = Array.from({ length: 6 }, (_, k) =>
      period(`p${k}`, q(6 - k), { prevention: 100, internalFailure: 10 * (k + 1) })
    );
    expect(failureShareTrend(ps.slice(0, 5)).trend).toBeNull();
    expect(failureShareTrend(ps).trend).not.toBeNull();
  });
});

describe("chart text and Markdown", () => {
  it("summarises the failure share line, with a gap for a quarter without a share", () => {
    const trend = failureShareTrend([
      period("a", q(3), { prevention: 60, internalFailure: 40 }),
      period("b", q(2), { internalFailure: 10 }),
      period("c", q(1), { prevention: 75, externalFailure: 25 }),
    ]);
    const text = failureShareChartText(trend);
    expect(text.summary).toBe(`The failure share fell from 40% in ${q(3)} to 25% in ${q(1)}.`);
    expect(text.table.rows).toEqual([
      [q(3), "$100", "40%"],
      [q(2), "$10", "—"],
      [q(1), "$100", "25%"],
    ]);
  });

  it("names a category not entered rather than showing $0", () => {
    const text = distributionText({ prevention: 300, internalFailure: 100 }, q(1));
    expect(text.slices.map((s) => s.name)).toEqual(["Prevention", "Internal failure"]);
    expect(text.table.rows[1]).toEqual(["Detection (appraisal)", "Not entered", "—"]);
    expect(text.summary).toBe(`Prevention is the largest share of ${q(1)}'s $400: 75%.`);
  });

  it("exports the quarters, the verdict and figures not yet saved as a quarter", () => {
    const md = qualityCostMarkdown({
      preventionCost: 200,
      hourlyRate: 80,
      periods: [
        period("a", q(2), { prevention: 600, internalFailure: 400 }, { note: "Q | note" }),
        period("b", q(1), { prevention: 800, externalFailure: 200 }, { hours: { prevention: 10 } }),
      ],
    });
    expect(md).toContain(
      `> Failure costs were 20% of quality spend in ${q(1)}, down 20 points on ${q(2)}.`
    );
    expect(md).toContain("Hourly rate for hours × rate: $80");
    expect(md).toContain(
      `| ${q(2)} | $600 | Not entered | $400 | Not entered | $1,000 | 40% | Q \\| note |`
    );
    expect(md).toContain("$800 (10 h)");
    expect(md).toContain("## Figures not yet saved as a quarter");
    expect(md).toContain("- Prevention: $200");
  });
});

describe("the example", () => {
  it("is six quarters of example rows with a rate, up then down", () => {
    const ex = buildExample();
    expect(ex.periods).toHaveLength(6);
    expect(ex.periods?.every((p) => p.id.startsWith("example-"))).toBe(true);
    expect(ex.periods?.[5].period).toBe(q(1));
    const trend = failureShareTrend(ex.periods ?? []);
    expect(trend.trend).not.toBeNull();
    const shares = trend.points.map((p) => Math.round((p.share ?? 0) * 100));
    expect(Math.max(...shares)).toBe(shares[2]);
    expect(shares[5]).toBeLessThan(shares[2]);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("opens on an empty state and an in-memory example that never touches the blob", async () => {
    renderPage();
    expect(screen.getByText(/No quarters logged yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(await screen.findByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Logged quarters/ })).toBeInTheDocument();
    // Six quarters with a share: the trend test runs inside Advanced analysis.
    expect(screen.getByText(/Mann-Kendall over 6 quarters/)).toBeInTheDocument();
    expect(blob() ?? {}).not.toHaveProperty("periods");
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/No quarters logged yet/)).toBeInTheDocument();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("shows inline errors and saves nothing for an empty draft", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save quarter" }));
    expect(await screen.findByText("Pick the quarter these figures are for.")).toBeInTheDocument();
    expect(screen.getByText("Enter at least one cost.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Quarter/)).toHaveFocus();
    expect(blob()?.periods ?? []).toHaveLength(0);
  });

  it("saves a quarter, gives the verdict, and the agent reads the same", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Quarter/), { target: { value: q(1) } });
    fireEvent.change(screen.getByLabelText("Prevention"), { target: { value: "700" } });
    fireEvent.change(screen.getByLabelText("Internal failure"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save quarter" }));
    const verdict = `Failure costs were 30% of quality spend in ${q(1)}.`;
    expect(await screen.findByText(verdict)).toBeInTheDocument();
    await waitFor(() => expect(blob()?.periods).toHaveLength(1));
    expect(blob().periods[0]).toMatchObject({
      period: q(1),
      costs: { prevention: 700, internalFailure: 300 },
    });
    expect(blob().periods[0].costs).not.toHaveProperty("detection");

    const action = registry.get("tool.quality_cost.list_periods")!;
    const out = (await action.handler!(
      {},
      { userId: "u", source: "agent", squadProfileIds: [] }
    )) as {
      verdict: string;
      periods: { failureShare: number }[];
    };
    expect(out.verdict).toBe(verdict);
    expect(out.periods[0].failureShare).toBe(0.3);
  });

  it("works a cost out from hours once the rate is set", async () => {
    renderPage();
    const rate = screen.getByLabelText(/Blended hourly rate/);
    fireEvent.change(rate, { target: { value: "-3" } });
    fireEvent.blur(rate);
    expect(await screen.findByText("Enter a rate of 0 or more.")).toBeInTheDocument();
    fireEvent.change(rate, { target: { value: "50" } });
    fireEvent.blur(rate);
    await waitFor(() => expect(blob()?.hourlyRate).toBe(50));
    fireEvent.click(screen.getByRole("button", { name: "Work out Prevention as hours × rate" }));
    fireEvent.change(screen.getByLabelText("Prevention hours"), { target: { value: "12" } });
    expect(screen.getByText("= $600 at $50 an hour")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Quarter/), { target: { value: q(2) } });
    fireEvent.click(screen.getByRole("button", { name: "Save quarter" }));
    await waitFor(() => expect(blob()?.periods).toHaveLength(1));
    expect(blob().periods[0]).toMatchObject({
      costs: { prevention: 600 },
      hours: { prevention: 12 },
    });
  });

  it("edits a quarter in place and deletes it with Undo", async () => {
    seed({
      periods: [
        period("a", q(2), { prevention: 500, internalFailure: 500 }),
        period("b", q(1), { prevention: 900, internalFailure: 100 }),
      ],
    });
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: `Edit ${q(2)}` }))[0]);
    const panel = screen.getByRole("heading", { name: `Edit ${q(2)}` })
      .parentElement as HTMLElement;
    const prevention = within(panel).getByLabelText("Prevention");
    expect(prevention).toHaveValue("500");
    fireEvent.change(prevention, { target: { value: "1500" } });
    fireEvent.click(within(panel).getByRole("button", { name: `Save ${q(2)}` }));
    await waitFor(() => expect(blob().periods[0].costs.prevention).toBe(1500));
    expect(screen.queryByRole("heading", { name: `Edit ${q(2)}` })).toBeNull();
    // The table's button (the phone cards' copy is hidden on a wide screen).
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: `Edit ${q(2)}` })[0]).toHaveFocus()
    );

    fireEvent.click(screen.getAllByRole("button", { name: `Delete ${q(1)}` })[0]);
    await waitFor(() => expect(blob().periods).toHaveLength(1));
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe(`Deleted ${q(1)}`);
    undoLast();
    await waitFor(() =>
      expect(blob().periods.map((p: QualityCostPeriod) => p.id)).toEqual(["a", "b"])
    );
  });

  it("clears the history after a confirm, keeps the rate, and Undo brings it back", async () => {
    seed({ hourlyRate: 60, periods: [period("a", q(1), { prevention: 1 })] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Clear history" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear history" })
    );
    await waitFor(() => expect(blob().periods).toEqual([]));
    expect(blob().hourlyRate).toBe(60);
    undoLast();
    await waitFor(() => expect(blob().periods).toHaveLength(1));
  });

  it("offers the old figures as a period, only once a quarter is picked", async () => {
    seed({
      preventionCost: 400,
      detectionCost: 0,
      internalFailureCost: 100,
      externalFailureCost: 0,
      description: "Old run",
    });
    renderPage();
    expect(await screen.findByText("Figures from before quarters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as a period" }));
    expect(await screen.findByText("Pick the quarter these figures are for.")).toBeInTheDocument();
    expect(blob()).not.toHaveProperty("periods");
    fireEvent.change(screen.getByLabelText(/Quarter these figures cover/), {
      target: { value: q(3) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as a period" }));
    await waitFor(() => expect(blob().periods).toHaveLength(1));
    expect(blob().periods[0]).toMatchObject({
      period: q(3),
      costs: { prevention: 400, detection: 0, internalFailure: 100, externalFailure: 0 },
      note: "Old run",
    });
    expect(blob()).not.toHaveProperty("preventionCost");
    expect(screen.queryByText("Figures from before quarters")).toBeNull();
  });

  it("discards the old figures with Undo", async () => {
    seed({ preventionCost: 400, internalFailureCost: 100 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Discard them" }));
    await waitFor(() => expect(blob()).not.toHaveProperty("preventionCost"));
    undoLast();
    await waitFor(() => expect(blob().preventionCost).toBe(400));
  });

  it("states the verdict the shared library words", async () => {
    const ps = [
      period("a", q(2), { prevention: 500, internalFailure: 500 }),
      period("b", q(1), { prevention: 580, internalFailure: 420 }),
    ];
    seed({ periods: ps });
    renderPage();
    const verdict = failureShareVerdict(failureShareTrend(ps)) as string;
    expect(verdict).toBe(
      `Failure costs were 42% of quality spend in ${q(1)}, down 8 points on ${q(2)}. That is above the 30% mark.`
    );
    expect(await screen.findByText(verdict)).toBeInTheDocument();
  });
});

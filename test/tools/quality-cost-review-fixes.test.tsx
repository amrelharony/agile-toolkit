import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QUALITY_COST_KEY, type QualityCostPeriod } from "@/lib/quality/cost";
import { currentQuarterIndex, dashQuarter } from "@/lib/roadmap/quarters";

/**
 * Cost of Quality, after review: an edited quarter keeps the cost its
 * hours were priced at (a note-only edit never reprices it at today's
 * rate, and a cleared rate never blocks it); a side of the split with
 * nothing entered reads "Not entered" and exports a blank cell, never $0;
 * the hours toggle is a plain action (no aria-pressed beside a name that
 * flips) whose name holds its visible text; focus has somewhere to go
 * after a delete or a clear; and the AI prompts name a category that
 * wasn't entered as unknown, never as $0.
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
const exportSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: unknown) => {
    exportSpy(props);
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: vi.fn() }),
}));
vi.mock("@/app/(tools)/quality-cost/charts", () => ({
  CostDistributionChart: () => null,
  FailureShareChart: () => null,
}));

import { QualityCostClient } from "@/app/(tools)/quality-cost/quality-cost-client";
import {
  draftFromPeriod,
  keptHoursCost,
  validatePeriod,
} from "@/app/(tools)/quality-cost/period-form";
import { notEnteredNote, qualityCostPrompts } from "@/app/(tools)/quality-cost/prompts";
import { sideAmount, sideText } from "@/app/(tools)/quality-cost/view";

const NOW = currentQuarterIndex();
const q = (back: number) => dashQuarter(NOW - back);

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

const press = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

/** 200 h of prevention saved at $75 an hour, beside a typed failure cost. */
const PRICED: QualityCostPeriod = {
  id: "qcp_priced",
  period: q(2),
  costs: { prevention: 15000, internalFailure: 5000 },
  hours: { prevention: 200 },
  note: "Training week",
};

beforeEach(() => {
  window.localStorage.clear();
  toastSpy.mockReset();
  exportSpy.mockReset();
  promptSpy.mockReset();
});

describe("an edited quarter keeps the price of its hours", () => {
  it("reuses the stored cost for hours left as they were, at any rate or none", () => {
    const draft = { ...draftFromPeriod(PRICED), note: "Training week (fixed typo)" };
    expect(keptHoursCost(draft, "prevention", PRICED)).toBe(15000);
    for (const rate of [80, undefined]) {
      const v = validatePeriod(draft, [PRICED], rate, PRICED.id, PRICED);
      expect(v).toEqual({
        ok: true,
        values: {
          period: q(2),
          costs: { prevention: 15000, internalFailure: 5000 },
          hours: { prevention: 200 },
          note: "Training week (fixed typo)",
        },
      });
    }
  });

  it("prices hours changed in the edit at the current rate, which they then need", () => {
    const draft = draftFromPeriod(PRICED);
    draft.hours.prevention = "210";
    expect(keptHoursCost(draft, "prevention", PRICED)).toBeUndefined();
    const v = validatePeriod(draft, [PRICED], 80, PRICED.id, PRICED);
    expect(v.ok && v.values.costs.prevention).toBe(16800);
    const noRate = validatePeriod(draft, [PRICED], undefined, PRICED.id, PRICED);
    expect(noRate.ok).toBe(false);
    if (!noRate.ok) expect(noRate.errors["hours-prevention"]).toBe("Enter the hourly rate first.");
  });

  it("never keeps a cost for a new quarter, or for hours that weren't stored", () => {
    const draft = draftFromPeriod(PRICED);
    expect(keptHoursCost(draft, "prevention", undefined)).toBeUndefined();
    draft.byHours.internalFailure = true;
    draft.hours.internalFailure = "5000";
    expect(keptHoursCost(draft, "internalFailure", PRICED)).toBeUndefined();
  });

  it("saves a note-only edit without repricing after the rate changed", async () => {
    seed({ hourlyRate: 80, periods: [PRICED] });
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: `Edit ${q(2)}` }))[0]);
    const panel = screen.getByRole("heading", { name: `Edit ${q(2)}` })
      .parentElement as HTMLElement;
    expect(within(panel).getByText("= $15,000, as saved for these hours")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText(/^Note/), { target: { value: "Fixed typo" } });
    fireEvent.click(within(panel).getByRole("button", { name: `Save ${q(2)}` }));
    await waitFor(() => expect(blob().periods[0].note).toBe("Fixed typo"));
    expect(blob().periods[0].costs).toEqual({ prevention: 15000, internalFailure: 5000 });
  });

  it("saves the edit with no rate set, with no rate error on the kept hours", async () => {
    seed({ periods: [PRICED] });
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: `Edit ${q(2)}` }))[0]);
    const panel = screen.getByRole("heading", { name: `Edit ${q(2)}` })
      .parentElement as HTMLElement;
    expect(within(panel).queryByText("Enter the hourly rate first.")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: `Save ${q(2)}` }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: `Edit ${q(2)}` })).toBeNull());
    expect(blob().periods[0].costs.prevention).toBe(15000);
  });
});

describe("a side with nothing entered", () => {
  const failuresOnly = { internalFailure: 300, externalFailure: 700 };

  it("reads 'Not entered', never $0", () => {
    expect(sideAmount(failuresOnly, "conformance")).toBeNull();
    expect(sideText(failuresOnly, "conformance")).toBe("Not entered");
    expect(sideText(failuresOnly, "nonConformance")).toBe("$1,000");
    // A side entered as $0 is $0: it was typed.
    expect(sideText({ prevention: 0, internalFailure: 5 }, "conformance")).toBe("$0");
  });

  it("shows 'Not entered' on the KPI and exports a blank cell", () => {
    seed({ periods: [{ id: "a", period: q(1), costs: failuresOnly }] });
    renderPage();
    const shown = screen.getByRole("region", { name: q(1) });
    expect(within(shown).getByText("Not entered")).toBeInTheDocument();
    expect(within(shown).queryByText("$0")).toBeNull();
    // The total and the failure side.
    expect(within(shown).getAllByText("$1,000")).toHaveLength(2);
    const csv = exportSpy.mock.calls.at(-1)?.[0] as {
      csvData: { headers: string[]; rows: unknown[][] };
    };
    const row = csv.csvData.rows[0];
    const col = (name: string) => row[csv.csvData.headers.indexOf(name)];
    expect(col("Conformance")).toBe("");
    expect(col("Non-conformance")).toBe(1000);
  });
});

describe("the hours toggle", () => {
  it("is an action named for what it does next, with no aria-pressed", () => {
    renderPage();
    const toggle = screen.getByRole("button", { name: "Work out Prevention as hours × rate" });
    expect(toggle).not.toHaveAttribute("aria-pressed");
    fireEvent.click(toggle);
    const back = screen.getByRole("button", { name: "Enter an amount for Prevention" });
    expect(back).not.toHaveAttribute("aria-pressed");
  });

  it("holds its visible text in its name, both ways round", () => {
    renderPage();
    const named = (b: HTMLElement) =>
      (b.getAttribute("aria-label") ?? "").toLowerCase().includes(b.textContent!.toLowerCase());
    const toggle = screen.getByRole("button", { name: "Work out Prevention as hours × rate" });
    expect(toggle).toHaveTextContent("Hours × rate");
    expect(named(toggle)).toBe(true);
    fireEvent.click(toggle);
    const back = screen.getByRole("button", { name: "Enter an amount for Prevention" });
    expect(back).toHaveTextContent("Enter an amount");
    expect(named(back)).toBe(true);
  });
});

describe("the AI prompts", () => {
  const FAILURES_ONLY: QualityCostPeriod = {
    id: "f",
    period: q(1),
    costs: { internalFailure: 300, externalFailure: 700 },
  };

  it("name the categories not entered as unknown, in every prompt", () => {
    const prompts = qualityCostPrompts(FAILURES_ONLY);
    expect(prompts).toHaveLength(2);
    for (const p of prompts) {
      expect(p.prompt).toContain(
        `Prevention and Detection (appraisal) weren't entered for ${q(1)}. Read their $0 above as unknown, not as zero spend`
      );
    }
    expect(notEnteredNote(["detection"], "2026-Q1")).toContain(
      "Detection (appraisal) wasn't entered for 2026-Q1. Read its $0 above"
    );
  });

  it("add nothing when all four were entered, and stay empty for a $0 quarter", () => {
    const full: QualityCostPeriod = {
      id: "full",
      period: q(1),
      costs: { prevention: 1, detection: 2, internalFailure: 3, externalFailure: 4 },
    };
    expect(notEnteredNote([], q(1))).toBeNull();
    const prompts = qualityCostPrompts(full);
    expect(prompts).toHaveLength(2);
    for (const p of prompts) expect(p.prompt).not.toContain("Not entered");
    // Nothing above $0 is nothing to ask about: the generator returns no prompts.
    expect(qualityCostPrompts({ id: "z", period: q(1), costs: { prevention: 0 } })).toEqual([]);
  });

  it("are the page's prompts for the quarter shown", () => {
    seed({ periods: [FAILURES_ONLY] });
    renderPage();
    const props = promptSpy.mock.calls.at(-1)?.[0] as {
      config: { prompts: { prompt: string }[] };
    };
    expect(props.config.prompts.map((p) => p.prompt)).toEqual(
      qualityCostPrompts(FAILURES_ONLY).map((p) => p.prompt)
    );
    expect(props.config.prompts[0].prompt).toContain("## Not entered");
  });
});

describe("focus after a delete or a clear", () => {
  it("moves to the neighbouring quarter's Edit, then to the form", async () => {
    seed({
      periods: [
        { id: "a", period: q(2), costs: { prevention: 500 } },
        { id: "b", period: q(1), costs: { prevention: 900 } },
      ],
    });
    renderPage();
    press((await screen.findAllByRole("button", { name: `Delete ${q(2)}` }))[0]);
    await waitFor(() => expect(blob().periods).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: `Edit ${q(1)}` })[0]).toHaveFocus()
    );
    press(screen.getAllByRole("button", { name: `Delete ${q(1)}` })[0]);
    await waitFor(() => expect(blob().periods).toHaveLength(0));
    await waitFor(() => expect(screen.getByLabelText(/^Quarter/)).toHaveFocus());
  });

  it("moves to the form after the history is cleared", async () => {
    seed({ periods: [{ id: "a", period: q(1), costs: { prevention: 1 } }] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Clear history" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear history" })
    );
    await waitFor(() => expect(blob().periods).toEqual([]));
    await waitFor(() => expect(screen.getByLabelText(/^Quarter/)).toHaveFocus());
  });
});

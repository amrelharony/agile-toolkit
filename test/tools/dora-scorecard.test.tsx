import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DoraSample } from "@/lib/stores/workspace-types";

/**
 * DORA scorecard: the "latest quarter" KPI tiles and their Elite/High/
 * Medium/Low bands (boundaries included), the add-sample form and its
 * validation toasts, the samples table and delete, trend chips, the
 * chart text and the CSV export rows.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const toasts = vi.hoisted(() => ({ error: [] as string[] }));
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
    success: () => "t",
    error: (m: string) => {
      toasts.error.push(m);
      return "t";
    },
    info: () => "t",
    warning: () => "t",
  }),
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

import { DoraScorecardClient } from "@/app/(tools)/dora-scorecard/dora-scorecard-client";
import { doraTrendText } from "@/app/(tools)/dora-scorecard/chart-text";

const DS_ID = "doraScorecard:current";

const sample = (
  id: string,
  quarter: string,
  [deployFreqPerWeek, leadTimeHours, changeFailRate, mttrHours]: [number, number, number, number],
  description?: string
): DoraSample => ({
  id,
  quarter,
  deployFreqPerWeek,
  leadTimeHours,
  changeFailRate,
  mttrHours,
  description,
});

const seed = (samples: DoraSample[]) =>
  useWorkspaceStore.setState({ doraScorecards: [{ id: DS_ID, samples }] });
const samples = () =>
  (useWorkspaceStore.getState().doraScorecards ?? []).find((d) => d.id === DS_ID)?.samples ?? [];

/** The text of the compact StatCard whose label is `label`. */
const tile = (label: string) =>
  screen.getAllByText(label)[0].parentElement!.parentElement!.textContent;

const fill = (fields: Partial<Record<string, string>>) => {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
};
const VALID = {
  Quarter: "2026-Q3",
  "Deploys / week": "12",
  "Lead time (hours)": "8",
  "Change-fail rate (%)": "12",
  "MTTR (hours)": "2",
};
const add = () => fireEvent.click(screen.getByRole("button", { name: /Add sample/ }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 12));
  exported.csv = undefined;
  toasts.error.length = 0;
  history.log.mockClear();
  useWorkspaceStore.setState({ doraScorecards: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("doraTrendText", () => {
  it("describes a single quarter in one sentence", () => {
    const text = doraTrendText([
      {
        quarter: "2026-Q1",
        deployFreqPerWeek: 2.345,
        leadTimeHours: 1,
        changeFailRatePct: 12.5,
        mttrHours: 0.5,
      },
    ]);
    expect(text.summary).toBe(
      "2026-Q1: 2.35 deploys a week, 1 hours lead time, a 12.5% change failure rate and 0.5 hours to restore."
    );
    expect(text.table.columns).toEqual([
      "Quarter",
      "Deploys a week",
      "Lead time (h)",
      "Change failure (%)",
      "MTTR (h)",
    ]);
    expect(text.table.rows).toEqual([["2026-Q1", 2.35, 1, 12.5, 0.5]]);
  });

  it("says a metric stayed put when first and last quarters match", () => {
    const row = {
      quarter: "2026-Q1",
      deployFreqPerWeek: 3,
      leadTimeHours: 10,
      changeFailRatePct: 5,
      mttrHours: 1,
    };
    expect(doraTrendText([row, { ...row, quarter: "2026-Q2", mttrHours: 4 }]).summary).toBe(
      "From 2026-Q1 to 2026-Q2, deploys a week stayed at 3, lead time stayed at 10 hours, change failure rate stayed at 5% and time to restore rose from 1 hours to 4 hours."
    );
  });
});

describe("DORA scorecard: empty state", () => {
  it("shows dashed tiles, no samples table and an empty chart summary", () => {
    render(<DoraScorecardClient />);
    for (const label of ["Deploy/wk", "Lead time", "Change-fail rate", "MTTR"]) {
      expect(tile(label)).toBe(`${label}—No data`);
    }
    expect(screen.queryByText("Samples")).not.toBeInTheDocument();
    expect(screen.getByText("No quarters added yet.")).toBeInTheDocument();
  });

  it("pre-fills the quarter field with the current quarter", () => {
    render(<DoraScorecardClient />);
    expect(screen.getByLabelText("Quarter")).toHaveValue("2026-Q4");
  });

  it("uses Q1 for January", () => {
    vi.setSystemTime(new Date(2027, 0, 1, 9));
    render(<DoraScorecardClient />);
    expect(screen.getByLabelText("Quarter")).toHaveValue("2027-Q1");
  });
});

describe("DORA scorecard: KPI tiles and bands", () => {
  it("shows the latest quarter by quarter order, not insertion order", () => {
    seed([
      sample("b", "2026-Q3", [20, 12, 0.05, 0.5]),
      sample("a", "2026-Q1", [0.1, 2000, 0.6, 500]),
    ]);
    render(<DoraScorecardClient />);
    expect(tile("Deploy/wk")).toBe("Deploy/wk20.00Elite");
    expect(tile("Lead time")).toBe("Lead time12.0hElite");
    expect(tile("Change-fail rate")).toBe("Change-fail rate5.0%Elite");
    expect(tile("MTTR")).toBe("MTTR0.5hElite");
  });

  const bandOf = (label: string, values: [number, number, number, number]) => {
    seed([sample("x", "2026-Q1", values)]);
    const { unmount } = render(<DoraScorecardClient />);
    const text = tile(label) ?? "";
    unmount();
    return text.match(/(Elite|High|Medium|Low)$/)?.[1];
  };

  it("bands deploy frequency at 14 / 1 / 0.25 per week", () => {
    expect(bandOf("Deploy/wk", [14, 1, 0, 0])).toBe("Elite");
    expect(bandOf("Deploy/wk", [13.99, 1, 0, 0])).toBe("High");
    expect(bandOf("Deploy/wk", [1, 1, 0, 0])).toBe("High");
    expect(bandOf("Deploy/wk", [0.25, 1, 0, 0])).toBe("Medium");
    expect(bandOf("Deploy/wk", [0.24, 1, 0, 0])).toBe("Low");
    expect(bandOf("Deploy/wk", [0, 1, 0, 0])).toBe("Low");
  });

  it("bands lead time at a day / a week / a month, boundaries inclusive", () => {
    expect(bandOf("Lead time", [1, 24, 0, 0])).toBe("Elite");
    expect(bandOf("Lead time", [1, 24.1, 0, 0])).toBe("High");
    expect(bandOf("Lead time", [1, 168, 0, 0])).toBe("High");
    expect(bandOf("Lead time", [1, 720, 0, 0])).toBe("Medium");
    expect(bandOf("Lead time", [1, 721, 0, 0])).toBe("Low");
  });

  it("bands change-fail rate at 15% / 30% / 45%", () => {
    expect(bandOf("Change-fail rate", [1, 1, 0.15, 0])).toBe("Elite");
    expect(bandOf("Change-fail rate", [1, 1, 0.3, 0])).toBe("High");
    expect(bandOf("Change-fail rate", [1, 1, 0.45, 0])).toBe("Medium");
    expect(bandOf("Change-fail rate", [1, 1, 0.46, 0])).toBe("Low");
  });

  it("bands MTTR at an hour / a day / a week", () => {
    expect(bandOf("MTTR", [1, 1, 0, 1])).toBe("Elite");
    expect(bandOf("MTTR", [1, 1, 0, 1.5])).toBe("High");
    expect(bandOf("MTTR", [1, 1, 0, 24])).toBe("High");
    expect(bandOf("MTTR", [1, 1, 0, 168])).toBe("Medium");
    expect(bandOf("MTTR", [1, 1, 0, 169])).toBe("Low");
  });

  const quarters = (n: number, f: (i: number) => [number, number, number, number]) =>
    Array.from({ length: n }, (_, i) =>
      sample(String(i), `${2025 + Math.floor(i / 4)}-Q${(i % 4) + 1}`, f(i))
    );

  it("shows significant trend chips once 10 quarters move monotonically", () => {
    // Shuffled insertion order: the trend reads the quarter-sorted series.
    seed(quarters(10, (i) => [i + 1, 100 - i * 5, 0.1, 5 + i]).reverse());
    render(<DoraScorecardClient />);
    const chips = within(screen.getByRole("group", { name: "DORA metric trends" }));
    expect(chips.getByText("Deploy/wk ↗ significant")).toBeInTheDocument();
    expect(chips.getByText("Lead time ↘ significant")).toBeInTheDocument();
    expect(chips.getByText("CFR flat")).toBeInTheDocument();
    expect(chips.getByText("MTTR ↗ significant")).toBeInTheDocument();
  });

  it("shows flat chips for 5–9 quarters (too few for significance)", () => {
    seed(quarters(5, (i) => [i + 1, 100 - i * 5, 0.1, 5 + i]));
    render(<DoraScorecardClient />);
    const chips = within(screen.getByRole("group", { name: "DORA metric trends" }));
    expect(chips.getAllByText(/flat$/).map((c) => c.textContent)).toEqual([
      "Deploy/wk flat",
      "Lead time flat",
      "CFR flat",
      "MTTR flat",
    ]);
  });

  it("hides trend chips below 5 quarters", () => {
    seed([sample("1", "2026-Q1", [1, 50, 0.1, 5]), sample("2", "2026-Q2", [2, 40, 0.1, 6])]);
    render(<DoraScorecardClient />);
    expect(screen.queryByRole("group", { name: "DORA metric trends" })).not.toBeInTheDocument();
  });
});

describe("DORA scorecard: samples table", () => {
  beforeEach(() =>
    seed([
      sample("a", "2026-Q1", [2, 48, 0.15, 6], "Baseline"),
      sample("c", "2026-Q3", [5, 20.04, 0.081, 2]),
      sample("b", "2026-Q2", [2.5, 36, 0.15, 4]),
    ])
  );

  it("lists quarters newest first with formatted values", () => {
    render(<DoraScorecardClient />);
    const rows = screen
      .getAllByRole("button", { name: /Remove sample for/ })
      .map((b) => b.closest("tr")!);
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1"]);
    expect(Array.from(rows[0].cells).map((c) => c.textContent)).toEqual([
      "2026-Q3",
      "5.00",
      "20.0",
      "8.1%",
      "2.0",
      "—",
      "",
    ]);
    expect(rows[2].cells[5]).toHaveTextContent("Baseline");
  });

  it("summarises the trend from first to last quarter", () => {
    render(<DoraScorecardClient />);
    expect(
      screen.getByText(
        "From 2026-Q1 to 2026-Q3, deploys a week rose from 2 to 5, lead time fell from 48 hours to 20 hours, change failure rate fell from 15% to 8.1% and time to restore fell from 6 hours to 2 hours."
      )
    ).toBeInTheDocument();
  });

  it("removes exactly the clicked quarter", () => {
    render(<DoraScorecardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample for 2026-Q2" }));
    expect(samples().map((s) => s.id)).toEqual(["a", "c"]);
    expect(history.log).toHaveBeenCalledWith(
      "sample_removed",
      expect.objectContaining({ sampleId: "b", quarter: "2026-Q2" })
    );
  });

  it("exports CSV rows in quarter order with the raw 0..1 change-fail rate", () => {
    render(<DoraScorecardClient />);
    expect(exported.csv?.headers).toEqual([
      "Quarter",
      "Deploy/wk",
      "Lead (h)",
      "Change Fail Rate",
      "MTTR (h)",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["2026-Q1", 2, 48, 0.15, 6, "Baseline"],
      ["2026-Q2", 2.5, 36, 0.15, 4, ""],
      ["2026-Q3", 5, 20.04, 0.081, 2, ""],
    ]);
  });
});

describe("DORA scorecard: add a sample", () => {
  it("stores the sample with the percentage as a 0..1 rate and resets the form", () => {
    render(<DoraScorecardClient />);
    fill(VALID);
    fill({ "Description (optional)": "  Moved to trunk-based  " });
    add();
    expect(toasts.error).toEqual([]);
    expect(samples()).toEqual([
      expect.objectContaining({
        quarter: "2026-Q3",
        deployFreqPerWeek: 12,
        leadTimeHours: 8,
        changeFailRate: 0.12,
        mttrHours: 2,
        description: "Moved to trunk-based",
      }),
    ]);
    expect(screen.getByLabelText("Quarter")).toHaveValue("2026-Q4");
    expect(screen.getByLabelText("Deploys / week")).toHaveValue("");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
    expect(tile("Deploy/wk")).toBe("Deploy/wk12.00High");
  });

  it("trims the quarter and accepts 0 for every metric", () => {
    render(<DoraScorecardClient />);
    fill({
      ...VALID,
      Quarter: " 2026-Q2 ",
      "Deploys / week": "0",
      "Lead time (hours)": "0",
      "Change-fail rate (%)": "0",
      "MTTR (hours)": "0",
    });
    add();
    expect(samples()[0]).toMatchObject({
      quarter: "2026-Q2",
      deployFreqPerWeek: 0,
      changeFailRate: 0,
      description: undefined,
    });
  });

  it("caps a change-fail rate above 100% at 100%", () => {
    render(<DoraScorecardClient />);
    fill({ ...VALID, "Change-fail rate (%)": "150" });
    add();
    expect(samples()[0].changeFailRate).toBe(1);
  });

  it("rejects a blank metric instead of reading it as 0", () => {
    render(<DoraScorecardClient />);
    fill({ ...VALID, "MTTR (hours)": "  " });
    add();
    expect(toasts.error).toEqual(["All metric fields must be valid non-negative numbers."]);
    expect(samples()).toEqual([]);
  });

  it("rejects negative and non-numeric metrics", () => {
    render(<DoraScorecardClient />);
    fill({ ...VALID, "Deploys / week": "-1" });
    add();
    fill({ ...VALID, "Lead time (hours)": "fast" });
    add();
    expect(toasts.error).toHaveLength(2);
    expect(samples()).toEqual([]);
  });

  // Bug: a negative change-fail rate was clamped to 0% (banded Elite) instead
  // of being rejected like every other negative metric.
  it("rejects a negative change-fail rate", () => {
    render(<DoraScorecardClient />);
    fill({ ...VALID, "Change-fail rate (%)": "-5" });
    add();
    expect(toasts.error).toEqual(["All metric fields must be valid non-negative numbers."]);
    expect(samples()).toEqual([]);
  });

  it("requires a quarter in YYYY-Q[1-4] form", () => {
    render(<DoraScorecardClient />);
    fill({ ...VALID, Quarter: "   " });
    add();
    fill({ ...VALID, Quarter: "Q1 2026" });
    add();
    fill({ ...VALID, Quarter: "2026-Q5" });
    add();
    expect(toasts.error).toEqual([
      "Quarter is required.",
      'Quarter must be YYYY-Q[1-4] (e.g. 2026-Q2). Got "Q1 2026".',
      'Quarter must be YYYY-Q[1-4] (e.g. 2026-Q2). Got "2026-Q5".',
    ]);
    expect(samples()).toEqual([]);
  });

  it("refuses a second sample for the same quarter", () => {
    seed([sample("a", "2026-Q3", [1, 1, 0, 1])]);
    render(<DoraScorecardClient />);
    fill(VALID);
    add();
    expect(toasts.error).toEqual([
      "A sample for 2026-Q3 already exists. Remove it first to re-add.",
    ]);
    expect(samples().map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps typed values when a field is invalid", () => {
    render(<DoraScorecardClient />);
    fill({ ...VALID, "Deploys / week": "x" });
    add();
    expect(screen.getByLabelText("Lead time (hours)")).toHaveValue("8");
    expect(screen.getByLabelText("Quarter")).toHaveValue("2026-Q3");
  });
});

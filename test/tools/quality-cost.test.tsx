import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Cost of Quality: KPI tiles (total, conformance, non-conformance, the
 * external/internal ratio), the money fields (rounding, Enter, invalid
 * input, blank), the description field, the distribution chart data and
 * the CSV export rows.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
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
// Every next/dynamic component (the chart and ChartCard's ResponsiveContainer)
// becomes a placeholder that exposes its props.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic({ children, ...props }: { children?: ReactNode }) {
      return (
        <div data-testid="dynamic" data-props={JSON.stringify(props)}>
          {children}
        </div>
      );
    },
}));

import { QualityCostClient } from "@/app/(tools)/quality-cost/quality-cost-client";

const KEY = "agile-toolkit:quality-cost";

interface Costs {
  preventionCost: number;
  detectionCost: number;
  internalFailureCost: number;
  externalFailureCost: number;
  description?: string;
}

const seed = (c: Costs) => localStorage.setItem(KEY, JSON.stringify(c));
const saved = (): Costs => JSON.parse(localStorage.getItem(KEY) ?? "null");

/** The text of the compact StatCard whose label is `label`. */
const tile = (label: string) =>
  screen.getAllByText(label)[0].parentElement!.parentElement!.textContent;

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const field = (label: string) => screen.getByLabelText(label);
const enter = (label: string, value: string) => {
  fireEvent.change(field(label), { target: { value } });
  fireEvent.blur(field(label));
};

const pieData = () => {
  for (const el of screen.queryAllByTestId("dynamic")) {
    const props = JSON.parse(el.getAttribute("data-props") ?? "{}") as {
      data?: { name: string; value: number; color: string }[];
    };
    if (props.data) return props.data.map(({ name, value }) => ({ name, value }));
  }
  return [];
};

beforeEach(() => {
  localStorage.clear();
  exported.csv = undefined;
  history.log.mockClear();
});

describe("Cost of quality: empty state", () => {
  it("shows zeros, a dash for the ratio and no chart", () => {
    render(<QualityCostClient />);
    expect(tile("Total cost")).toBe("Total cost$0");
    expect(tile("Conformance")).toBe("Conformance$00% of total");
    expect(tile("Non-conformance")).toBe("Non-conformance$00% of total");
    expect(tile("External / Internal")).toBe("External / Internal—ext failures escaping QA");
    expect(screen.queryByText("Cost distribution")).not.toBeInTheDocument();
    expect(field("Prevention")).toHaveValue("0");
  });

  it("exports 0.0 % shares rather than NaN when everything is zero", () => {
    render(<QualityCostClient />);
    expect(exported.csv?.rows.map((r) => r[2])).toEqual([
      "0.0",
      "0.0",
      "0.0",
      "0.0",
      "100.0",
      "0.0",
      "0.0",
    ]);
  });
});

describe("Cost of quality: derived values", () => {
  beforeEach(() =>
    seed({
      preventionCost: 3000,
      detectionCost: 2000,
      internalFailureCost: 1000,
      externalFailureCost: 4000,
    })
  );

  it("splits the total into conformance and non-conformance", () => {
    render(<QualityCostClient />);
    expect(tile("Total cost")).toBe(`Total cost$${money(10000)}`);
    expect(tile("Conformance")).toBe(`Conformance$${money(5000)}50% of total`);
    expect(tile("Non-conformance")).toBe(`Non-conformance$${money(5000)}50% of total`);
    expect(tile("External / Internal")).toBe("External / Internal4.00ext failures escaping QA");
  });

  it("charts only the non-zero categories", () => {
    seed({
      preventionCost: 3000,
      detectionCost: 0,
      internalFailureCost: 1000,
      externalFailureCost: 4000,
    });
    render(<QualityCostClient />);
    expect(screen.getByText("Cost distribution")).toBeInTheDocument();
    expect(pieData()).toEqual([
      { name: "Prevention", value: 3000 },
      { name: "Internal failure", value: 1000 },
      { name: "External failure", value: 4000 },
    ]);
  });

  it("exports each category with its share of the total", () => {
    render(<QualityCostClient />);
    expect(exported.csv?.headers).toEqual(["Category", "Cost ($)", "% of Total"]);
    expect(exported.csv?.rows).toEqual([
      ["Prevention", 3000, "30.0"],
      ["Detection", 2000, "20.0"],
      ["Internal failure", 1000, "10.0"],
      ["External failure", 4000, "40.0"],
      ["Total", 10000, "100.0"],
      ["Conformance", 5000, "50.0"],
      ["Non-conformance", 5000, "50.0"],
    ]);
  });

  it("notes when external failures exist but no internal ones were recorded", () => {
    seed({
      preventionCost: 0,
      detectionCost: 0,
      internalFailureCost: 0,
      externalFailureCost: 500,
    });
    render(<QualityCostClient />);
    expect(tile("External / Internal")).toBe("External / Internal—no internal recorded");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("Cost of quality: money fields", () => {
  it("commits a typed cost on blur, rounded to cents", () => {
    render(<QualityCostClient />);
    enter("Prevention", "1234.567");
    expect(field("Prevention")).toHaveValue("1234.57");
    expect(saved().preventionCost).toBe(1234.57);
    expect(tile("Total cost")).toBe(`Total cost$${money(1234.57)}`);
    expect(history.log).toHaveBeenCalledWith("cost_updated", { fields: ["preventionCost"] });
  });

  it("commits on Enter", () => {
    render(<QualityCostClient />);
    fireEvent.change(field("External failure"), { target: { value: "250" } });
    fireEvent.keyDown(field("External failure"), { key: "Enter" });
    expect(saved().externalFailureCost).toBe(250);
  });

  it("does not commit while typing", () => {
    render(<QualityCostClient />);
    fireEvent.change(field("Detection (appraisal)"), { target: { value: "90" } });
    expect(tile("Total cost")).toBe("Total cost$0");
  });

  it("reverts a negative or non-numeric entry to the last value", () => {
    seed({
      preventionCost: 100,
      detectionCost: 0,
      internalFailureCost: 0,
      externalFailureCost: 0,
    });
    render(<QualityCostClient />);
    enter("Prevention", "-5");
    expect(field("Prevention")).toHaveValue("100");
    enter("Prevention", "1,000");
    expect(field("Prevention")).toHaveValue("100");
    expect(saved().preventionCost).toBe(100);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("treats a cleared field as $0", () => {
    seed({
      preventionCost: 100,
      detectionCost: 0,
      internalFailureCost: 0,
      externalFailureCost: 0,
    });
    render(<QualityCostClient />);
    enter("Prevention", "");
    expect(field("Prevention")).toHaveValue("0");
    expect(saved().preventionCost).toBe(0);
  });

  it("logs nothing when a field is blurred unchanged", () => {
    render(<QualityCostClient />);
    fireEvent.blur(field("Internal failure"));
    enter("Internal failure", "0.001");
    expect(history.log).not.toHaveBeenCalled();
  });
});

describe("Cost of quality: description", () => {
  it("keeps spaces while typing and trims on blur", () => {
    render(<QualityCostClient />);
    const desc = field("Description (optional)");
    fireEvent.change(desc, { target: { value: "Q3 costs " } });
    expect(desc).toHaveValue("Q3 costs ");
    fireEvent.blur(desc);
    expect(saved().description).toBe("Q3 costs");
  });

  it("stores a blank description as undefined", () => {
    seed({
      preventionCost: 0,
      detectionCost: 0,
      internalFailureCost: 0,
      externalFailureCost: 0,
      description: "Old",
    });
    render(<QualityCostClient />);
    const desc = field("Description (optional)");
    fireEvent.change(desc, { target: { value: "   " } });
    fireEvent.blur(desc);
    expect(saved().description).toBeUndefined();
    expect(desc).toHaveValue("");
  });
});

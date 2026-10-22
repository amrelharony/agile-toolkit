import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Vulnerability } from "@/lib/stores/workspace-types";
import { VULN_ACTIONS } from "@/lib/history/event-actions";

/**
 * Vulnerability Burn-Down: KPIs (open, SLA breaches, avg time-to-resolve,
 * critical+high, accepted-past-2×SLA), the SLA field (per-severity default,
 * sticky overrides, blur validation), adding, the breach-first row order,
 * status changes that preserve resolvedAt, the burn-down chart series, the
 * trend chip, remove, and the CSV export. "Today" is 18 Oct 2026.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
interface ChartRow {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const areas = vi.hoisted(() => ({
  list: [] as { dataKey: string; stackId: string; fill: string; name: string }[],
}));

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
// becomes a placeholder that exposes its props, so chart data can be read.
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

// The chart module is rendered directly in its own test below; record what
// it hands to recharts instead of drawing SVG.
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AreaChart: Box,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Area: (p: { dataKey: string; stackId: string; fill: string; name: string }) => {
      areas.list.push({ dataKey: p.dataKey, stackId: p.stackId, fill: p.fill, name: p.name });
      return null;
    },
  };
});
vi.mock("@/components/charts/causal-annotation", () => ({
  CausalLine: ({ annotation }: { annotation: { x: string } }) => (
    <span data-testid="causal">{annotation.x}</span>
  ),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { VulnBurndownClient } from "@/app/(tools)/vuln-burndown/vuln-burndown-client";
import { OpenVulnsChart } from "@/app/(tools)/vuln-burndown/charts";

const VB_ID = "vulnBurndown:current";
const TODAY = "2026-10-18";

const vuln = (id: string, over: Partial<Vulnerability> = {}): Vulnerability => ({
  id,
  cve: `CVE-${id}`,
  severity: "high",
  status: "open",
  openedAt: TODAY,
  slaTargetDays: 30,
  ...over,
});

const seed = (vulns: Vulnerability[]) =>
  useWorkspaceStore.setState({ vulnBurndowns: [{ id: VB_ID, vulns }] });

const vulns = () =>
  (useWorkspaceStore.getState().vulnBurndowns ?? []).find((d) => d.id === VB_ID)?.vulns ?? [];

function kpi(label: string): string | null | undefined {
  const el = screen
    .queryAllByText(label)
    .find((e) => e.parentElement?.className.includes("uppercase"));
  return el?.parentElement?.nextElementSibling?.textContent;
}

function chartProps(): { data: ChartRow[]; annotations: { x: string }[] } | undefined {
  const el = screen
    .queryAllByTestId("dynamic")
    .find((e) => "data" in JSON.parse(e.getAttribute("data-props") ?? "{}"));
  return el ? JSON.parse(el.getAttribute("data-props")!) : undefined;
}

function chooseOption(combobox: HTMLElement, option: string) {
  fireEvent.pointerDown(combobox, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

const sla = () => screen.getByLabelText("SLA target (days)") as HTMLInputElement;
const severitySelect = () => screen.getByRole("combobox", { name: "Severity" });
const addButton = () => screen.getByRole("button", { name: /Add vuln/ });

const rowOrder = () =>
  screen
    .getAllByRole("combobox")
    .map((c) => c.getAttribute("aria-label"))
    .filter((l): l is string => !!l?.startsWith("Status for "))
    .map((l) => l.replace("Status for ", ""));

const mixed = () => [
  vuln("1", { severity: "critical", openedAt: "2026-10-01", slaTargetDays: 7 }),
  vuln("2", { severity: "high", status: "in_progress", openedAt: "2026-10-10" }),
  vuln("3", {
    severity: "medium",
    status: "resolved",
    openedAt: "2026-09-01",
    resolvedAt: "2026-09-11",
    slaTargetDays: 60,
  }),
  vuln("4", {
    severity: "low",
    status: "resolved",
    openedAt: "2026-09-01",
    resolvedAt: "2026-09-06",
    slaTargetDays: 90,
  }),
  vuln("5", { severity: "low", status: "accepted", openedAt: "2026-08-01" }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0));
  exported.csv = undefined;
  history.log.mockClear();
  areas.list = [];
  useWorkspaceStore.setState({ vulnBurndowns: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Vuln burn-down: empty state", () => {
  it("shows zeroed KPIs, a dash for time-to-resolve, no chart", () => {
    render(<VulnBurndownClient />);
    expect(kpi("Open")).toBe("0");
    expect(kpi("SLA breaches")).toBe("0");
    expect(kpi("Avg time-to-resolve")).toBe("—");
    expect(kpi("Critical + high open")).toBe("0");
    expect(kpi("Accepted, past 2× SLA")).toBeUndefined();
    expect(chartProps()).toBeUndefined();
    expect(screen.getByText(/No vulnerabilities tracked/)).toBeInTheDocument();
  });
});

describe("Vuln burn-down: KPIs, rows and chart", () => {
  it("derives every KPI from the seeded vulns", () => {
    seed(mixed());
    render(<VulnBurndownClient />);
    expect(kpi("Open")).toBe("2"); // open + in_progress
    expect(kpi("SLA breaches")).toBe("1"); // #1: 17 days on a 7-day SLA
    expect(kpi("Avg time-to-resolve")).toBe("7.5d"); // (10 + 5) / 2
    expect(kpi("Critical + high open")).toBe("2");
    expect(kpi("Accepted, past 2× SLA")).toBe("1"); // #5: 78 days > 2 × 30
  });

  it("shows age against SLA, frozen at the resolution date once resolved", () => {
    seed(mixed());
    render(<VulnBurndownClient />);
    const ageOf = (cve: string) =>
      within(screen.getByText(cve).parentElement!).getByTitle(/^Age /).textContent;
    expect(ageOf("CVE-1")).toBe("17d / 7d (past SLA)");
    expect(ageOf("CVE-2")).toBe("8d / 30d");
    expect(ageOf("CVE-3")).toBe("10d / 60d");
    expect(ageOf("CVE-5")).toBe("78d / 30d"); // accepted: aging but never "past SLA"
  });

  it("orders breaching vulns first, then by severity", () => {
    seed([
      vuln("MED", { severity: "medium", openedAt: "2026-10-17", slaTargetDays: 60 }),
      vuln("HIGH", {
        severity: "high",
        status: "resolved",
        openedAt: "2026-10-01",
        resolvedAt: "2026-10-02",
      }),
      vuln("CRIT", { severity: "critical", slaTargetDays: 7 }),
      vuln("LOW", { severity: "low", openedAt: "2026-01-01", slaTargetDays: 90 }),
    ]);
    render(<VulnBurndownClient />);
    expect(rowOrder()).toEqual(["CVE-LOW", "CVE-CRIT", "CVE-HIGH", "CVE-MED"]);
    expect(vulns().map((v) => v.id)).toEqual(["MED", "HIGH", "CRIT", "LOW"]);
  });

  it("charts open vulns per severity on every event date, accepted ones excluded", () => {
    seed(mixed());
    render(<VulnBurndownClient />);
    const data = chartProps()!.data;
    expect(data.map((d) => d.date)).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-09-06",
      "2026-09-11",
      "2026-10-01",
      "2026-10-10",
      TODAY,
    ]);
    expect(data.map((d) => d.total)).toEqual([0, 2, 1, 0, 1, 2, 2]);
    expect(data[1]).toMatchObject({ medium: 1, low: 1 });
    expect(data[6]).toMatchObject({ critical: 1, high: 1, medium: 0, low: 0 });
  });

  it("shows an upward trend chip once ten points climb, with on-axis markers", () => {
    seed(
      Array.from({ length: 10 }, (_, i) =>
        vuln(String(i), { openedAt: `2026-10-${String(i + 1).padStart(2, "0")}` })
      )
    );
    render(<VulnBurndownClient />);
    const props = chartProps()!;
    expect(props.data.map((d) => d.total)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
    expect(screen.getByText("↗ trend")).toBeInTheDocument();
    expect(
      screen.getByText(/^Open-vuln trend up \(Mann-Kendall p=0\.\d{3}\)$/)
    ).toBeInTheDocument();
    const dates = new Set(props.data.map((d) => d.date));
    for (const a of props.annotations) expect(dates.has(a.x)).toBe(true);
  });

  it("shows 0 days rather than NaN for an unparseable openedAt", () => {
    seed([vuln("X", { openedAt: "not a date", slaTargetDays: 7 })]);
    render(<VulnBurndownClient />);
    expect(screen.getByTitle(/^Age /)).toHaveTextContent("0d / 7d");
    expect(kpi("SLA breaches")).toBe("0");
  });

  it("shows owner and description on the row", () => {
    seed([vuln("1", { owner: "platform", description: "RCE in parser\nneeds patch" })]);
    render(<VulnBurndownClient />);
    expect(screen.getByText("@platform")).toBeInTheDocument();
    expect(screen.getByText(/RCE in parser/)).toHaveTextContent("RCE in parser needs patch", {
      normalizeWhitespace: true,
    });
  });
});

describe("Vuln burn-down: SLA field", () => {
  it("snaps to each severity's default SLA", () => {
    render(<VulnBurndownClient />);
    expect(sla().value).toBe("30");
    chooseOption(severitySelect(), "Critical");
    expect(sla().value).toBe("7");
    chooseOption(severitySelect(), "Medium");
    expect(sla().value).toBe("60");
    chooseOption(severitySelect(), "Low");
    expect(sla().value).toBe("90");
  });

  it("keeps a custom SLA for its severity across severity switches", () => {
    render(<VulnBurndownClient />);
    chooseOption(severitySelect(), "Low");
    fireEvent.change(sla(), { target: { value: "45" } });
    chooseOption(severitySelect(), "Medium");
    expect(sla().value).toBe("60");
    // Bug: only a per-severity flag was kept, so Low came back showing Medium's 60.
    chooseOption(severitySelect(), "Low");
    expect(sla().value).toBe("45");
    chooseOption(severitySelect(), "High");
    expect(sla().value).toBe("30");
    fireEvent.click(addButton());
    chooseOption(severitySelect(), "Low");
    fireEvent.click(addButton());
    expect(vulns().map((v) => [v.severity, v.slaTargetDays])).toEqual([
      ["low", 45],
      ["high", 30],
    ]);
  });

  it("forgets a custom SLA once it is reset by an invalid entry", () => {
    render(<VulnBurndownClient />);
    chooseOption(severitySelect(), "Low");
    fireEvent.change(sla(), { target: { value: "45" } });
    fireEvent.change(sla(), { target: { value: "" } });
    fireEvent.blur(sla());
    expect(sla().value).toBe("90");
    chooseOption(severitySelect(), "Medium");
    chooseOption(severitySelect(), "Low");
    expect(sla().value).toBe("90");
  });

  it("rounds on blur and resets an invalid value to the default", () => {
    render(<VulnBurndownClient />);
    fireEvent.change(sla(), { target: { value: "12.6" } });
    fireEvent.blur(sla());
    expect(sla().value).toBe("13");
    for (const bad of ["abc", "0", "-4", ""]) {
      fireEvent.change(sla(), { target: { value: bad } });
      fireEvent.blur(sla());
      expect(sla().value).toBe("30");
    }
  });

  it("validates the critical SLA field the same way", () => {
    render(<VulnBurndownClient />);
    chooseOption(severitySelect(), "Critical");
    fireEvent.change(sla(), { target: { value: "zero" } });
    fireEvent.blur(sla());
    expect(sla().value).toBe("7");
    fireEvent.change(sla(), { target: { value: "3" } });
    fireEvent.blur(sla());
    fireEvent.click(addButton());
    expect(vulns()[0]).toMatchObject({ severity: "critical", slaTargetDays: 3 });
  });
});

describe("Vuln burn-down: adding", () => {
  it("adds an open vuln with today's date and the default SLA", () => {
    render(<VulnBurndownClient />);
    fireEvent.click(addButton());
    const [v] = vulns();
    expect(v).toMatchObject({
      severity: "high",
      status: "open",
      openedAt: TODAY,
      slaTargetDays: 30,
    });
    expect(v.cve).toBeUndefined();
    expect(v.owner).toBeUndefined();
    expect(v.description).toBeUndefined();
    expect(kpi("Open")).toBe("1");
    expect(kpi("Critical + high open")).toBe("1");
  });

  it("trims the text fields, logs, prepends, and clears the text fields", () => {
    seed([vuln("old")]);
    render(<VulnBurndownClient />);
    fireEvent.change(screen.getByLabelText("CVE (optional)"), {
      target: { value: "  CVE-2026-0001 " },
    });
    fireEvent.change(screen.getByLabelText("Owner (optional)"), { target: { value: " ana " } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: " Heap overflow " },
    });
    fireEvent.change(sla(), { target: { value: "14.4" } });
    fireEvent.click(addButton());

    const [added, old] = vulns();
    expect(old.id).toBe("old");
    expect(added).toMatchObject({
      cve: "CVE-2026-0001",
      owner: "ana",
      description: "Heap overflow",
      slaTargetDays: 14,
    });
    expect(history.log).toHaveBeenCalledWith(VULN_ACTIONS.VULN_ADDED, {
      vulnId: added.id,
      cve: "CVE-2026-0001",
      severity: "high",
      slaTargetDays: 14,
      owner: "ana",
      description: "Heap overflow",
    });
    expect(screen.getByLabelText("CVE (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Owner (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
  });

  it("does not add while the SLA is below one day", () => {
    render(<VulnBurndownClient />);
    fireEvent.change(sla(), { target: { value: "0" } });
    fireEvent.click(addButton());
    expect(useWorkspaceStore.getState().vulnBurndowns).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });
});

describe("Vuln burn-down: status changes and removal", () => {
  it("stamps resolvedAt, then keeps it but treats the vuln as open again on re-open", () => {
    seed([vuln("9", { openedAt: "2026-10-01", slaTargetDays: 7 })]);
    render(<VulnBurndownClient />);
    const status = () => screen.getByRole("combobox", { name: "Status for CVE-9" });

    chooseOption(status(), "Resolved");
    expect(vulns()[0]).toMatchObject({ status: "resolved", resolvedAt: TODAY });
    expect(history.log).toHaveBeenCalledWith(VULN_ACTIONS.VULN_RESOLVED, {
      vulnId: "9",
      cve: "CVE-9",
      ageDays: 17,
    });
    expect(kpi("Open")).toBe("0");
    expect(kpi("Avg time-to-resolve")).toBe("17.0d");

    vi.setSystemTime(new Date(2026, 9, 20, 12, 0));
    chooseOption(status(), "Open");
    expect(vulns()[0]).toMatchObject({ status: "open", resolvedAt: TODAY });
    expect(history.log).toHaveBeenLastCalledWith(VULN_ACTIONS.VULN_UPDATED, {
      vulnId: "9",
      fields: ["status"],
    });
    // Re-opened: ages from openedAt to today, breaches, and is back on the chart.
    expect(screen.getByTitle(/^Age /)).toHaveTextContent("19d / 7d");
    expect(kpi("Open")).toBe("1");
    expect(kpi("SLA breaches")).toBe("1");
    expect(kpi("Avg time-to-resolve")).toBe("—");
    const data = chartProps()!.data;
    expect(data[data.length - 1]).toMatchObject({ date: "2026-10-20", total: 1 });

    chooseOption(status(), "Resolved");
    expect(vulns()[0].resolvedAt).toBe(TODAY);
    expect(history.log).toHaveBeenLastCalledWith(VULN_ACTIONS.VULN_RESOLVED, {
      vulnId: "9",
      cve: "CVE-9",
      ageDays: 17,
    });
  });

  it("removes only the chosen vuln and logs it", () => {
    seed(mixed());
    render(<VulnBurndownClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove vuln CVE-2" }));
    expect(vulns().map((v) => v.id)).toEqual(["1", "3", "4", "5"]);
    expect(history.log).toHaveBeenCalledWith(VULN_ACTIONS.VULN_REMOVED, {
      vulnId: "2",
      cve: "CVE-2",
    });
    expect(kpi("Open")).toBe("1");
  });
});

describe("Vuln burn-down: export", () => {
  it("exports age, SLA and a breach flag per vuln", () => {
    seed(mixed());
    render(<VulnBurndownClient />);
    expect(exported.csv?.headers).toEqual([
      "CVE",
      "Severity",
      "Status",
      "Opened",
      "Resolved",
      "Age (d)",
      "SLA Target (d)",
      "SLA Breached",
      "Owner",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["CVE-1", "critical", "open", "2026-10-01", "", 17, 7, "YES", "", ""],
      ["CVE-2", "high", "in_progress", "2026-10-10", "", 8, 30, "no", "", ""],
      ["CVE-3", "medium", "resolved", "2026-09-01", "2026-09-11", 10, 60, "no", "", ""],
      ["CVE-4", "low", "resolved", "2026-09-01", "2026-09-06", 5, 90, "no", "", ""],
      ["CVE-5", "low", "accepted", "2026-08-01", "", 78, 30, "no", "", ""],
    ]);
  });
});

describe("Vuln burn-down: chart component", () => {
  it("stacks one area per severity in its colour, with a marker per changepoint", () => {
    render(
      <OpenVulnsChart
        data={[]}
        colors={{ critical: "#c", high: "#h", medium: "#m", low: "#l" }}
        annotations={[
          { x: "2026-10-03", label: "up", detail: "d", confidence: "strong" },
          { x: "2026-10-07", label: "down", detail: "d", confidence: "moderate" },
        ]}
      />
    );
    expect(areas.list).toEqual([
      { dataKey: "critical", stackId: "1", fill: "#c", name: "Critical" },
      { dataKey: "high", stackId: "1", fill: "#h", name: "High" },
      { dataKey: "medium", stackId: "1", fill: "#m", name: "Medium" },
      { dataKey: "low", stackId: "1", fill: "#l", name: "Low" },
    ]);
    expect(screen.getAllByTestId("causal").map((e) => e.textContent)).toEqual([
      "2026-10-03",
      "2026-10-07",
    ]);
  });
});

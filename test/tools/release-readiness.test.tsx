import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { GateId, Release } from "@/lib/stores/workspace-types";

/**
 * Release readiness: the on-time metric helper, KPI tiles, adding a
 * release, ticking gates, shipping (with and without the open-gates
 * confirmation), rolling back, reopening, removing, the chart data and
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
// The charts become placeholders that expose their props.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic(props: object) {
      return <div data-testid="dynamic" data-props={JSON.stringify(props)} />;
    },
}));

import { ReleaseReadinessClient } from "@/app/(tools)/release-readiness/release-readiness-client";
import { onTimeRate } from "@/app/(tools)/release-readiness/metrics";

const RR_ID = "releaseReadiness:current";
const GATE_IDS: GateId[] = [
  "a11y_audit",
  "perf_baseline",
  "monitoring_dashboards",
  "alerts_tuned",
  "rollback_tested",
  "runbook_linked",
  "sre_review",
  "security_review",
  "feature_flag_ready",
];
const gates = (passed: number): Record<GateId, boolean> =>
  Object.fromEntries(GATE_IDS.map((g, i) => [g, i < passed])) as Record<GateId, boolean>;

const release = (id: string, over: Partial<Release> = {}): Release => ({
  id,
  name: id,
  plannedDate: "2026-10-20",
  status: "planning",
  gates: gates(0),
  ...over,
});

const seed = (list: Release[]) =>
  useWorkspaceStore.setState({ releaseReadinesses: [{ id: RR_ID, releases: list }] });
const releases = () =>
  (useWorkspaceStore.getState().releaseReadinesses ?? []).find((d) => d.id === RR_ID)?.releases ??
  [];
const byId = (id: string) => releases().find((r) => r.id === id)!;

/** The text of the compact StatCard whose label is `label`. */
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

/** A release's card, found from its Remove button. */
const card = (name: string) =>
  screen.getByRole("button", { name: `Remove ${name}` }).closest(".rounded-xl") as HTMLElement;

const chartData = <T,>(key: string): T[] => {
  for (const el of screen.queryAllByTestId("dynamic")) {
    const props = JSON.parse(el.getAttribute("data-props") ?? "{}") as { data?: T[] };
    if (props.data?.[0] && key in (props.data[0] as object)) return props.data;
  }
  return [];
};

const TODAY = "2026-10-23";
let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 12));
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ releaseReadinesses: [] });
});
afterEach(() => {
  confirmSpy.mockRestore();
  vi.useRealTimers();
});

describe("onTimeRate", () => {
  it("counts a ship on or before the planned date as on time", () => {
    const r = onTimeRate([
      release("early", { status: "shipped", shippedDate: "2026-10-19" }),
      release("same-day", { status: "shipped", shippedDate: "2026-10-20" }),
      release("late", { status: "shipped", shippedDate: "2026-10-21" }),
      release("not-yet"),
    ]);
    expect(r).toEqual({ pct: (2 / 3) * 100, shipped: 3, onTime: 2, rolledBack: 0 });
  });

  it("ignores a rollback that never shipped", () => {
    const r = onTimeRate([
      release("went-out", { status: "rolled_back", shippedDate: "2026-10-25" }),
      release("never-out", { status: "rolled_back" }),
    ]);
    expect(r).toEqual({ pct: 0, shipped: 1, onTime: 0, rolledBack: 1 });
  });

  it("is null with nothing shipped", () => {
    expect(onTimeRate([])).toEqual({ pct: null, shipped: 0, onTime: 0, rolledBack: 0 });
  });
});

describe("Release readiness: empty state", () => {
  it("shows dashes and the empty message", () => {
    render(<ReleaseReadinessClient />);
    expect(tile("Shipped")).toBe("Shipped00 total");
    expect(tile("% on time")).toBe("% on time—no ships yet");
    expect(tile("Avg gates open at ship")).toBe("Avg gates open at ship—");
    expect(screen.getByText(/No releases yet/)).toBeInTheDocument();
    expect(screen.queryByText("Per-release gate-pass rate")).not.toBeInTheDocument();
    expect(screen.queryByText(/Most-skipped gates/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Planned date")).toHaveValue(TODAY);
  });
});

describe("Release readiness: KPIs and charts", () => {
  it("derives shipped count, on-time rate and average open gates", () => {
    seed([
      release("a", { status: "shipped", shippedDate: "2026-10-01", gatesOpenAtShip: 0 }),
      release("b", { status: "shipped", shippedDate: "2026-10-25", gatesOpenAtShip: 3 }),
      // No snapshot: falls back to the live open-gate count (9 − 7 = 2).
      release("c", { status: "shipped", shippedDate: "2026-10-02", gates: gates(7) }),
      release("d", { status: "rolled_back", shippedDate: "2026-10-30" }),
      release("e"),
    ]);
    render(<ReleaseReadinessClient />);
    expect(tile("Shipped")).toBe("Shipped35 total");
    expect(tile("% on time")).toBe("% on time50%of 4 shipped, incl. 1 rolled back");
    // (0 + 3 + 2) / 3 shipped (rolled back excluded).
    expect(tile("Avg gates open at ship")).toBe("Avg gates open at ship1.7");
  });

  it("counts skipped gates across shipped releases", () => {
    seed([
      release("a", { status: "shipped", shippedDate: "2026-10-01", gates: gates(8) }),
      release("b", { status: "shipped", shippedDate: "2026-10-02", gates: gates(1) }),
      release("c", { gates: gates(0) }),
    ]);
    render(<ReleaseReadinessClient />);
    const data = chartData<{ gate: string; skipped: number }>("skipped");
    expect(data[0]).toEqual({ gate: "A11y audit", skipped: 0 });
    expect(data[1]).toEqual({ gate: "Perf baseline", skipped: 1 });
    expect(data[8]).toEqual({ gate: "Feature flag ready", skipped: 2 });
  });

  it("plots the gate-pass rate of shipped releases in ship order once 4 have shipped", () => {
    seed([
      release("r3", { status: "shipped", shippedDate: "2026-10-03", gatesOpenAtShip: 0 }),
      release("r1", { status: "shipped", shippedDate: "2026-10-01", gatesOpenAtShip: 9 }),
      release("r4", { status: "shipped", shippedDate: "2026-10-04", gatesOpenAtShip: 3 }),
      release("r2", { status: "shipped", shippedDate: "2026-10-02", gatesOpenAtShip: 6 }),
      release("rb", { status: "rolled_back", shippedDate: "2026-10-05" }),
    ]);
    render(<ReleaseReadinessClient />);
    expect(screen.getByText("Per-release gate-pass rate")).toBeInTheDocument();
    const series = chartData<{ release: string; passed: number; passRatePct: number }>(
      "passRatePct"
    );
    expect(series.map((s) => [s.release, s.passed])).toEqual([
      ["r1", 0],
      ["r2", 3],
      ["r3", 9],
      ["r4", 6],
    ]);
    expect(series[3].passRatePct).toBeCloseTo(66.67, 1);
  });

  it("hides the gate-pass chart below 4 shipped releases", () => {
    seed([release("a", { status: "shipped", shippedDate: "2026-10-01" })]);
    render(<ReleaseReadinessClient />);
    expect(screen.queryByText("Per-release gate-pass rate")).not.toBeInTheDocument();
    expect(screen.getByText(/Most-skipped gates/)).toBeInTheDocument();
  });

  it("exports one CSV row per release with each gate as yes/no", () => {
    seed([release("v1", { gates: gates(2), description: "Checkout" })]);
    render(<ReleaseReadinessClient />);
    expect(exported.csv?.headers.slice(0, 6)).toEqual([
      "Release",
      "Status",
      "Planned",
      "Shipped",
      "Gates passed",
      "A11y audit",
    ]);
    expect(exported.csv?.headers).toHaveLength(15);
    expect(exported.csv?.rows).toEqual([
      [
        "v1",
        "planning",
        "2026-10-20",
        "",
        "2 / 9",
        "yes",
        "yes",
        "no",
        "no",
        "no",
        "no",
        "no",
        "no",
        "no",
        "Checkout",
      ],
    ]);
  });
});

describe("Release readiness: add", () => {
  it("adds a trimmed planning release at the top with every gate open", () => {
    seed([release("older")]);
    render(<ReleaseReadinessClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  v3.4.0  " } });
    fireEvent.change(screen.getByLabelText("Planned date"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  Checkout redesign " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add release/ }));
    const [added, older] = releases();
    expect(added).toMatchObject({
      name: "v3.4.0",
      plannedDate: "2026-11-02",
      status: "planning",
      gates: gates(0),
      description: "Checkout redesign",
    });
    expect(older.id).toBe("older");
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Planned date")).toHaveValue(TODAY);
    expect(within(card("v3.4.0")).getByText("9 gates remaining")).toBeInTheDocument();
  });

  it("adds on Enter in the name field and defaults a cleared date to today", () => {
    render(<ReleaseReadinessClient />);
    fireEvent.change(screen.getByLabelText("Planned date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "hotfix" } });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
    expect(releases()[0]).toMatchObject({ name: "hotfix", plannedDate: TODAY });
    expect(releases()[0].description).toBeUndefined();
  });

  it("ignores a blank name", () => {
    render(<ReleaseReadinessClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Add release/ }));
    expect(releases()).toEqual([]);
  });
});

describe("Release readiness: gates and lifecycle", () => {
  it("ticks a gate and updates the count, progress and remaining text", () => {
    seed([release("v1", { gates: gates(7) })]);
    render(<ReleaseReadinessClient />);
    const c = within(card("v1"));
    expect(c.getByText("7 / 9")).toBeInTheDocument();
    fireEvent.click(c.getByRole("checkbox", { name: "Security review" }));
    expect(byId("v1").gates.security_review).toBe(true);
    expect(c.getByText("8 / 9")).toBeInTheDocument();
    expect(c.getByText("1 gate remaining")).toBeInTheDocument();
    expect(c.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "89");
    fireEvent.click(c.getByRole("checkbox", { name: "Feature flag ready" }));
    expect(c.queryByText(/remaining/)).not.toBeInTheDocument();
    fireEvent.click(c.getByRole("checkbox", { name: "A11y audit" }));
    expect(byId("v1").gates.a11y_audit).toBe(false);
  });

  it("ships a fully-gated release without asking", () => {
    seed([release("v1", { gates: gates(9) })]);
    render(<ReleaseReadinessClient />);
    fireEvent.click(within(card("v1")).getByRole("button", { name: /Ship/ }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(byId("v1")).toMatchObject({ status: "shipped", shippedDate: TODAY, gatesOpenAtShip: 0 });
  });

  it("asks before shipping with open gates and snapshots the open count", () => {
    seed([release("v1", { gates: gates(6) })]);
    render(<ReleaseReadinessClient />);
    fireEvent.click(within(card("v1")).getByRole("button", { name: /Ship/ }));
    expect(confirmSpy).toHaveBeenCalledWith("3 of 9 readiness gates are still open. Ship anyway?");
    expect(byId("v1")).toMatchObject({ status: "shipped", gatesOpenAtShip: 3 });
    // Shipped: gates and Ship lock.
    const c = within(card("v1"));
    expect(c.getByRole("button", { name: /Ship/ })).toBeDisabled();
    expect(c.getByRole("checkbox", { name: "A11y audit" })).toBeDisabled();
    expect(c.getByText(/Shipped:/)).toHaveTextContent(`Shipped: ${TODAY}`);
  });

  it("does nothing when the open-gates confirmation is declined", () => {
    confirmSpy.mockReturnValue(false);
    seed([release("v1")]);
    render(<ReleaseReadinessClient />);
    fireEvent.click(within(card("v1")).getByRole("button", { name: /Ship/ }));
    expect(byId("v1").status).toBe("planning");
    expect(history.log).not.toHaveBeenCalled();
  });

  it("rolls back keeping the ship date, then reopens clearing it", () => {
    seed([release("v1", { status: "shipped", shippedDate: "2026-10-19", gatesOpenAtShip: 1 })]);
    render(<ReleaseReadinessClient />);
    fireEvent.click(within(card("v1")).getByRole("button", { name: /Mark rolled back/ }));
    expect(byId("v1")).toMatchObject({ status: "rolled_back", shippedDate: "2026-10-19" });
    expect(within(card("v1")).getByText("rolled back")).toBeInTheDocument();
    // A rollback still counts as a release that went out (on time here).
    expect(tile("% on time")).toBe("% on time100%of 1 shipped, incl. 1 rolled back");
    fireEvent.click(within(card("v1")).getByRole("button", { name: /Reopen for planning/ }));
    expect(byId("v1").status).toBe("planning");
    expect(byId("v1").shippedDate).toBeUndefined();
    expect(within(card("v1")).getByRole("button", { name: /Ship/ })).toBeEnabled();
  });

  it("removes exactly the clicked release", () => {
    seed([release("a"), release("b"), release("c")]);
    render(<ReleaseReadinessClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove b" }));
    expect(releases().map((r) => r.id)).toEqual(["a", "c"]);
    expect(history.log).toHaveBeenCalledWith("release_removed", { releaseId: "b", name: "b" });
  });
});

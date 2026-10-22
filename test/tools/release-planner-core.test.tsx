import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Release Planner gap-filling: parsing the typed velocities, the start-date
 * guard, the histogram's words in every branch, and the client — a
 * deterministic forecast (one velocity) with its dates and table, the
 * target sprints, the empty-velocity state, the config inputs (clamps,
 * clearing, history on blur), the scope slider and Reset.
 */

const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
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
});

import { ReleasePlannerClient } from "@/app/(tools)/release-planner/release-planner-client";
import { effectiveStartDate, parseVelocities } from "@/app/(tools)/release-planner/velocity-source";
import { simulationHistogramText } from "@/app/(tools)/release-planner/chart-text";
import { RELEASE_PLANNER_ACTIONS } from "@/lib/history/event-actions";

/** The stat card holding `label`: its value and subtitle. */
function card(label: string) {
  const content = screen.getByText(label).parentElement!.parentElement!;
  const [, value, sub] = Array.from(content.children).map((el) => el.textContent ?? "");
  return { value, sub };
}

const backlog = () => screen.getByLabelText("Backlog Size (story points)");
const buffer = () => screen.getByLabelText("Scope Buffer %");
const sprintLength = () => screen.getByLabelText("Sprint Length (days)");
const velocities = () => screen.getByRole("textbox", { name: /Historical velocities/ });

function set(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

/** Render from the defaults, with no history from the Reset. */
function fresh() {
  render(<ReleasePlannerClient />);
  fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
  history.log.mockClear();
}

/** One velocity of 10 and a 100-point backlog: every run takes exactly 10 sprints. */
function deterministic() {
  fresh();
  set(backlog(), "100");
  set(buffer(), "0");
  set(velocities(), "10");
  fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2027-01-04" } });
}

beforeEach(() => {
  history.log.mockClear();
  useWorkspaceStore.setState({ sprints: [] });
});

describe("parseVelocities", () => {
  it("reads commas and lines, and drops blanks, zeros, negatives and words", () => {
    expect(parseVelocities("18, 22\n19,,\n\n 25 ")).toEqual([18, 22, 19, 25]);
    expect(parseVelocities("0, -4, abc, 12.5")).toEqual([12.5]);
    expect(parseVelocities("")).toEqual([]);
  });
});

describe("effectiveStartDate", () => {
  it("ignores a set date that isn't YYYY-MM-DD", () => {
    expect(effectiveStartDate("2027-1-4", undefined, "2026-10-19")).toEqual({
      date: "2026-10-19",
      from: "today",
    });
    expect(effectiveStartDate("garbage", undefined, "2026-10-19").from).toBe("today");
  });
});

describe("simulationHistogramText branches", () => {
  const base = { total: 10_000, target: null };

  it("says there's no simulation yet without bars or runs", () => {
    expect(
      simulationHistogramText({ ...base, histogram: [], p50: 0, p85: 0, p95: 0 }).summary
    ).toBe("No simulation yet.");
    const zeroRuns = simulationHistogramText({
      histogram: [{ sprints: 5, count: 0 }],
      total: 0,
      p50: 5,
      p85: 5,
      p95: 5,
      target: 5,
    });
    expect(zeroRuns.summary).toBe("No simulation yet.");
    // No division by zero in the table either.
    expect(zeroRuns.table.rows).toEqual([[5, 0, "0%"]]);
  });

  it("merges a median equal to the 85th, or an 85th equal to the 95th", () => {
    const histogram = [
      { sprints: 5, count: 9000 },
      { sprints: 6, count: 1000 },
    ];
    expect(simulationHistogramText({ ...base, histogram, p50: 5, p85: 5, p95: 6 }).summary).toBe(
      "In 10,000 simulated runs, 85% finish within 5 sprints and 95% within 6."
    );
    expect(simulationHistogramText({ ...base, histogram, p50: 4, p85: 6, p95: 6 }).summary).toBe(
      "In 10,000 simulated runs, half finish within 4 sprints and 95% within 6."
    );
  });

  it("gives the share within a target, 0% when it's below every run", () => {
    const text = simulationHistogramText({
      histogram: [
        { sprints: 5, count: 6000 },
        { sprints: 6, count: 4000 },
      ],
      total: 10_000,
      p50: 5,
      p85: 6,
      p95: 6,
      target: 1,
    });
    expect(text.summary).toMatch(/; 0% finish within the target of 1 sprint\.$/);
    expect(text.table.columns).toEqual(["Sprints needed", "Runs", "Share of runs"]);
    expect(text.table.rows).toEqual([
      [5, 6000, "60%"],
      [6, 4000, "40%"],
    ]);
  });
});

describe("Release Planner: forecast", () => {
  it("dates each confidence level from the start date and sprint length", () => {
    deterministic();
    expect(card("Effective Backlog")).toEqual({ value: "100 pts", sub: "100 pts + 0% buffer" });
    expect(card("Avg Velocity")).toEqual({ value: "10 pts/sprint", sub: "1 data point" });
    // 10 sprints × 14 days from 4 Jan 2027.
    expect(card("50% Confidence")).toEqual({ value: "10 sprints", sub: "May 24, 2027" });
    expect(card("85% Confidence")).toEqual({ value: "10 sprints", sub: "May 24, 2027" });
    expect(
      screen.getByText("In 10,000 simulated runs, every run finishes in 10 sprints.")
    ).toBeInTheDocument();

    const table = screen.getByText("Calendar Days").closest("table")!;
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(rows).toEqual([
      "50%confidence10140May 24, 2027",
      "75%confidence10140May 24, 2027",
      "85%confidence10140May 24, 2027",
      "95%confidence10140May 24, 2027",
    ]);

    // A one-week sprint halves the calendar.
    set(sprintLength(), "7");
    expect(card("50% Confidence").sub).toBe("Mar 15, 2027");
  });

  it("checks the forecast against a target number of sprints", () => {
    deterministic();
    const target = screen.getByLabelText("Target sprints to release (optional)");
    set(target, "8");
    expect(
      screen.getByText(
        "In 10,000 simulated runs, every run finishes in 10 sprints; 0% finish within the target of 8 sprints."
      )
    ).toBeInTheDocument();
    set(target, "12");
    expect(
      screen.getByText(/; 100% finish within the target of 12 sprints\.$/)
    ).toBeInTheDocument();
    // Blank: no target.
    set(target, "");
    expect(
      screen.getByText("In 10,000 simulated runs, every run finishes in 10 sprints.")
    ).toBeInTheDocument();
  });

  it("asks for velocities when none of the typed values is usable", () => {
    fresh();
    set(velocities(), "abc, 0, -3");
    expect(screen.getByText("Enter at least one positive velocity value.")).toBeInTheDocument();
    expect(screen.getByText("Enter velocity data to run simulation.")).toBeInTheDocument();
    expect(card("Avg Velocity")).toEqual({ value: "0 pts/sprint", sub: "0 data points" });
    expect(card("50% Confidence")).toEqual({ value: "—", sub: undefined });
    expect(screen.queryByText("Delivery Forecast")).toBeNull();
  });

  it("adds the scope buffer and the slider's adjustment to the backlog", () => {
    deterministic();
    set(buffer(), "20");
    expect(card("Effective Backlog")).toEqual({ value: "120 pts", sub: "100 pts + 20% buffer" });
    const slider = screen.getByRole("slider", { name: "Scope adjustment" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuetext", "-1%");
    // 100 × 1.2 × 0.99 = 118.8 → 119.
    expect(card("Effective Backlog")).toEqual({
      value: "119 pts",
      sub: "100 pts + 20% buffer, -1% scope adjustment",
    });
  });
});

describe("Release Planner: config inputs", () => {
  it("clamps the buffer to 0–100 and the sprint length to 1–90", () => {
    fresh();
    set(buffer(), "150");
    expect(buffer()).toHaveValue(100);
    set(buffer(), "-5");
    expect(buffer()).toHaveValue(0);
    set(sprintLength(), "120");
    expect(sprintLength()).toHaveValue(90);
    set(sprintLength(), "0");
    expect(sprintLength()).toHaveValue(1);
    set(backlog(), "-10");
    expect(backlog()).toHaveValue(1);
  });

  // Bug: Number("") is 0, clamped to the minimum of 1 on every keystroke, so
  // emptying the backlog or sprint length snapped the box to "1" and the
  // next digit typed went after it ("1" + "80" = 180).
  it("lets the backlog and sprint length be emptied while typing", () => {
    fresh();
    fireEvent.change(backlog(), { target: { value: "" } });
    expect(backlog()).toHaveValue(null);
    fireEvent.change(backlog(), { target: { value: "80" } });
    expect(backlog()).toHaveValue(80);
    fireEvent.blur(backlog());
    expect(card("Effective Backlog").value).toBe("88 pts");

    fireEvent.change(sprintLength(), { target: { value: "" } });
    expect(sprintLength()).toHaveValue(null);
    fireEvent.change(sprintLength(), { target: { value: "7" } });
    fireEvent.blur(sprintLength());
    expect(sprintLength()).toHaveValue(7);
  });

  it("puts the number back when a box is left empty", () => {
    fresh();
    fireEvent.change(backlog(), { target: { value: "" } });
    fireEvent.blur(backlog());
    expect(backlog()).toHaveValue(120);
    expect(card("Effective Backlog").value).toBe("132 pts");
  });

  it("updates quietly while typing and logs once on leaving the box", () => {
    fresh();
    fireEvent.change(backlog(), { target: { value: "2" } });
    fireEvent.change(backlog(), { target: { value: "20" } });
    fireEvent.change(backlog(), { target: { value: "200" } });
    expect(card("Effective Backlog").value).toBe("220 pts");
    expect(history.log).not.toHaveBeenCalled();
    fireEvent.blur(backlog());
    expect(history.log.mock.calls).toEqual([
      [RELEASE_PLANNER_ACTIONS.RELEASE_UPDATED, { fields: ["backlogSize"] }],
    ]);
  });

  it("Reset brings back the defaults and logs it", () => {
    fresh();
    set(backlog(), "50");
    set(sprintLength(), "7");
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(backlog()).toHaveValue(120);
    expect(sprintLength()).toHaveValue(14);
    expect(card("Effective Backlog").value).toBe("132 pts");
    expect(history.log).toHaveBeenLastCalledWith(RELEASE_PLANNER_ACTIONS.RELEASE_RESET, {});
  });
});

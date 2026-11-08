import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  BurndownChart,
  MIN_DAY_PX_FOR_SCOPE_LABELS,
  placeScopeLabels,
  scopeLegendEntries,
  scopeMarks,
  type BurndownChartRow,
} from "@/app/(tools)/burndown/charts";

/**
 * The burndown's reference-line labels at phone width (mobile audit
 * 2026-11-08): "+8" on day 3, "−5" on day 4 and "Today" on day 5 all sat at
 * the top of a chart about 15 px a day wide and printed as "+8−5Today".
 * "Today" is now the only label above the plot; scope labels sit inside it
 * beside their lines, staggered, and on a narrow chart move to the tooltip
 * with the legend naming the bare lines. The chart renders for real (a fixed
 * size, so nothing has to be measured).
 */

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// Recharts draws labels in z-index layers, away from their reference lines.
const lineLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("text.recharts-label"))
    .map((t) => t.textContent ?? "")
    .filter((t) => t !== "Sprint day" && t !== "Points");

describe("placeScopeLabels", () => {
  const marks = [
    { x: 100, label: "+8" },
    { x: 115, label: "−5" },
  ];

  it("keeps every label off its line below the minimum spacing between days", () => {
    expect(placeScopeLabels(marks, { dayPx: 15, maxX: 300 })).toEqual([null, null]);
    expect(placeScopeLabels(marks, { dayPx: MIN_DAY_PX_FOR_SCOPE_LABELS - 1, maxX: 300 })).toEqual([
      null,
      null,
    ]);
  });

  it("puts labels beside their lines and drops a crowded one to the next row", () => {
    // "+8" spans 105–119: "−5" from 120 would touch it, so it goes a row down.
    expect(placeScopeLabels(marks, { dayPx: 30, maxX: 600 })).toEqual([
      { row: 0, side: "right" },
      { row: 1, side: "right" },
    ]);
    // Far apart, both stay on the first row.
    expect(
      placeScopeLabels(
        [
          { x: 100, label: "+8" },
          { x: 200, label: "−5" },
        ],
        { dayPx: 30, maxX: 600 }
      )
    ).toEqual([
      { row: 0, side: "right" },
      { row: 0, side: "right" },
    ]);
  });

  it("flips a label to the left of its line at the chart's right edge", () => {
    expect(placeScopeLabels([{ x: 290, label: "+12" }], { dayPx: 30, maxX: 300 })).toEqual([
      { row: 0, side: "left" },
    ]);
  });

  it("leaves a label that fits in no row off its line", () => {
    const crowded = [100, 102, 104].map((x) => ({ x, label: "+10" }));
    expect(placeScopeLabels(crowded, { dayPx: 30, maxX: 600 })).toEqual([
      { row: 0, side: "right" },
      { row: 1, side: "right" },
      null,
    ]);
  });

  it("can stagger instead of hiding on a narrow chart (Burnup)", () => {
    expect(placeScopeLabels(marks, { dayPx: 15, maxX: 300, hideWhenNarrow: false })).toEqual([
      { row: 0, side: "right" },
      { row: 1, side: "right" },
    ]);
  });
});

describe("scope markers", () => {
  it("label moves with their amounts, or flagged days as Scope", () => {
    const moves = scopeMarks(
      [
        { day: 3, added: 8, removed: 0 },
        { day: 4, added: 0, removed: 5 },
      ],
      []
    );
    expect(moves.map((m) => [m.day, m.label])).toEqual([
      [3, "+8"],
      [4, "−5"],
    ]);
    expect(scopeMarks(undefined, [2]).map((m) => m.label)).toEqual(["Scope"]);
  });

  it("names each kind of unlabelled line once in the legend", () => {
    const marks = scopeMarks(
      [
        { day: 3, added: 8, removed: 0 },
        { day: 4, added: 0, removed: 5 },
        { day: 6, added: 2, removed: 1 },
      ],
      []
    );
    expect(scopeLegendEntries(marks).map((e) => e.value)).toEqual(["Scope added", "Scope removed"]);
    expect(scopeLegendEntries(scopeMarks(undefined, [2])).map((e) => e.value)).toEqual([
      "Scope change",
    ]);
  });
});

describe("BurndownChart", () => {
  const data: BurndownChartRow[] = Array.from({ length: 15 }, (_, day) => ({
    day,
    ideal: 35 - day * 2.5,
    actual: day <= 5 ? 35 - day : null,
  }));
  const scopeMoves = [
    { day: 3, added: 8, removed: 0 },
    { day: 4, added: 0, removed: 5 },
  ];

  it("on a phone, keeps Today as the only label and names the scope lines in the legend", () => {
    const { container } = render(
      <BurndownChart
        data={data}
        scopeChangeDays={[]}
        todayDay={5}
        scopeMoves={scopeMoves}
        width={292}
        height={200}
      />
    );
    expect(lineLabels(container)).toEqual(["Today"]);
    expect(screen.getByText("Scope added")).toBeInTheDocument();
    expect(screen.getByText("Scope removed")).toBeInTheDocument();
  });

  it("on a wide chart, labels the scope lines inside the plot, clear of Today", () => {
    const { container } = render(
      <BurndownChart
        data={data}
        scopeChangeDays={[]}
        todayDay={5}
        scopeMoves={scopeMoves}
        width={900}
        height={240}
      />
    );
    expect(lineLabels(container)).toEqual(expect.arrayContaining(["+8", "−5", "Today"]));
    // Today sits above the plot, the scope labels below its top edge.
    const y = (text: string) =>
      Number(
        Array.from(container.querySelectorAll("text.recharts-label"))
          .find((t) => t.textContent === text)
          ?.getAttribute("y")
      );
    expect(y("Today")).toBeLessThan(y("+8"));
    expect(screen.queryByText("Scope added")).not.toBeInTheDocument();
  });

  it("flags a logged scope day the same way in the Sprint Cockpit's chart", () => {
    const { container } = render(
      <BurndownChart data={data} scopeChangeDays={[4]} todayDay={5} width={292} height={200} />
    );
    expect(lineLabels(container)).toEqual(["Today"]);
    expect(screen.getByText("Scope change")).toBeInTheDocument();
  });
});

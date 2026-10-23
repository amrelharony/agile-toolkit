import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MIN_SAMPLE, enoughData, needMore } from "@/lib/analytics/min-sample";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";

describe("minimum samples", () => {
  it("counts by kind or by number", () => {
    expect(enoughData(MIN_SAMPLE.trend - 1, "trend")).toBe(false);
    expect(enoughData(MIN_SAMPLE.trend, "trend")).toBe(true);
    expect(enoughData(2, 3)).toBe(false);
    expect(needMore(2, 6)).toBe(4);
    expect(needMore(9, 6)).toBe(0);
    expect(needMore(-3, 2)).toBe(2);
    expect(needMore(2.7, 4)).toBe(2);
  });

  it("says what to add and how many, and disappears once there's enough", () => {
    const { rerender } = render(
      <NotEnoughData
        have={4}
        need="trend"
        unit={["sprint", "sprints"]}
        action="Log"
        what="the trend"
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Log 2 more sprints to see the trend.");

    rerender(<NotEnoughData have={5} need="trend" unit={["sprint", "sprints"]} what="the trend" />);
    expect(screen.getByRole("status")).toHaveTextContent("Add 1 more sprint to see the trend.");

    rerender(<NotEnoughData have={6} need="trend" unit={["sprint", "sprints"]} what="the trend" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps advanced analysis closed until opened", () => {
    render(
      <AdvancedAnalysis summary="Control chart">
        <p>CUSUM</p>
      </AdvancedAnalysis>
    );
    const details = screen.getByText("Control chart").closest("details")!;
    expect(details.open).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Card titles are hand lettered, and whatever sits inside the title inherits that.
 * Counts, metrics and badges beside a title stay in the plain face: numbers are
 * never lettered by hand.
 */

vi.mock("next/dynamic", () => ({
  default: () =>
    function ResponsiveContainer({ children }: { children: ReactNode }) {
      return <div>{children}</div>;
    },
}));

import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";

describe("numbers beside a card title", () => {
  it("keeps a section's suffix out of the lettering", () => {
    render(
      <SectionCard title="Refinement" titleSuffix="(3 to refine)">
        <p>Body</p>
      </SectionCard>
    );
    expect(screen.getByText("(3 to refine)")).toHaveClass("font-sans");
  });

  it("keeps a chart's text badge out of the lettering", () => {
    render(
      <ChartCard title="Trend" badge="experimental">
        <svg />
      </ChartCard>
    );
    expect(screen.getByText("experimental")).toHaveClass("font-sans");
  });

  it("keeps a chart's custom badge out of the lettering", () => {
    render(
      <ChartCard title="Burndown" badge={<em>From the sprint board</em>}>
        <svg />
      </ChartCard>
    );
    expect(screen.getByText("From the sprint board").parentElement).toHaveClass("font-sans");
  });
});

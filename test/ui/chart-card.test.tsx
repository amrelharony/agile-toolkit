import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChartTable } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";

/**
 * ChartCard is a <figure> named by its title. With a summary and a table it
 * gets a text alternative: the summary is visible and is the figure's
 * description, the plot is hidden from assistive tech, and "View as table"
 * swaps the chart for a real table while the chart stays mounted. Without
 * those props the markup is the old card's, apart from the figure semantics.
 */

// ResponsiveContainer loads through next/dynamic; a plain wrapper stands in
// so the markup is deterministic (and identical in the legacy copy below).
vi.mock("next/dynamic", () => ({
  default: () =>
    function ResponsiveContainer({ children }: { children: ReactNode }) {
      return <div data-rc="">{children}</div>;
    },
}));

import { ChartCard, ChartFigure } from "@/components/shared/chart-card";
import { ChartDataTable } from "@/components/shared/chart-data-table";

const SUMMARY = "Remaining points fell from 40 to 27 over 5 days; 7 points behind the ideal line.";
const TABLE: ChartTable = {
  caption: "Points remaining by sprint day",
  columns: ["Day", "Ideal", "Remaining"],
  rows: [
    [0, 40, 40],
    [1, 36, 37],
    [2, 32, "—"],
  ],
};

const Plot = () => <svg data-testid="plot" />;

const toggle = () => screen.getByRole("button", { name: "View as table" });

describe("ChartCard", () => {
  it("renders a figure named by its title", () => {
    render(
      <ChartCard title="Burndown chart" icon={BarChart3} badge="live">
        <Plot />
      </ChartCard>
    );
    const figure = screen.getByRole("figure", { name: "Burndown chart" });
    expect(figure.tagName).toBe("FIGURE");
    // The title is still the card's heading, and the name leaves the badge out.
    expect(within(figure).getByRole("heading", { level: 3 })).toHaveTextContent("Burndown chart");
  });

  it("shows the summary under the title and uses it as the figure's description", () => {
    render(
      <ChartCard title="Burndown chart" summary={SUMMARY}>
        <Plot />
      </ChartCard>
    );
    const figure = screen.getByRole("figure", { name: "Burndown chart" });
    expect(figure).toHaveAccessibleDescription(SUMMARY);
    expect(screen.getByText(SUMMARY)).toBeVisible();
    // The plot is hidden from assistive tech behind the summary.
    expect(screen.getByTestId("plot").parentElement?.parentElement).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    // No table, no toggle.
    expect(screen.queryByRole("button", { name: "View as table" })).not.toBeInTheDocument();
  });

  it("swaps the chart for a table and back, with aria-expanded in step", () => {
    render(
      <ChartCard title="Burndown chart" summary={SUMMARY} table={TABLE}>
        <Plot />
      </ChartCard>
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table", { name: "Points remaining by sprint day" });
    expect(toggle()).toHaveAttribute(
      "aria-controls",
      table.closest("[role=region]")?.getAttribute("id")
    );
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent)
    ).toEqual(["Day", "Ideal", "Remaining"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => Array.from(r.children).map((c) => c.textContent))).toEqual([
      ["0", "40", "40"],
      ["1", "36", "37"],
      ["2", "32", "—"],
    ]);
    // Each row is named by its first cell.
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("1");
    // The chart stays mounted (hidden at its size), so it comes back without a redraw.
    const plotBox = screen.getByTestId("plot").parentElement?.parentElement;
    expect(plotBox).toHaveClass("invisible", "absolute");

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByTestId("plot").parentElement?.parentElement).not.toHaveClass("invisible");
  });

  it("puts the toggle before the header's own buttons and hides it for an empty table", () => {
    const { rerender } = render(
      <ChartCard
        title="Burndown chart"
        table={TABLE}
        headerExtras={<button type="button">Export</button>}
      >
        <Plot />
      </ChartCard>
    );
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["View as table", "Export"]);

    rerender(
      <ChartCard title="Burndown chart" table={{ ...TABLE, rows: [] }}>
        <Plot />
      </ChartCard>
    );
    expect(screen.queryByRole("button", { name: "View as table" })).not.toBeInTheDocument();
  });

  it("without the new props, renders the old card markup apart from the figure", () => {
    const extras = <button type="button">Export</button>;
    const footer = <p>Footer</p>;
    const { container: next } = render(
      <ChartCard
        title="Daily activity"
        icon={BarChart3}
        badge="live"
        headerExtras={extras}
        height={300}
        className="mt-4"
        footer={footer}
      >
        <Plot />
      </ChartCard>
    );
    const { container: legacy } = render(
      <LegacyChartCard
        title="Daily activity"
        icon={BarChart3}
        badge="live"
        headerExtras={extras}
        height={300}
        className="mt-4"
        footer={footer}
      >
        <Plot />
      </LegacyChartCard>
    );
    // The only differences: <figure> for <div>, and the title id that names it.
    const normalize = (html: string) =>
      html
        .replace(/<figure /g, "<div ")
        .replace(/<\/figure>/g, "</div>")
        .replace(/ aria-labelledby="[^"]*"/g, "")
        .replace(/ id="[^"]*"/g, "");
    expect(next.innerHTML).toContain("<figure");
    expect(normalize(next.innerHTML)).toBe(legacy.innerHTML);
    expect(next.querySelector("[aria-hidden='true'][style]")).toBeNull();
  });
});

describe("ChartFigure", () => {
  it("names the figure by a visible heading and describes it with the summary", () => {
    render(
      <section>
        <h2 id="trend-title">Score trend</h2>
        <ChartFigure labelledBy="trend-title" summary={SUMMARY} table={TABLE}>
          <Plot />
        </ChartFigure>
      </section>
    );
    const figure = screen.getByRole("figure", { name: "Score trend" });
    expect(figure).toHaveAccessibleDescription(SUMMARY);
    expect(screen.getByTestId("plot").parentElement).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(figure).getByRole("table")).toBeInTheDocument();
    expect(screen.getByTestId("plot")).toBeInTheDocument();
  });

  it("takes a name when no heading names it, and leaves a bare chart alone", () => {
    const { rerender } = render(
      <ChartFigure label="Cycle time histogram" summary={SUMMARY}>
        <Plot />
      </ChartFigure>
    );
    expect(screen.getByRole("figure", { name: "Cycle time histogram" })).toBeInTheDocument();

    rerender(
      <ChartFigure label="Cycle time histogram">
        <Plot />
      </ChartFigure>
    );
    expect(screen.getByTestId("plot").parentElement).not.toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ChartDataTable", () => {
  it("falls back to the given caption and is a focusable, labelled region", () => {
    render(<ChartDataTable table={{ ...TABLE, caption: undefined }} fallbackCaption="Velocity" />);
    const region = screen.getByRole("region", { name: "Velocity" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table", { name: "Velocity" })).toBeInTheDocument();
    // Number columns line up on the right; the row-name column on the left.
    const headers = within(region).getAllByRole("columnheader");
    expect(headers[0]).toHaveClass("text-left");
    expect(headers[2]).toHaveClass("text-right");
  });
});

/* -------------------------------------------------------------------------- */
/*  The ChartCard markup before it became a figure (for the comparison test)  */
/* -------------------------------------------------------------------------- */

function LegacyResponsiveContainer({ children }: { children: ReactNode }) {
  return <div data-rc="">{children}</div>;
}

function LegacyChartCard({
  title,
  icon: Icon,
  badge,
  headerExtras,
  height = 224,
  className,
  footer,
  children,
}: {
  title: ReactNode;
  icon?: typeof BarChart3;
  badge?: ReactNode;
  headerExtras?: ReactNode;
  height?: number;
  className?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={cn(className)}>
      <CardHeader className={cn(headerExtras && "pb-2")}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0 flex-1">
            {Icon && <Icon className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{title}</span>
            {badge &&
              (typeof badge === "string" ? (
                <Badge variant="outline" className="ml-2 text-xs">
                  {badge}
                </Badge>
              ) : (
                <span className="ml-2">{badge}</span>
              ))}
          </CardTitle>
          {headerExtras && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">{headerExtras}</div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="-mx-1 sm:-mx-2" style={{ height: `${height}px` }}>
          <LegacyResponsiveContainer>{children}</LegacyResponsiveContainer>
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </CardContent>
    </Card>
  );
}

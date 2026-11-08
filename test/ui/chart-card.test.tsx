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

  it("on a phone, lets the title wrap and take its width, with the badge as one pill", () => {
    render(
      <ChartCard
        title="Burndown chart"
        icon={BarChart3}
        badge="From the sprint board"
        table={TABLE}
        headerExtras={<button type="button">Export</button>}
      >
        <Plot />
      </ChartCard>
    );
    const heading = screen.getByRole("heading", { level: 3 });
    // Below sm the title row wraps (the badge drops a line when it doesn't
    // fit) and sizes to its content, so the buttons wrap below rather than
    // squeezing the title to "Bur…". From sm up it is the old row.
    expect(heading).toHaveClass("max-sm:flex-wrap", "max-sm:basis-auto", "flex-1", "min-w-0");
    const title = within(heading).getByText("Burndown chart");
    expect(title).toHaveClass("sm:truncate", "break-words");
    // Capped at the room beside the icon, so a long title wraps next to it
    // rather than dropping below it.
    expect(title).toHaveClass("max-sm:max-w-[calc(100%-1.5rem)]");
    expect(title).not.toHaveClass("truncate");
    // The badge never splits over lines (its border broke open on each).
    expect(within(heading).getByText("From the sprint board")).toHaveClass("whitespace-nowrap");
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

  it("pins the row names on the left and pads cells less on a phone", () => {
    render(<ChartDataTable table={TABLE} />);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers[0]).toHaveClass("sticky", "left-0", "bg-card");
    expect(headers[1]).not.toHaveClass("sticky");
    for (const rowHeader of within(table).getAllByRole("rowheader")) {
      expect(rowHeader).toHaveClass("sticky", "left-0", "bg-card");
    }
    for (const cell of within(table).getAllByRole("cell")) {
      expect(cell).toHaveClass("px-2", "sm:px-3");
    }
  });

  it("draws the row dividers on the cells, so the pinned column keeps them", () => {
    render(<ChartDataTable table={TABLE} />);
    const table = screen.getByRole("table");
    // Collapsed borders are painted by the table, under the pinned cells'
    // background: the separate model lets each cell draw its own.
    expect(table).toHaveClass("border-separate", "border-spacing-0");
    const rows = within(table).getAllByRole("row");
    for (const row of rows) expect(row).not.toHaveClass("border-b");
    const cellsOf = (row: HTMLElement) => Array.from(row.children);
    // The header rule and every body row but the last, pinned cells included.
    for (const row of rows.slice(0, -1)) {
      for (const cell of cellsOf(row)) expect(cell).toHaveClass("border-b", "border-border");
    }
    for (const cell of cellsOf(rows[rows.length - 1])) expect(cell).not.toHaveClass("border-b");
  });

  it("draws its focus ring above the pinned column", () => {
    const { container } = render(<ChartDataTable table={TABLE} />);
    const region = screen.getByRole("region");
    // An inset ring on the region itself paints under its cells.
    expect(region).toHaveClass("peer");
    expect(region.className).not.toMatch(/\bring-/);
    const ring = container.querySelector("[data-focus-ring]");
    expect(ring).toHaveAttribute("aria-hidden", "true");
    expect(ring).toHaveClass(
      "absolute",
      "inset-0",
      "z-[3]",
      "pointer-events-none",
      "peer-focus-visible:ring-1",
      "peer-focus-visible:ring-inset"
    );
    // A later sibling of the region, so the peer selector reaches it.
    expect(ring?.parentElement).toBe(region.parentElement);
    expect(region.compareDocumentPosition(ring!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("fades its right edge only while there's more to scroll to", () => {
    // jsdom lays nothing out: a 445 px table in a 284 px box.
    const widths = [
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(445),
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(284),
    ];
    try {
      const { container } = render(<ChartDataTable table={TABLE} />);
      const region = screen.getByRole("region");
      const fade = () => container.querySelector("[data-scroll-fade]");
      expect(fade()).toBeInTheDocument();
      expect(fade()).toHaveAttribute("aria-hidden", "true");

      region.scrollLeft = 445 - 284;
      fireEvent.scroll(region);
      expect(fade()).not.toBeInTheDocument();

      region.scrollLeft = 40;
      fireEvent.scroll(region);
      expect(fade()).toBeInTheDocument();
    } finally {
      widths.forEach((w) => w.mockRestore());
    }
  });

  it("shows no fade when the table fits", () => {
    const { container } = render(<ChartDataTable table={TABLE} />);
    expect(container.querySelector("[data-scroll-fade]")).toBeNull();
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
  // The header classes are today's (the 2026-11 phone fix: the title wraps
  // and the badge stays one pill below sm); the structure is the old card's.
  return (
    <Card className={cn(className)}>
      <CardHeader className={cn(headerExtras && "pb-2")}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0 flex-1 max-sm:flex-wrap max-sm:basis-auto">
            {Icon && <Icon className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />}
            <span
              className={cn(
                "min-w-0 break-words sm:truncate",
                Icon && "max-sm:max-w-[calc(100%-1.5rem)]"
              )}
            >
              {title}
            </span>
            {badge &&
              (typeof badge === "string" ? (
                <Badge variant="outline" className="sm:ml-2 whitespace-nowrap font-sans text-xs">
                  {badge}
                </Badge>
              ) : (
                <span className="sm:ml-2 font-sans">{badge}</span>
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

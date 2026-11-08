import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Calendar } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";

/**
 * A compact StatCard label wraps to a second line instead of losing its end:
 * in Release Planner's 2-up forecast row on a phone, "To commit (P85)" showed
 * as "To commit (P…". jsdom has no layout, so these pin the classes that do it.
 */

describe("compact StatCard label", () => {
  it("wraps to two lines instead of truncating", () => {
    render(<StatCard variant="compact" label="To commit (P85)" icon={Calendar} value="Mar 28" />);
    const label = screen.getByText("To commit (P85)");
    expect(label).toHaveClass("line-clamp-2", "break-words", "min-w-0");
    expect(label).not.toHaveClass("truncate");
  });

  it("keeps the icon on the first line of a wrapped label", () => {
    const { container } = render(
      <StatCard variant="compact" label="Scope to forecast" icon={Calendar} value="207 pts" />
    );
    const row = screen.getByText("Scope to forecast").parentElement!;
    expect(row).toHaveClass("items-start");
    expect(row).not.toHaveClass("items-center");
    expect(container.querySelector("svg")).toHaveClass("shrink-0", "mt-px");
  });

  it("leaves the default (hero) variant's label as it was", () => {
    render(<StatCard label="Predictability" value="82" unit="%" />);
    expect(screen.getByText("Predictability")).toHaveClass("truncate");
  });
});

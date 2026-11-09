import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Release Planner:
 *   - With 3+ velocities the 85% card read "MC x · Boot y sprints" with no
 *     date. It now reads like the 50% card: the date, then the sprints (the
 *     bootstrap cross-check lives under Advanced analysis).
 *   - The scope line names every input to the number. A version-0 config's
 *     buffer and Scope Sensitivity adjustment load as one expected change
 *     (100 × 1.10 × 1.20 = 132), so its forecast doesn't move.
 */

vi.hoisted(() => {
  localStorage.setItem(
    "agile-toolkit:release-planner",
    JSON.stringify({
      state: {
        config: {
          backlogSize: 100,
          velocityInput: "10, 12, 9, 11, 10",
          scopeBuffer: 10,
          sprintLengthDays: 14,
          startDate: "2027-01-04",
          scopeAdjustment: 20,
          sprintsToReleaseTarget: "",
        },
      },
      version: 0,
    })
  );
});
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
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

/** The stat card holding `label`: [label, value, hint]. */
function card(label: string) {
  const content = screen.getByText(label).parentElement!.parentElement!;
  const [, value, sub] = Array.from(content.children).map((el) => el.textContent ?? "");
  return { value, sub };
}

const DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/; // "Jun 7, 2027"

describe("Release Planner stat cards", () => {
  it("shows the 85% forecast as a date and sprints, like the 50% card", () => {
    render(<ReleasePlannerClient />);
    const p50 = card("Coin flip (P50)");
    const p85 = card("Commit (P85)");
    expect(p50.value).toMatch(DATE);
    expect(p85.value).toMatch(DATE);
    expect(p50.sub).toMatch(/^\d+ sprints?$/);
    expect(p85.sub).toMatch(/^\d+ sprints?$/);
    expect(`${p85.value} ${p85.sub}`).not.toMatch(/MC|Boot|P85/);
  });

  it("keeps the four forecast labels short enough for one line in a 2-up phone row", () => {
    render(<ReleasePlannerClient />);
    // About 90 px of label at 360 wide: "To commit (P85)" (94 px) and "Scope to
    // forecast" (100 px) wrapped and put their value a line below the
    // neighbouring card's; "Coin flip (P50)" (81 px) and "Velocity" fit.
    const grid = screen.getByText("Commit (P85)").closest(".grid")!;
    expect(grid).toHaveClass("grid-cols-2");
    const shown = Array.from(grid.children).map(
      (c) => c.querySelector(".line-clamp-2")?.textContent
    );
    expect(shown).toEqual(["Coin flip (P50)", "Commit (P85)", "Total scope", "Velocity"]);
  });

  it("loads an old buffer and adjustment as one expected scope change", () => {
    render(<ReleasePlannerClient />);
    expect(card("Total scope").value).toBe("132 pts");
    expect(screen.getByLabelText("Expected scope change")).toHaveValue("32");
    expect(screen.getByText(/^Scope to forecast:/).textContent).toBe(
      "Scope to forecast: 132 points (100 with a +32% change)."
    );
  });
});

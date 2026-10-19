import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Release Planner:
 *   - With 3+ velocities the 85% Confidence card read "MC x · Boot y sprints"
 *     with no date. It now reads like the 50% card: sprints, then the date.
 *   - The Effective Backlog subtitle names the Scope Sensitivity adjustment
 *     that feeds the number.
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

/** The stat card holding `label`: [label, value, subtitle]. */
function card(label: string) {
  const content = screen.getByText(label).parentElement!.parentElement!;
  const [, value, sub] = Array.from(content.children).map((el) => el.textContent ?? "");
  return { value, sub };
}

const DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}/; // "Jun 7, 2027"

describe("Release Planner stat cards", () => {
  it("shows the 85% forecast as sprints and a date, like the 50% card", () => {
    render(<ReleasePlannerClient />);
    const p50 = card("50% Confidence");
    const p85 = card("85% Confidence");
    expect(p50.value).toMatch(/^\d+ sprints$/);
    expect(p85.value).toMatch(/^\d+ sprints$/);
    expect(p85.sub).toMatch(DATE);
    expect(`${p85.value} ${p85.sub}`).not.toMatch(/MC|Boot|P85/);
  });

  it("names the scope adjustment in the Effective Backlog subtitle", () => {
    render(<ReleasePlannerClient />);
    // 100 × 1.10 × 1.20 = 132.
    expect(card("Effective Backlog")).toEqual({
      value: "132 pts",
      sub: "100 pts + 10% buffer, +20% scope adjustment",
    });
  });
});

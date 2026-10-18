import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_CHECK_DIMENSIONS,
  type HealthDimension,
  type HealthTrafficLight,
} from "@/lib/stores/workspace-types";

/**
 * Health check: "Load an example" adds three saved checks and a rated
 * current check to a blank tool, "Clear example" removes only the example
 * checks (and the current check if it is still the example's), and the
 * checks export as Markdown.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";
import { buildExample } from "@/app/(tools)/health-check/example";
import { toMarkdown } from "@/app/(tools)/health-check/markdown";

const NOW = new Date(2026, 9, 18);
const doc = () =>
  useWorkspaceStore.getState().healthChecks?.find((d) => d.id === "healthCheck:current");
const notice = () => screen.queryByText("Example data.");
const score = () => screen.getByTestId("health-check-score");
const allGreen = Object.fromEntries(
  HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: "green", trend: "same" }])
) as never;

beforeEach(() => {
  useWorkspaceStore.setState({ healthChecks: [] });
});

describe("Health check Markdown", () => {
  it("shows the current check per dimension, then the history side by side", () => {
    const md = toMarkdown(buildExample(NOW), NOW);
    expect(md).toMatch(/^# Squad Health Check — 18 Oct 2026\n/);
    expect(md).toContain("## Current check: Sprint 15");
    expect(md).toContain("**Health:** 63% (5 of 8 dimensions green)");
    expect(md).toContain("| Dimension | Status | Trend |");
    expect(md).toContain("| Easy to Release | 🟢 Green | ↑ Up |");
    expect(md).toContain("| Health of Codebase | 🔴 Red | ↓ Down |");
    expect(md).toContain("## History");
    expect(md).toContain(
      "| Dimension | Sprint 12 (2026-09-06) | Sprint 13 (2026-09-20) | Sprint 14 (2026-10-04) |"
    );
    expect(md).toContain("| Easy to Release | 🔴 Red | 🔴 Red | 🟡 Yellow |");
    expect(md).toContain("| **Health** | **50%** | **50%** | **38%** |");
  });

  it("marks dimensions the page shows as not rated", () => {
    const { current } = buildExample(NOW);
    const lights = Object.fromEntries(
      HEALTH_CHECK_DIMENSIONS.map((d) => [d, d === "Fun" ? "yellow" : null])
    ) as Record<HealthDimension, HealthTrafficLight | null>;
    const md = toMarkdown({ current, history: [], lights }, NOW);
    expect(md).toContain("**Health:** 0% (0 of 1 rated green; 7 not rated yet)");
    expect(md).toContain("| Fun | 🟡 Yellow | → Same |");
    expect(md).toContain("| Teamwork | Not rated | — |");
    expect(md).not.toContain("## History");
  });

  it("escapes pipes in sprint names", () => {
    const md = toMarkdown(
      {
        current: { sprintName: "S2 | hotfix", scores: allGreen },
        history: [{ id: "h1", sprintName: "S1 | patch", date: "2026-10-01", scores: allGreen }],
      },
      NOW
    );
    expect(md).toContain("## Current check: S2 \\| hotfix");
    expect(md).toContain("| Dimension | S1 \\| patch (2026-10-01) |");
  });

  it("says there are no checks yet", () => {
    const lights = Object.fromEntries(HEALTH_CHECK_DIMENSIONS.map((d) => [d, null])) as Record<
      HealthDimension,
      null
    >;
    expect(
      toMarkdown({ current: { sprintName: "", scores: allGreen }, history: [], lights }, NOW)
    ).toBe("# Squad Health Check — 18 Oct 2026\n\nNo health checks yet.\n");
  });
});

describe("Health check example", () => {
  it("loads into a blank tool and clears only the example checks", () => {
    render(<HealthCheckClient />);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(notice()).toBeInTheDocument();
    expect(doc()?.history.map((h) => h.sprintName)).toEqual([
      "Sprint 12",
      "Sprint 13",
      "Sprint 14",
    ]);
    expect(doc()?.history.every((h) => h.id.startsWith("example-"))).toBe(true);
    expect(screen.getByRole("textbox", { name: "Sprint name" })).toHaveValue("Sprint 15");
    // Every dimension counts as rated, greens included.
    expect(score()).toHaveTextContent("63%");
    expect(screen.getByRole("button", { name: "Save Check" })).toBeEnabled();

    // The user saves a check of their own.
    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));
    expect(doc()?.history).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(doc()?.history.map((h) => h.sprintName)).toEqual(["Sprint 15"]);
    expect(doc()?.history[0].id.startsWith("example-")).toBe(false);
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("goes back to a blank tool when nothing was changed", () => {
    render(<HealthCheckClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(doc()?.history).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Sprint name" })).toHaveValue("");
    expect(score()).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("keeps an edited current check, still rated", () => {
    render(<HealthCheckClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Fun status" })).getByRole("button", {
        name: "Green",
      })
    );
    expect(score()).toHaveTextContent("75%");

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(doc()?.history).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Sprint name" })).toHaveValue("Sprint 15");
    expect(score()).toHaveTextContent("75%");
  });

  it("doesn't offer the example once there are saved checks", () => {
    useWorkspaceStore.setState({
      healthChecks: [
        {
          id: "healthCheck:current",
          current: { sprintName: "", scores: allGreen },
          history: [{ id: "h1", sprintName: "S1", date: "2026-10-01", scores: allGreen }],
        },
      ],
    });
    render(<HealthCheckClient />);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(notice()).toBeNull();
  });
});

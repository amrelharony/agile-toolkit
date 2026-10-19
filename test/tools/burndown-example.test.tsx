import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { EXAMPLE_SPRINT_PREFIX, exampleSprints } from "@/lib/sprints/example";
import { seriesFor } from "@/lib/sprints/series";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * Burndown's example is an in-memory preview of the example sprints: it is
 * read-only, says so, offers "Start your own" and "Back", and writes nothing
 * (no sprints, no daily log, no history). The sprint, through the view
 * adapter, still exports as the same Markdown.
 */

const spy = vi.hoisted(() => ({ logs: [] as unknown[], undos: [] as unknown[] }));

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => {
    spy.undos.push(a);
    a.apply();
  },
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
  useHistoryLogger: () => ({ log: (...args: unknown[]) => spy.logs.push(args) }),
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));

beforeAll(() => {
  // Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";
import { toMarkdown } from "@/app/(tools)/burndown/markdown";
import { burndownView } from "@/app/(tools)/burndown/view";

const NOW = new Date(2026, 9, 18);

beforeEach(() => {
  spy.logs = [];
  spy.undos = [];
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

describe("Burndown Markdown", () => {
  it("reports the example sprint against the ideal line, then every day", () => {
    const { current, series } = exampleSprints("2026-10-18");
    const md = toMarkdown(burndownView(current, seriesFor(series, current.id)), NOW);
    expect(md).toMatch(/^# Burndown — 18 Oct 2026\n/);
    expect(md).toContain("**Sprint:** 35 points over 14 days, starting 13 Oct 2026");
    expect(md).toContain(
      "**Day 5:** 24 points left, ideal 22.5: 1.5 points behind ideal (31% done)"
    );
    expect(md).toContain("## Scope changes");
    expect(md).toContain("- Day 3: Refund flow added");
    expect(md).toContain("| Day | Ideal | Remaining | Scope change | Note |");
    expect(md).toContain("| 3 | 27.5 | 32 | Yes | Refund flow added |");
    expect(md).toContain("| 6 | 20 | — |  |  |");
    expect(md).toContain("| 14 | 0 | — |  |  |");
  });

  it("escapes pipes and collapses newlines in notes", () => {
    const md = toMarkdown(
      {
        config: { totalPoints: 10, sprintDays: 2, sprintStartDate: "2026-10-16" },
        entries: [
          { id: "a", day: 0, remaining: 10, scopeChange: false },
          { id: "b", day: 1, remaining: 6, scopeChange: false, description: "API | DB\nmigrated" },
        ],
      },
      NOW
    );
    expect(md).toContain("| 1 | 5 | 6 |  | API \\| DB migrated |");
  });

  it("says nothing is logged on a new sprint", () => {
    const sprint = {
      id: "s1",
      name: "Sprint 1",
      startDate: "2026-10-18",
      endDate: "2026-10-20",
      pointsPlanned: 40,
      status: "active" as const,
    };
    const md = toMarkdown(burndownView(sprint, { id: "s1" }), NOW);
    expect(md).toBe("# Burndown — 18 Oct 2026\n\nNo days logged yet.\n");
  });
});

describe("Burndown example", () => {
  const remaining = (day: number) =>
    screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });

  it("previews the example sprint read-only and writes nothing", () => {
    render(
      <TooltipProvider>
        <BurndownClient />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "See an example" }));

    expect(screen.getByText("Example sprint.")).toBeInTheDocument();
    expect(screen.getByText("Example sprint: these can't be changed.")).toBeInTheDocument();
    expect(remaining(5)).toHaveValue(24);
    expect(remaining(5)).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Note for day 3" })).toHaveValue(
      "Refund flow added"
    );
    expect(screen.getByRole("button", { name: "Scope changed on day 3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear log" })).toBeDisabled();

    // Typing into the preview changes nothing.
    fireEvent.change(remaining(5), { target: { value: "10" } });
    fireEvent.blur(remaining(5));
    expect(remaining(5)).toHaveValue(24);

    const ws = useWorkspaceStore.getState();
    expect(ws.sprints).toEqual([]);
    expect(ws.sprintSeries).toEqual([]);
    expect(spy.logs).toEqual([]);
    expect(spy.undos).toEqual([]);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(EXAMPLE_SPRINT_PREFIX);

    // Back to the empty state, and "Start your own" opens the new-sprint dialog.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "No sprints yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Start your own" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("New sprint");
  });
});

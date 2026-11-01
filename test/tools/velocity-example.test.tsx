import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { exampleSprints } from "@/lib/sprints/example";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Velocity: the example is the shared in-memory example sprints, shown as a
 * read-only preview with "Start your own" and a way back; it never reaches
 * the workspace. The sprints export as Markdown.
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

import { VelocityClient } from "@/app/(tools)/velocity/velocity-client";
import { toMarkdown } from "@/app/(tools)/velocity/markdown";
import { toVelocityRows } from "@/app/(tools)/velocity/view";

const NOW = new Date(2026, 9, 18);

const sprint = (over: Partial<Sprint> & Pick<Sprint, "id" | "name">): Sprint => ({
  startDate: "2026-01-05",
  endDate: "2026-01-19",
  pointsPlanned: 0,
  status: "completed",
  ...over,
});

const FINISHED = [
  sprint({
    id: "a",
    name: "Sprint 1",
    startDate: "2026-01-05",
    pointsPlanned: 34,
    pointsCompleted: 28,
  }),
  sprint({
    id: "b",
    name: "Sprint 2",
    startDate: "2026-01-19",
    pointsPlanned: 30,
    pointsCompleted: 32,
  }),
  sprint({
    id: "c",
    name: "Sprint 3",
    startDate: "2026-02-02",
    pointsPlanned: 36,
    pointsCompleted: 35,
  }),
];

describe("Velocity Markdown", () => {
  it("reports average and predictability, then every sprint", () => {
    const md = toMarkdown(
      toVelocityRows([
        ...FINISHED,
        sprint({
          id: "p",
          name: "Sprint 4",
          startDate: "2026-02-16",
          pointsPlanned: 33,
          status: "planned",
          goal: "Wallet launch",
        }),
        sprint({ id: "x", name: "Sprint 5", startDate: "2026-03-02", status: "cancelled" }),
      ]),
      NOW
    );
    expect(md).toMatch(/^# Velocity — 18 Oct 2026\n/);
    // The shared velocity (the last 3 finished sprints) and the graded say/do.
    expect(md).toContain(
      "**Velocity:** 31.7 points, the average of the last 3 finished sprints by end date"
    );
    expect(md).toContain(
      "**Say/do:** 2 of the last 3 sprints with a commitment met it (90–110%); 1 close, 0 missed, 0 over. Mean 95%."
    );
    expect(md).toContain(
      "| Sprint | Committed | Completed | Say/do | Points per person-day | Goal |"
    );
    expect(md).toContain("| Sprint 1 | 34 | 28 | Close to the commitment (82%) | — |  |");
    expect(md).toContain("| Sprint 2 | 30 | 32 | Met the commitment (107%) | — |  |");
    expect(md).toContain("| Sprint 4 | 33 | — | Planned | — | Wallet launch |");
    expect(md).toContain("| Sprint 5 | 0 | — | Cancelled | — |  |");
  });

  it("doesn't count a sprint that's still running, even with points entered", () => {
    const md = toMarkdown(
      toVelocityRows([
        sprint({
          id: "r",
          name: "Sprint 9",
          pointsPlanned: 20,
          pointsCompleted: 12,
          status: "active",
        }),
      ]),
      NOW
    );
    expect(md).toContain("No finished sprints yet.");
    expect(md).toContain("| Sprint 9 | 20 | 12 | In progress | — |  |");
  });

  it("escapes pipes and collapses newlines in cells", () => {
    const md = toMarkdown(
      toVelocityRows([
        sprint({
          id: "a",
          name: "Sprint 5 | hotfix",
          pointsPlanned: 10,
          pointsCompleted: 12,
          goal: "a\nb",
        }),
      ]),
      NOW
    );
    expect(md).toContain(
      "| Sprint 5 \\| hotfix | 10 | 12 | Did more than committed (120%) | — | a b |"
    );
  });

  it("says there are no sprints yet", () => {
    expect(toMarkdown([], NOW)).toBe("# Velocity — 18 Oct 2026\n\nNo sprints yet.\n");
  });
});

describe("Velocity example", () => {
  beforeEach(() => {
    resetSelectedSprint();
    window.localStorage.clear();
    useSprintMigrationStore.setState({ status: "idle" });
    useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
  });
  afterEach(() => {
    useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
  });

  const renderVelocity = () =>
    render(
      <TooltipProvider>
        <VelocityClient />
      </TooltipProvider>
    );

  it("shows the example sprints read-only, on the in-progress one", () => {
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByText(/A preview only: nothing in it is saved/)).toBeInTheDocument();
    const example = exampleSprints();
    for (const s of example.sprints) expect(screen.getByText(s.name)).toBeInTheDocument();
    // Nothing to edit, add or remove.
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Add sprint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Commit" })).toBeNull();
    // The running example sprint is the selected one.
    const current = document.querySelector('[aria-current="true"]') as HTMLElement;
    expect(within(current).getByText(example.current.name)).toBeInTheDocument();
    // Four finished example sprints: 29 of 34 (close), 31 of 32, 30 of 36
    // (close) and 33 of 33: two met the commitment.
    expect(screen.getByText("2 of 4")).toBeInTheDocument();

    expect(useWorkspaceStore.getState().sprints).toEqual([]);
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([]);
  });

  it("Start your own creates a real sprint and leaves the preview", () => {
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Start your own" }));

    const dialog = screen.getByRole("dialog");
    // Numbered from the user's own sprints, not the example's.
    expect(within(dialog).getByRole("textbox", { name: /Name/ })).toHaveValue("Sprint 1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    const saved = useWorkspaceStore.getState().sprints;
    expect(saved).toHaveLength(1);
    expect(saved[0].id.startsWith("example-")).toBe(false);
    expect(saved[0].pointsCompleted).toBeUndefined();
    expect(screen.queryByText("Example data.")).toBeNull();
    expect(
      screen
        .getAllByRole("textbox", { name: "Sprint name" })
        .map((i) => (i as HTMLInputElement).value)
    ).toEqual(["Sprint 1"]);
  });
});

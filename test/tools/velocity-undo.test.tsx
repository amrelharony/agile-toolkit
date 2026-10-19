import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Velocity: removing a sprint removes the shared sprint (and its daily log
 * and ratings) from every sprint tool, so the toast says so, and its Undo
 * puts both back in place. Ctrl+Z time travel and Reset are gone: the rows
 * are shared sprints, not a local list.
 */

const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
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

const make = (n: number, over: Partial<Sprint> = {}): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: `2025-0${n}-01`,
  endDate: `2025-0${n}-15`,
  pointsPlanned: 30,
  pointsCompleted: 25 + n,
  status: "completed",
  ...over,
});
const SPRINTS = [make(1), make(2), make(3)];
const SERIES: SprintSeries[] = [
  { id: "s1", ratings: { Quality: 6 } },
  {
    id: "s2",
    days: [
      { day: 0, remaining: 30 },
      { day: 5, remaining: 12 },
    ],
    ratings: { Quality: 8 },
  },
];

const ws = () => useWorkspaceStore.getState();
const names = () =>
  screen.getAllByRole("textbox", { name: "Sprint name" }).map((i) => (i as HTMLInputElement).value);
const renderVelocity = () =>
  render(
    <TooltipProvider>
      <VelocityClient />
    </TooltipProvider>
  );

beforeEach(() => {
  undo.all = [];
  resetSelectedSprint();
  window.localStorage.clear();
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: SPRINTS, sprintSeries: SERIES });
});
afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

describe("Velocity undo", () => {
  it("restores removed sprints and their logs in place, whichever Undo runs first", () => {
    renderVelocity();

    fireEvent.click(screen.getByRole("button", { name: "Remove Sprint 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Sprint 1" }));
    expect(names()).toEqual(["Sprint 3"]);
    expect(ws().sprintSeries).toEqual([]);
    expect(undo.all.map((u) => u.label)).toEqual([
      "Removed “Sprint 2” from every sprint tool",
      "Removed “Sprint 1” from every sprint tool",
    ]);

    // An edit in between doesn't get rolled back by the Undo.
    const s3Completed = screen.getByRole("spinbutton", { name: "Completed points for Sprint 3" });
    fireEvent.change(s3Completed, { target: { value: "40" } });
    fireEvent.blur(s3Completed);

    act(() => undo.all[0].revert());
    expect(names()).toEqual(["Sprint 2", "Sprint 3"]);
    act(() => undo.all[1].revert());
    expect(names()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);

    expect(ws().sprints.find((s) => s.id === "s1")).toEqual(SPRINTS[0]);
    expect(ws().sprints.find((s) => s.id === "s2")).toEqual(SPRINTS[1]);
    expect(ws().sprints.find((s) => s.id === "s3")?.pointsCompleted).toBe(40);
    expect([...(ws().sprintSeries ?? [])].sort((a, b) => a.id.localeCompare(b.id))).toEqual(SERIES);
  });

  it("names an unnamed sprint plainly in the toast", () => {
    useWorkspaceStore.setState({ sprints: [make(1, { name: "" })], sprintSeries: [] });
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Remove sprint" }));
    expect(undo.all[0].label).toBe("Removed a sprint from every sprint tool");
    expect(ws().sprints).toEqual([]);
  });

  it("has no Ctrl+Z history and no Reset", () => {
    renderVelocity();
    expect(timeTravelRegistry.get("velocity")).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});

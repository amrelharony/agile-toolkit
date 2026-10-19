import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * Burndown undo: there is no Ctrl+Z time travel any more. Clearing a day
 * offers Undo in a toast (and a number logged since stays), and clearing the
 * whole log asks first, with the count, then offers Undo too. Both clear the
 * shared log, so Burnup's numbers go and come back with them.
 */

const spy = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
  logs: [] as Array<[string, Record<string, unknown> | undefined]>,
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    spy.last = a;
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
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => spy.logs.push([action, payload]),
  }),
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

const SPRINT: Sprint = {
  id: "s7",
  name: "Sprint 7",
  startDate: "2026-10-05",
  endDate: "2026-10-15",
  pointsPlanned: 40,
  status: "active",
};
const LOG: SprintSeries = {
  id: "s7",
  days: [
    { day: 1, remaining: 35 },
    { day: 2, remaining: 31, note: "Pairing on checkout" },
    { day: 3, completed: 12 }, // logged in Burnup
  ],
};

beforeEach(() => {
  spy.last = null;
  spy.logs = [];
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: [SPRINT], sprintSeries: [LOG] });
  render(
    <TooltipProvider>
      <BurndownClient />
    </TooltipProvider>
  );
});

const days = () => useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === "s7")?.days;
const remaining = (day: number) =>
  screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });
const note = (day: number) => screen.getByRole("textbox", { name: `Note for day ${day}` });

describe("Burndown undo", () => {
  it("has no Ctrl+Z time travel any more", () => {
    expect(timeTravelRegistry.get("burndown")).toBeUndefined();
  });

  it("clears one day with Undo, keeping a number logged since", () => {
    expect(remaining(2)).toHaveValue(31);
    fireEvent.click(screen.getByRole("button", { name: "Clear day 2" }));
    expect(spy.last?.label).toBe("Cleared day 2");
    expect(days()?.map((d) => d.day)).toEqual([1, 3]);
    expect(remaining(2)).toHaveValue(null);
    expect(spy.logs).toContainEqual(["day_removed", { sprintId: "s7", day: 2 }]);

    // A new number goes in before Undo: it stays, and the note comes back.
    fireEvent.change(remaining(2), { target: { value: "30" } });
    fireEvent.blur(remaining(2));
    act(() => spy.last!.revert());
    expect(remaining(2)).toHaveValue(30);
    expect(note(2)).toHaveValue("Pairing on checkout");
  });

  it("a day with nothing logged can't be cleared", () => {
    expect(screen.getByRole("button", { name: "Clear day 5" })).toBeDisabled();
  });

  it("confirms Clear log with the count, clears both tools' days, and Undo puts them back", () => {
    // Day 3 shows Burnup's number, worked out and dimmed.
    expect(remaining(3)).toHaveAccessibleDescription("28 from Burnup");

    fireEvent.click(screen.getByRole("button", { name: "Clear log" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Clear the log?");
    expect(dialog).toHaveTextContent(
      "The 3 logged days of Sprint 7 are cleared, here and in Burnup."
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear log" }));

    expect(days()).toEqual([]);
    expect(remaining(1)).toHaveValue(null);
    expect(remaining(3)).not.toHaveAccessibleDescription();
    expect(spy.last?.label).toBe("Cleared the log of Sprint 7");
    expect(spy.logs).toContainEqual(["burndown_reset", { sprintId: "s7", days: 3 }]);
    expect(screen.getByRole("button", { name: "Clear log" })).toBeDisabled();

    act(() => spy.last!.revert());
    expect(days()).toEqual(LOG.days);
    expect(remaining(1)).toHaveValue(35);
    expect(remaining(3)).toHaveAccessibleDescription("28 from Burnup");
  });
});

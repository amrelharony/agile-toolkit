import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";

/**
 * Velocity: removing a sprint offers Undo that puts it back in order, and the
 * toast Undo and the time-travel undo (Ctrl+Z) don't fight, in either order.
 * Reset asks first once the rows aren't the untouched examples.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
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

beforeEach(() => {
  undo.last = null;
});

const sprintNames = () =>
  screen.getAllByRole("textbox", { name: "Sprint name" }).map((i) => (i as HTMLInputElement).value);
const ctrlZ = () => act(() => void timeTravelRegistry.get("velocity")!.undo());

describe("Velocity undo", () => {
  it("restores a removed sprint in place, once, whichever undo runs first", () => {
    render(<VelocityClient />);
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);

    // Toast Undo, then Ctrl+Z.
    fireEvent.click(screen.getByRole("button", { name: "Remove Sprint 2" }));
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 3"]);
    expect(undo.last?.label).toBe("Removed “Sprint 2”");
    act(() => undo.last!.revert());
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
    ctrlZ();
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);

    // Ctrl+Z, then toast Undo.
    fireEvent.click(screen.getByRole("button", { name: "Remove Sprint 1" }));
    expect(sprintNames()).toEqual(["Sprint 2", "Sprint 3"]);
    ctrlZ();
    act(() => undo.last!.revert());
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
  });

  it("confirms Reset with the sprint count, and Undo restores the rows", () => {
    render(<VelocityClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add Sprint" }));
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset velocity data?");
    expect(dialog).toHaveTextContent("All 4 sprints are replaced with the 3 example sprints.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset sprints" }));
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);

    act(() => undo.last!.revert());
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4"]);
  });
});

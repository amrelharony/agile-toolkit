import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";

/**
 * Burndown: removing a day offers Undo, and the toast Undo and the
 * time-travel undo (Ctrl+Z) don't fight, in either order. Reset asks first
 * once days are logged, and is undoable.
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

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";

beforeEach(() => {
  undo.last = null;
});

const removeButtons = (day: number) =>
  screen.queryAllByRole("button", { name: `Remove day ${day}` });
const remainingOn = (day: number) =>
  screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` }) as HTMLInputElement;
const ctrlZ = () => act(() => void timeTravelRegistry.get("burndown")!.undo());

describe("Burndown undo", () => {
  it("restores a removed day once, whichever undo runs first", () => {
    render(<BurndownClient />);
    fireEvent.change(remainingOn(3), { target: { value: "30" } });

    // Toast Undo, then Ctrl+Z: one day 3, with its value.
    fireEvent.click(removeButtons(3)[0]);
    expect(removeButtons(3)).toHaveLength(0);
    expect(undo.last?.label).toBe("Removed day 3");
    act(() => undo.last!.revert());
    expect(removeButtons(3)).toHaveLength(1);
    expect(remainingOn(3).value).toBe("30");
    ctrlZ();
    expect(removeButtons(3)).toHaveLength(1);
    expect(remainingOn(3).value).toBe("30");

    // Ctrl+Z, then toast Undo: still exactly one day 4.
    fireEvent.click(removeButtons(4)[0]);
    expect(removeButtons(4)).toHaveLength(0);
    ctrlZ();
    expect(removeButtons(4)).toHaveLength(1);
    act(() => undo.last!.revert());
    expect(removeButtons(4)).toHaveLength(1);
  });

  it("confirms Reset with the logged-day count, and Undo restores them", () => {
    render(<BurndownClient />);
    // The store is module-level: clear what the previous test logged.
    screen
      .getAllByRole("spinbutton", { name: /^Remaining points on day [1-9]/ })
      .forEach((input) => fireEvent.change(input, { target: { value: "" } }));
    fireEvent.change(remainingOn(1), { target: { value: "35" } });
    fireEvent.change(remainingOn(2), { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset the burndown?");
    expect(dialog).toHaveTextContent("The 2 logged days are cleared");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset burndown" }));
    expect(remainingOn(1).value).toBe("");

    act(() => undo.last!.revert());
    expect(remainingOn(1).value).toBe("35");
    expect(remainingOn(2).value).toBe("31");
  });
});

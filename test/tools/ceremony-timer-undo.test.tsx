import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Ceremony Timer: removing a rotation participant offers Undo that puts
 * them back in their speaking slot, once.
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
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";

const participants = () =>
  screen.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"));

describe("Ceremony Timer undo", () => {
  it("puts a removed participant back in their slot", () => {
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("switch", { name: "Rotation mode" }));
    const nameInput = screen.getByRole("textbox", { name: "Participant name" });
    for (const name of ["Ann", "Bo", "Cy"]) {
      fireEvent.change(nameInput, { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    }
    expect(participants()).toEqual(["Remove Ann", "Remove Bo", "Remove Cy"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Bo" }));
    expect(participants()).toEqual(["Remove Ann", "Remove Cy"]);
    expect(undo.last?.label).toBe("Removed “Bo”");

    act(() => undo.last!.revert());
    expect(participants()).toEqual(["Remove Ann", "Remove Bo", "Remove Cy"]);
    act(() => undo.last!.revert());
    expect(participants()).toEqual(["Remove Ann", "Remove Bo", "Remove Cy"]);
  });
});

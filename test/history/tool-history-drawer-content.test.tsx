import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "@/components/ui/sheet";
import type { HistoryEvent } from "@/lib/history/types";

const event: HistoryEvent = {
  id: "e1",
  clientEventId: "ce1",
  clientId: "c1",
  toolRunId: "r1",
  userId: null,
  toolId: "retro",
  action: "card.add",
  payload: { title: "Ship it" },
  isMilestone: false,
  occurredAt: new Date().toISOString(),
  syncedAt: null,
};

vi.mock("@/lib/history/use-history", () => ({
  useHistory: () => ({ events: [event], total: 1 }),
}));
vi.mock("@/lib/stores/use-time-travel", () => ({
  useTimeTravel: () => ({
    controls: { pastLength: () => 1, undo: () => true },
    canUndo: true,
    canRedo: false,
    available: true,
  }),
}));
vi.mock("@/lib/auth/use-is-owner", () => ({
  useOwnerState: () => ({ isOwner: true, settled: true }),
}));

import ToolHistoryDrawerContent from "@/components/history/tool-history-drawer-content";

describe("ToolHistoryDrawerContent", () => {
  it("expands an event as a disclosure whose Restore button is not nested in it", () => {
    render(
      <Sheet open>
        <ToolHistoryDrawerContent toolId="retro" onClose={() => {}} />
      </Sheet>
    );
    const row = screen.getByRole("button", { expanded: false });
    expect(screen.queryByRole("button", { name: /Restore to here/ })).toBeNull();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const restore = screen.getByRole("button", { name: /Restore to here/ });
    expect(row.contains(restore)).toBe(false);
    expect(row).toHaveAttribute("aria-controls", restore.parentElement?.id);
  });
});

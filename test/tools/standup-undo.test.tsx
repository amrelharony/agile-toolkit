import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Standup: removing a team member offers Undo, and the confirmed
 * "Clear Entries" wipe can be undone too.
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

import { StandupClient } from "@/app/(tools)/standup/standup-client";

function entry(id: string, member: string, date = todayLocalISO()): StandupEntry {
  return { id, member, date, yesterday: "y", today: "t", blockers: "", timestamp: Date.now() };
}

const entries = () => useWorkspaceStore.getState().standupEntries ?? [];

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    teamMembers: [
      { id: "m1", name: "Alice" },
      { id: "m2", name: "Bo" },
    ],
    standupEntries: [],
  });
});

describe("Standup member remove", () => {
  it("removes the member and Undo puts them back on the roster", () => {
    render(<StandupClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Alice" }));

    expect(useWorkspaceStore.getState().teamMembers.map((m) => m.id)).toEqual(["m2"]);
    expect(screen.queryByRole("button", { name: "Remove Alice" })).toBeNull();
    expect(undo.last!.label).toBe("Removed “Alice”");

    act(() => undo.last!.revert());
    expect(useWorkspaceStore.getState().teamMembers).toContainEqual({ id: "m1", name: "Alice" });
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeInTheDocument();
  });
});

describe("Standup Clear Entries undo", () => {
  it("restores every cleared entry, keeping one posted since for the same day", () => {
    useWorkspaceStore.setState({
      standupEntries: [entry("e1", "Alice"), entry("e2", "Bo"), entry("e3", "Bo", "2026-01-05")],
    });
    render(<StandupClient />);
    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete all 3 standup entries?");
    fireEvent.click(screen.getByRole("button", { name: "Delete entries" }));

    expect(entries()).toHaveLength(0);
    expect(undo.last!.label).toBe("Deleted 3 standup entries");

    // Bo posts again before Undo: the new entry wins over the restored one.
    act(() => {
      useWorkspaceStore.setState({ standupEntries: [entry("e4", "Bo")] });
    });
    act(() => undo.last!.revert());
    expect(
      entries()
        .map((e) => e.id)
        .sort()
    ).toEqual(["e1", "e3", "e4"]);
  });
});

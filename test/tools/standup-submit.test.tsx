import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Standup: Submit never silently does nothing (it's disabled and says why),
 * and "Clear Entries" asks before deleting every day's entries.
 */

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

beforeEach(() => {
  useWorkspaceStore.setState({
    teamMembers: [{ id: "m1", name: "Alice" }],
    standupEntries: [],
  });
});

const submitButton = () => screen.getByRole("button", { name: "Submit Standup" });

describe("Standup submit", () => {
  it("is disabled with a reason while no member is picked, even with a roster", () => {
    render(<StandupClient />);
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription("Pick a team member or type a name.");
  });

  it("stays disabled until at least one field has content", () => {
    render(<StandupClient />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Alice" } });
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription(
      "Add at least one update: yesterday, today or a blocker."
    );

    fireEvent.change(screen.getByPlaceholderText("What will you work on today?"), {
      target: { value: "Ship the fix" },
    });
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).not.toHaveAttribute("aria-describedby");

    fireEvent.click(submitButton());
    const saved = useWorkspaceStore.getState().standupEntries ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ member: "Alice", today: "Ship the fix" });
  });

  it("asks before replacing a member's entry for today", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("e1", "Alice")] });
    render(<StandupClient />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByPlaceholderText("What will you work on today?"), {
      target: { value: "New plan" },
    });
    fireEvent.click(submitButton());

    expect(screen.getByRole("dialog")).toHaveTextContent("Replace Alice's standup?");
    expect(useWorkspaceStore.getState().standupEntries?.[0].today).toBe("t");

    fireEvent.click(screen.getByRole("button", { name: "Replace entry" }));
    const saved = useWorkspaceStore.getState().standupEntries ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "e1", today: "New plan" });
  });
});

describe("Standup Clear Entries", () => {
  it("confirms with the entry count before deleting", () => {
    useWorkspaceStore.setState({
      standupEntries: [entry("e1", "Alice"), entry("e2", "Alice", "2026-01-05")],
    });
    render(<StandupClient />);
    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Delete all 2 standup entries?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useWorkspaceStore.getState().standupEntries).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete entries" }));
    expect(useWorkspaceStore.getState().standupEntries).toHaveLength(0);
  });

  it("skips the dialog when there is nothing to delete", () => {
    render(<StandupClient />);
    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

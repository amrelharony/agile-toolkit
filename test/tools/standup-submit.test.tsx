import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Standup: Submit never silently does nothing (it says what's missing,
 * inline, and saves nothing), and "Clear Entries" asks before deleting
 * every day's entries.
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
const memberInput = () => screen.getByLabelText(/^Team member/);
const renderStandup = () =>
  render(
    <TooltipProvider>
      <StandupClient />
    </TooltipProvider>
  );

describe("Standup submit", () => {
  it("says who is missing instead of posting under nobody, even with a roster", () => {
    renderStandup();
    fireEvent.click(submitButton());
    expect(screen.getByText("Pick a team member or type a name.")).toBeInTheDocument();
    expect(memberInput()).toHaveAttribute("aria-invalid", "true");
    expect(memberInput()).toHaveFocus();
    expect(useWorkspaceStore.getState().standupEntries).toEqual([]);
  });

  it("needs today's plan, then posts", () => {
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Alice" } });
    fireEvent.click(submitButton());
    expect(screen.getByText("Say what's planned for today.")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().standupEntries).toEqual([]);

    fireEvent.change(screen.getByPlaceholderText("What will you work on today?"), {
      target: { value: "Ship the fix" },
    });
    expect(screen.queryByText("Say what's planned for today.")).toBeNull();

    fireEvent.click(submitButton());
    const saved = useWorkspaceStore.getState().standupEntries ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ member: "Alice", today: "Ship the fix", mode: "live" });
  });

  it("asks before replacing a member's entry for today", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("e1", "Alice")] });
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Alice" } });
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
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Delete all 2 standup entries?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useWorkspaceStore.getState().standupEntries).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete entries" }));
    expect(useWorkspaceStore.getState().standupEntries).toHaveLength(0);
  });

  it("skips the dialog when there is nothing to delete", () => {
    renderStandup();
    expect(screen.getByRole("button", { name: "Clear Entries" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

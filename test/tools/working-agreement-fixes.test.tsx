import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Working Agreement: once a rule was checked in, its status only flipped
 * between Working and Not working, so a new check-in round could never start
 * from "Check in". Each rule's mark can now go back to "Not checked", and
 * "Clear the marks" resets every one of them, with Undo. (Saving a round
 * clears them too, and keeps the round: see working-agreement-upgrade.)
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
  removeWithUndo: () => undefined,
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
vi.mock("@/app/(tools)/working-agreement/charts", () => ({ AdherenceChart: () => null }));

import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

const rule = (id: string, text: string, stillWorking?: boolean) => ({
  id,
  category: "work" as const,
  text,
  agreedBy: [],
  stillWorking,
});

const statuses = () =>
  (useWorkspaceStore.getState().workingAgreements ?? [])[0].rules.map((r) => r.stillWorking);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    teamMembers: [],
    sprints: [],
    retroBoards: [],
    workingAgreements: [
      {
        id: "workingAgreement:current",
        rules: [
          rule("r1", "PRs reviewed within a day", true),
          rule("r2", "No meetings on Friday", false),
          rule("r3", "Pair on hard bugs"),
        ],
        meta: { version: 1 },
      },
    ],
  });
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <WorkingAgreementClient />
    </TooltipProvider>
  );

describe("Working Agreement check-in rounds", () => {
  it("resets every mark to Not checked, with Undo", () => {
    renderPage();
    expect(screen.getByText("2 of 3 rules marked in this round.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear the marks" }));
    expect(statuses()).toEqual([undefined, undefined, undefined]);
    expect(undo.last?.label).toBe("Cleared this round's marks");
    expect(screen.getByText("0 of 3 rules marked in this round.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear the marks" })).toBeDisabled();

    act(() => undo.last!.revert());
    expect(statuses()).toEqual([true, false, undefined]);
  });

  it("lets one rule's mark go back to Not checked", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", {
      name: "This round: “PRs reviewed within a day”",
    });
    fireEvent.click(within(group).getByRole("radio", { name: "Not checked" }));
    expect(statuses()).toEqual([undefined, false, undefined]);
  });
});

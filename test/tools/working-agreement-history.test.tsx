import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Working Agreement: saving and deleting a check-in round are logged under
 * WORKING_AGREEMENT_ACTIONS, with the strings the page logged before they
 * moved there, so earlier history entries still read the same.
 */

const logs = vi.hoisted(() => [] as { action: string; data: unknown }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string, data: unknown) => logs.push({ action, data }) }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/app/(tools)/working-agreement/charts", () => ({ AdherenceChart: () => null }));

import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ADKAR_ACTIONS, WORKING_AGREEMENT_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WorkingAgreement } from "@/lib/stores/workspace-types";
import { emptyAgreement } from "@/lib/working-agreement/model";
import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

beforeEach(() => {
  logs.length = 0;
  useWorkspaceStore.setState({
    workingAgreements: [
      {
        ...emptyAgreement(),
        meta: { version: 1, publishedAt: "2026-09-12T10:00:00.000Z" },
        rules: [{ id: "r1", category: "work", text: "One", agreedBy: [] }],
      } as WorkingAgreement,
    ],
    teamMembers: [],
    sprints: [],
    retroBoards: [],
  });
});

describe("Working Agreement check-in history", () => {
  it("keeps the strings the pages logged", () => {
    expect(WORKING_AGREEMENT_ACTIONS.CHECK_IN_SAVED).toBe("check_in_saved");
    expect(WORKING_AGREEMENT_ACTIONS.CHECK_IN_REMOVED).toBe("check_in_removed");
    expect(ADKAR_ACTIONS.STAGE_STEPPED_BACK).toBe("stage_stepped_back");
  });

  it("logs a saved round and a deleted one", () => {
    render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <WorkingAgreementClient />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );
    const one = screen.getByRole("radiogroup", { name: "This round: “One”" });
    fireEvent.click(within(one).getByRole("radio", { name: "Working" }));
    fireEvent.click(screen.getByRole("button", { name: "Save check-in round" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete the check-in of/ }));
    expect(logs.map((l) => l.action)).toEqual(["check_in_saved", "check_in_removed"]);
    expect(logs[0].data).toMatchObject({ rules: 1 });
  });
});

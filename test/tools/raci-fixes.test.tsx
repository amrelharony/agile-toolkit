import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * RACI: validation flags an activity with no Responsible (R), not only one
 * without exactly one Accountable (A). The matrix is a workspace document
 * now (it used to be a local zustand store, which raci-upgrade covers the
 * move of), so it is seeded there.
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

import { RACIClient } from "@/app/(tools)/raci/raci-client";

beforeEach(() => {
  useWorkspaceStore.setState({
    teamMembers: [],
    raciMatrices: [
      {
        id: "raciMatrix:current",
        roles: [
          { id: "po", name: "Product Owner" },
          { id: "dev", name: "Dev Team" },
        ],
        activities: [
          { id: "ship", name: "Ship release" },
          { id: "plan", name: "Plan sprint" },
        ],
        cells: {
          ship: { po: ["A"], dev: ["C"] }, // an A but nobody does the work
          plan: { po: ["A"], dev: ["R"] }, // fine
        },
      },
    ],
  });
});

describe("RACI validation", () => {
  it("flags an activity that has an A but no R", () => {
    render(
      <TooltipProvider>
        <RACIClient />
      </TooltipProvider>
    );
    expect(screen.getByText("Checks: 1 to look at")).toBeInTheDocument();
    expect(
      screen.getByText("“Ship release” has no Responsible (R): someone has to do the work.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/“Plan sprint” has no/)).toBeNull();
  });
});

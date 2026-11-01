import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Assumption, RiskiestAssumption } from "@/lib/stores/workspace-types";

/**
 * Riskiest Assumption: an assumption an agent created without ratings is
 * "Not rated" on the page (absent = not rated, never ranked or placed). An
 * edit anywhere on the page saves the canvas, and the unrated assumption
 * keeps its absent ratings; only a rating the user picks is saved.
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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { RiskiestAssumptionClient } from "@/app/(tools)/riskiest-assumption/riskiest-assumption-client";

const RA_ID = "riskiestAssumption:current";

const UNRATED: Assumption = {
  id: "as_agent",
  statement: "Admins want SSO on day one",
  status: "untested",
  sentTo: [{ route: "hypothesis", targetId: "hyp_1", at: "2026-10-22T09:00:00.000Z" }],
};
const RATED: Assumption = {
  id: "as_rated",
  statement: "Users read the changelog",
  riskLevel: 5,
  evidenceLevel: 1,
  status: "untested",
};

const stored = (id: string) =>
  (useWorkspaceStore.getState().riskiestAssumptions ?? [])
    .find((d) => d.id === RA_ID)
    ?.assumptions.find((a) => a.id === id);

const renderPage = () =>
  render(
    <TooltipProvider>
      <RiskiestAssumptionClient />
    </TooltipProvider>
  );
const addAnother = (statement: string) => {
  const input = screen
    .getAllByLabelText(/^Assumption/)
    .find((el) => (el as HTMLInputElement).value === "")!;
  fireEvent.change(input, { target: { value: statement } });
  fireEvent.click(screen.getByRole("button", { name: "Add assumption" }));
};

beforeEach(() => {
  const doc: RiskiestAssumption = { id: RA_ID, assumptions: [UNRATED, RATED] };
  useWorkspaceStore.setState({ riskiestAssumptions: [doc] });
});

describe("an unrated assumption on the page", () => {
  it("keeps its absent ratings when another assumption is added", () => {
    renderPage();
    addAnother("Teams pay for a second seat");

    const list = useWorkspaceStore.getState().riskiestAssumptions?.[0]?.assumptions ?? [];
    expect(list).toHaveLength(3);
    expect(stored("as_agent")).toEqual(UNRATED);
    expect(stored("as_rated")).toEqual(RATED);
  });

  it("saves the one rating the user changes, and only that one", () => {
    renderPage();
    // The unrated one waits under "Not rated"; rating its risk alone keeps it there.
    const card = screen.getByRole("article", { name: UNRATED.statement });
    expect(within(card).getByText("Not rated", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(
      within(within(card).getByRole("radiogroup", { name: "Risk" })).getByRole("radio", {
        name: "4",
      })
    );

    expect(stored("as_agent")).toEqual({ ...UNRATED, riskLevel: 4 });
    expect(stored("as_agent")).not.toHaveProperty("evidenceLevel");
    expect(stored("as_rated")).toEqual(RATED);
  });

  it("a rated assumption at 3 stays at 3", () => {
    const three: Assumption = { ...RATED, riskLevel: 3, evidenceLevel: 3 };
    useWorkspaceStore.setState({
      riskiestAssumptions: [{ id: RA_ID, assumptions: [UNRATED, three] }],
    });
    renderPage();
    addAnother("Another");
    expect(stored("as_rated")).toEqual(three);
    expect(stored("as_agent")).toEqual(UNRATED);
  });
});

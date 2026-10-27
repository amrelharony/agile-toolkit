import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Assumption, RiskiestAssumption } from "@/lib/stores/workspace-types";

/**
 * Riskiest Assumption, until the Phase 8 page shows "Not rated": an
 * assumption an agent created without ratings reads as 3/3 on the page, but
 * that is display only. An edit anywhere on the page saves the canvas, and
 * the unrated assumption keeps its absent ratings (absent = not rated, never
 * ranked or placed); only a rating the user changes is saved.
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

beforeEach(() => {
  const doc: RiskiestAssumption = { id: RA_ID, assumptions: [UNRATED, RATED] };
  useWorkspaceStore.setState({ riskiestAssumptions: [doc] });
});

describe("an unrated assumption on today's page", () => {
  it("keeps its absent ratings when another assumption is added", () => {
    render(<RiskiestAssumptionClient />);
    fireEvent.change(screen.getByLabelText("Assumption statement"), {
      target: { value: "Teams pay for a second seat" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add assumption/ }));

    const list = useWorkspaceStore.getState().riskiestAssumptions?.[0]?.assumptions ?? [];
    expect(list).toHaveLength(3);
    expect(stored("as_agent")).toEqual(UNRATED);
    expect(stored("as_rated")).toEqual(RATED);
  });

  it("saves the one rating the user changes, and only that one", () => {
    render(<RiskiestAssumptionClient />);
    // Ranked by risk × (6 − evidence): the rated one (25) first, the unrated (3×3 = 9) second.
    const risk = screen.getByLabelText("Risk for assumption #2");
    fireEvent.change(risk, { target: { value: "4" } });
    fireEvent.blur(risk);

    expect(stored("as_agent")).toEqual({ ...UNRATED, riskLevel: 4 });
    expect(stored("as_agent")).not.toHaveProperty("evidenceLevel");
    expect(stored("as_rated")).toEqual(RATED);
  });

  it("a rated assumption at 3 stays at 3", () => {
    const three: Assumption = { ...RATED, riskLevel: 3, evidenceLevel: 3 };
    useWorkspaceStore.setState({
      riskiestAssumptions: [{ id: RA_ID, assumptions: [UNRATED, three] }],
    });
    render(<RiskiestAssumptionClient />);
    fireEvent.change(screen.getByLabelText("Assumption statement"), {
      target: { value: "Another" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add assumption/ }));
    expect(stored("as_rated")).toEqual(three);
    expect(stored("as_agent")).toEqual(UNRATED);
  });
});

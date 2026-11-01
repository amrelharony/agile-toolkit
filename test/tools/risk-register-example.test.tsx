import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Risk Register: "Load an example" fills an empty register, "Clear
 * example" removes only the example risks, and the register exports as
 * Markdown. The register lives in workspace.risks since Phase 8.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
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
vi.mock("@/app/(tools)/risk-register/charts", () => ({ OpenRisksChart: () => null }));

import { RiskRegisterClient } from "@/app/(tools)/risk-register/risk-register-client";
import { buildExample } from "@/app/(tools)/risk-register/example";
import { toMarkdown } from "@/app/(tools)/risk-register/markdown";

const NOW = new Date(2026, 9, 18);
const stored = () => useWorkspaceStore.getState().risks;
const notice = () => screen.queryByText("Example data.");
const renderPage = () =>
  render(
    <TooltipProvider>
      <RiskRegisterClient />
    </TooltipProvider>
  );

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ risks: [], whiteboardObjects: [], impediments: [] });
});

describe("Risk Register Markdown", () => {
  it("lists the risks in the register's order: active first, then by score", () => {
    const md = toMarkdown(buildExample(NOW), NOW);
    expect(md).toMatch(/^# Risk Register — 18 Oct 2026\n/);
    expect(md).toContain("8 risks: 2 open, 2 mitigating, 1 accepted, 3 closed.");
    expect(md).toContain("## Risks in order");
    expect(md).toContain(
      "| # | Risk | Owner | P × I | Score | After mitigation | Status | Mitigation | Due | Impediment |"
    );
    expect(md).toContain(
      "| 1 | Payment provider sandbox outages block wallet testing | Priya | 4 × 4 | 16 (critical) | 2 × 3 = 6 | Open | Record provider responses"
    );
    expect(md).toContain("weekly call. | 2026-10-15 (3 days overdue) |  |");
    expect(md).toContain(
      "| 2 | Only one developer knows the checkout service | Sam | 3 × 5 | 15 (high) | 2 × 4 = 8 | Mitigating |"
    );
    // Closed and accepted risks come after every active one.
    expect(md).toContain(
      "| 5 | Flaky login test hides real failures | Lee | 4 × 2 | 8 (medium) | Not assessed | Closed |"
    );
    expect(md).toContain(
      "| 7 | Analytics update breaks checkout funnel events | Lee | 1 × 3 | 3 (low) | Not assessed | Closed |"
    );
    expect(md).toContain(
      "| 8 | Design tokens drift between the web and app checkouts | Sam | 2 × 1 | 2 (low) | Not assessed | Closed |"
    );
  });

  it("escapes pipes and collapses newlines in cells", () => {
    const md = toMarkdown(
      [
        {
          id: "r1",
          title: "Vendor | lock-in",
          probability: 2,
          impact: 3,
          status: "open",
          raisedAt: "2026-10-01",
          mitigation: "Abstract the API\nbehind a port",
        },
      ],
      NOW
    );
    expect(md).toContain(
      "| 1 | Vendor \\| lock-in |  | 2 × 3 | 6 (medium) | Not assessed | Open | Abstract the API behind a port |  |  |"
    );
  });

  it("says no risks are logged on an empty register", () => {
    expect(toMarkdown([], NOW)).toBe("# Risk Register — 18 Oct 2026\n\nNo risks logged yet.\n");
  });
});

describe("Risk Register example", () => {
  it("loads into an empty register and clears only the example risks", () => {
    renderPage();
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(notice()).toBeInTheDocument();
    expect(stored()).toHaveLength(8);
    expect(stored().every((r) => r.id.startsWith("example-"))).toBe(true);
    expect(
      screen.getByRole("button", { name: "Delete Only one developer knows the checkout service" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    // The user logs a risk of their own.
    fireEvent.click(screen.getByRole("button", { name: "New risk" }));
    const title = screen.getByRole("textbox", { name: "Risk" });
    fireEvent.change(title, { target: { value: "Vendor lock-in" } });
    const form = title.closest("form") as HTMLElement;
    for (const group of ["Likelihood", "Impact"]) {
      const radios = screen
        .getAllByRole("radiogroup", { name: group })
        .find((g) => form.contains(g))!;
      fireEvent.click(radios.querySelector('[role="radio"]')!);
    }
    fireEvent.submit(form);
    const mine = stored().find((r) => !r.id.startsWith("example-"))!;
    expect(mine.title).toBe("Vendor lock-in");

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((r) => r.id)).toEqual([mine.id]);
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("doesn't offer the example once the register has the user's risks", () => {
    useWorkspaceStore.setState({
      risks: [
        {
          id: "r1",
          title: "Vendor lock-in",
          probability: 3,
          impact: 3,
          status: "open",
          raisedAt: "2026-10-01",
        },
      ],
    });
    renderPage();
    expect(screen.getByRole("button", { name: "Delete Vendor lock-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(notice()).toBeNull();
  });
});

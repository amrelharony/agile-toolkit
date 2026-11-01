import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";

/**
 * Premortem: a cause can be added to the Risk Register. Its likelihood,
 * impact, preventive action and owner become the risk's probability,
 * impact, mitigation and owner; the risk lands in workspace.risks only (the
 * register's one store since Phase 8: the old blob is never written); the
 * cause records the link, and Undo removes both. A cause that isn't rated
 * can't be sent: the route refuses an unrated risk rather than score it.
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

import { PremortemClient } from "@/app/(tools)/premortem/premortem-client";
import type { PremortemCause, PremortemState } from "@/app/(tools)/premortem/model";

const PREMORTEM_KEY = "agile-toolkit:premortem";
const RISK_KEY = "agile-toolkit:risk-register";

const causes = (): PremortemCause[] =>
  (JSON.parse(localStorage.getItem(PREMORTEM_KEY) ?? "{}") as PremortemState).premortems[0].causes;
const riskBlob = (): Risk[] => JSON.parse(localStorage.getItem(RISK_KEY) ?? "[]");
const risks = () => useWorkspaceStore.getState().risks;

function openSendTo(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

const renderPremortem = () =>
  render(
    <TooltipProvider>
      <PremortemClient />
    </TooltipProvider>
  );

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  window.history.replaceState(null, "", "/premortem");
  useWorkspaceStore.setState({ risks: [] });
  // The single premortem stored before the upgrade: it opens in the Act phase.
  localStorage.setItem(
    PREMORTEM_KEY,
    JSON.stringify({
      scenario: "The launch slipped a quarter",
      causes: [
        {
          id: "c1",
          text: "Payment provider certification took too long",
          likelihood: 4,
          impact: 5,
          preventiveAction: "Start certification in sprint 1",
          owner: "Priya",
        },
      ],
    })
  );
});

describe("Premortem Send to", () => {
  it("can't send a cause until both ratings are given", () => {
    localStorage.setItem(
      PREMORTEM_KEY,
      JSON.stringify({
        version: 2,
        premortems: [
          {
            id: "p1",
            title: "Launch",
            scenario: "It slipped",
            phase: "act",
            createdAt: "2026-10-01T00:00:00.000Z",
            causes: [{ id: "c2", text: "Nobody tested on old phones", likelihood: 3 }],
          },
        ],
      })
    );
    renderPremortem();
    expect(screen.getByRole("button", { name: /^Send to… Nobody tested/ })).toBeDisabled();
  });

  it("adds the cause to the Risk Register, linked both ways", () => {
    renderPremortem();
    openSendTo(/^Send to… Payment provider/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Risk" }));

    const [risk] = risks();
    expect(risk).toMatchObject({
      title: "Payment provider certification took too long",
      probability: 4,
      impact: 5,
      mitigation: "Start certification in sprint 1",
      owner: "Priya",
      status: "open",
      sourceRef: { tool: "premortem", id: "c1", doc: "legacy-premortem" },
      updatedAt: expect.any(String),
    });
    // One store: the register's old blob isn't written.
    expect(localStorage.getItem(RISK_KEY)).toBeNull();
    expect(causes()[0].sentTo).toEqual([
      { route: "risk", targetId: risk.id, at: expect.any(String) },
    ]);
    expect(undo.last!.label).toBe("Added to the Risk Register");

    openSendTo(/^Send to… Payment provider.*\(sent\)/);
    expect(screen.getByRole("menuitem", { name: /Risk.*Sent · Open/ })).toHaveAttribute(
      "href",
      "/risk-register"
    );
  });

  it("Undo removes the risk and the link, and leaves the old blob as it was", () => {
    localStorage.setItem(RISK_KEY, JSON.stringify([{ id: "r0", title: "Existing" }]));
    renderPremortem();
    openSendTo(/^Send to… Payment provider/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Risk" }));
    expect(risks()).toHaveLength(1);
    expect(riskBlob()).toEqual([{ id: "r0", title: "Existing" }]);

    act(() => undo.last!.revert());
    expect(riskBlob()).toEqual([{ id: "r0", title: "Existing" }]);
    expect(risks()).toEqual([]);
    expect(causes()[0].sentTo).toEqual([]);
  });
});

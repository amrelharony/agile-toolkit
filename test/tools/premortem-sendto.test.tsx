import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";

/**
 * Premortem: a cause can be added to the Risk Register. Its likelihood,
 * impact and preventive action become the risk's probability, impact and
 * mitigation; the register's blob and workspace.risks get the same row; the
 * cause records the link, and Undo removes both.
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

const PREMORTEM_KEY = "agile-toolkit:premortem";
const RISK_KEY = "agile-toolkit:risk-register";

interface StoredCause {
  id: string;
  text: string;
  sentTo?: { route: string; targetId: string; at: string }[];
}

const causes = (): StoredCause[] =>
  JSON.parse(localStorage.getItem(PREMORTEM_KEY) ?? "{}").causes ?? [];
const riskBlob = (): Risk[] => JSON.parse(localStorage.getItem(RISK_KEY) ?? "[]");

function openSendTo(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({ risks: [] });
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
        { id: "c2", text: "", likelihood: 3, impact: 3 },
      ],
    })
  );
});

describe("Premortem Send to", () => {
  it("can't send a cause with no text", () => {
    render(<PremortemClient />);
    const buttons = screen.getAllByRole("button", { name: /^Send to…/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toBeDisabled();
  });

  it("adds the cause to the Risk Register, linked both ways", () => {
    render(<PremortemClient />);
    openSendTo(/^Send to… Payment provider/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Risk" }));

    const [risk] = riskBlob();
    expect(risk).toMatchObject({
      title: "Payment provider certification took too long",
      probability: 4,
      impact: 5,
      mitigation: "Start certification in sprint 1",
      status: "open",
      sourceRef: { tool: "premortem", id: "c1" },
    });
    // The same row, under the same id, for dashboards and agents.
    expect(useWorkspaceStore.getState().risks).toEqual([risk]);
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

  it("Undo removes the risk from both places and the link", () => {
    localStorage.setItem(RISK_KEY, JSON.stringify([{ id: "r0", title: "Existing" }]));
    render(<PremortemClient />);
    openSendTo(/^Send to… Payment provider/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Risk" }));
    expect(riskBlob()).toHaveLength(2);

    act(() => undo.last!.revert());
    expect(riskBlob()).toEqual([{ id: "r0", title: "Existing" }]);
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(causes()[0].sentTo).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Risk Register: removing a risk offers Undo that puts it back, once.
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
vi.mock("@/components/shared/workspace-sync-button", () => ({
  WorkspaceSyncButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { RiskRegisterClient } from "@/app/(tools)/risk-register/risk-register-client";

const KEY = "agile-toolkit:risk-register";
const risk = (id: string, title: string, probability: number) => ({
  id,
  title,
  probability,
  impact: 3,
  status: "open",
  raisedAt: "2026-10-01",
  mitigation: `Plan for ${title}`,
});

beforeEach(() => {
  undo.last = null;
  localStorage.setItem(
    KEY,
    JSON.stringify([risk("r1", "Vendor lock-in", 4), risk("r2", "Key person leaves", 2)])
  );
});

const stored = () =>
  (JSON.parse(localStorage.getItem(KEY) ?? "[]") as { id: string }[]).map((r) => r.id);

describe("Risk Register undo", () => {
  it("puts a removed risk back where it was", () => {
    render(<RiskRegisterClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Vendor lock-in" }));

    expect(screen.queryByRole("button", { name: "Remove Vendor lock-in" })).toBeNull();
    expect(undo.last?.label).toBe("Removed “Vendor lock-in”");
    expect(stored()).toEqual(["r2"]);

    act(() => undo.last!.revert());
    expect(screen.getByRole("button", { name: "Remove Vendor lock-in" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Mitigation plan for Vendor lock-in" })).toHaveValue(
      "Plan for Vendor lock-in"
    );
    expect(stored()).toEqual(["r1", "r2"]);

    // A second revert can't duplicate it.
    act(() => undo.last!.revert());
    expect(screen.getAllByRole("button", { name: "Remove Vendor lock-in" })).toHaveLength(1);
  });
});

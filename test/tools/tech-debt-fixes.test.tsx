import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Tech debt:
 * - Nothing set `resolvedAt`, so "Open Items" counted every item and the
 *   resolution survival curve never had data. "Mark resolved" (with Undo)
 *   sets it, and Open Items counts only unresolved items.
 * - The score in each row had no label.
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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { TechDebtClient } from "@/app/(tools)/tech-debt/tech-debt-client";

const KEY = "agile-toolkit:tech-debt";
const item = (id: string, title: string, impact: number) => ({
  id,
  title,
  impact,
  effort: 2,
  interestRate: 0,
  raisedAt: "2026-09-01",
});
const stored = () =>
  JSON.parse(localStorage.getItem(KEY) ?? "[]") as { id: string; resolvedAt?: string }[];
const openItems = () => screen.getByText("Open Items").parentElement!.nextElementSibling!;

beforeEach(() => {
  undo.last = null;
  localStorage.setItem(
    KEY,
    JSON.stringify([item("d1", "Flaky deploy script", 5), item("d2", "Old ORM", 2)])
  );
});

describe("Tech debt resolve", () => {
  it("marks an item resolved, drops it from Open Items, and can be undone", () => {
    render(<TechDebtClient />);
    expect(openItems()).toHaveTextContent(/^2$/);

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved: Flaky deploy script" }));
    expect(undo.last?.label).toBe("Resolved “Flaky deploy script”");
    expect(stored().find((i) => i.id === "d1")?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(openItems()).toHaveTextContent(/^1$/);
    expect(screen.getByText(/^Resolved \d{4}-\d{2}-\d{2}$/)).toBeInTheDocument();
    // Resolved items sink below open ones and can be reopened.
    const removeButtons = screen.getAllByRole("button", { name: /^Remove debt item/ });
    expect(removeButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove debt item: Old ORM",
      "Remove debt item: Flaky deploy script",
    ]);
    expect(
      screen.getByRole("button", { name: "Reopen debt item: Flaky deploy script" })
    ).toBeInTheDocument();

    act(() => undo.last!.revert());
    expect(stored().find((i) => i.id === "d1")?.resolvedAt).toBeUndefined();
    expect(openItems()).toHaveTextContent(/^2$/);
    expect(
      screen.getByRole("button", { name: "Mark resolved: Flaky deploy script" })
    ).toBeInTheDocument();
  });

  it("labels the score in every row", () => {
    render(<TechDebtClient />);
    expect(screen.getAllByText("Score")).toHaveLength(2);
  });
});

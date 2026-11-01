import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * $100 Test: an amount above what's left used to drop silently to the
 * remaining amount. It's still capped, but a note under the item says so.
 * Amounts are whole dollars and save when the box is left, so each typed
 * amount is committed with a blur.
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

import { TooltipProvider } from "@/components/ui/tooltip";
import { HundredDollarTestClient } from "@/app/(tools)/hundred-dollar-test/hundred-dollar-test-client";

const item = (id: string, title: string, allocation: number): PrioritizationItem => ({
  id,
  framework: "hundred-dollar",
  title,
  score: allocation,
  fields: { allocation },
  status: "open",
  updatedAt: "2026-10-01T09:00:00.000Z",
});
const allocation = (id: string) =>
  (useWorkspaceStore.getState().prioritizations ?? []).find((x) => x.id === id)?.fields?.allocation;
const typeAmount = (title: string, value: string) => {
  const box = screen.getByLabelText(`Dollars allocated to ${title}`);
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
};
const renderPage = () =>
  render(
    <TooltipProvider>
      <HundredDollarTestClient />
    </TooltipProvider>
  );

beforeEach(() => {
  useWorkspaceStore.setState({
    prioritizations: [item("a", "Search", 70), item("b", "Exports", 0)],
  });
});

describe("$100 Test: capped amounts are explained", () => {
  it("caps an amount at what's left and says so next to the item", () => {
    renderPage();
    typeAmount("Exports", "50");

    expect(allocation("b")).toBe(30);
    const note = screen.getByRole("alert");
    expect(note).toHaveTextContent(
      "Only $30 was left, so Exports got $30, not $50. Lower another item first to move money here."
    );
    expect(screen.getByLabelText("Dollars allocated to Exports")).toHaveAttribute(
      "aria-describedby",
      note.id
    );
  });

  it("clears the note once an amount goes in as typed", () => {
    renderPage();
    typeAmount("Exports", "50");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    typeAmount("Exports", "20");
    expect(allocation("b")).toBe(20);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a negative amount set to $0", () => {
    renderPage();
    typeAmount("Exports", "-5");
    expect(allocation("b")).toBe(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Amounts can't be negative, so Exports is set to $0."
    );
  });
});

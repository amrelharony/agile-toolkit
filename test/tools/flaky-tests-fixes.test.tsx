import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Flaky tests: leaving the failure rate blank used to turn into "0" on blur
 * (`Number("") === 0`), which then saved the test at 0 %. Phase 8 replaced
 * the typed rate with failed runs out of runs; the same guarantee holds for
 * them: a blank count stays blank, is an inline error, and is never saved
 * as 0, and Tab moves on (no prediction traps it).
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

import { FlakyTestsClient } from "@/app/(tools)/flaky-tests/flaky-tests-client";

const renderPage = () =>
  render(
    <TooltipProvider>
      <FlakyTestsClient />
    </TooltipProvider>
  );
const tests = () => (useWorkspaceStore.getState().flakyTestBoards ?? [])[0]?.tests ?? [];

beforeEach(() => {
  useWorkspaceStore.setState({ flakyTestBoards: [] });
});

describe("Flaky tests run counts", () => {
  it("keeps blank counts blank on blur and never saves them as 0", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Test name/), { target: { value: "auth > signs in" } });
    const failures = screen.getByLabelText(/^Failed runs/);
    expect(failures).toHaveAttribute("aria-required", "true");
    fireEvent.blur(failures);
    expect(failures).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Add test" }));
    expect(await screen.findByText("Enter how many runs failed.")).toBeInTheDocument();
    expect(screen.getByText("Enter how many times it ran.")).toBeInTheDocument();
    expect(tests()).toEqual([]);
  });

  it("saves the typed counts", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Test name/), { target: { value: "auth > signs in" } });
    fireEvent.change(screen.getByLabelText(/^Failed runs/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/^Runs/), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add test" }));
    expect(tests()).toHaveLength(1);
    expect(tests()[0]).toMatchObject({ failures: 0, runs: 25, failureRate: 0 });
  });

  it("doesn't trap Tab in the count fields", () => {
    renderPage();
    const runs = screen.getByLabelText(/^Runs/);
    runs.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    runs.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
});

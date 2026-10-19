import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Flaky tests: leaving "Failure rate (%)" blank used to turn into "0" on
 * blur (`Number("") === 0`), which then saved the test at 0 %. The rate is
 * required: blank stays blank and Add stays locked.
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

const tests = () => (useWorkspaceStore.getState().flakyTestBoards ?? [])[0]?.tests ?? [];
const addButton = () => screen.getByRole("button", { name: /Add test/ });

beforeEach(() => {
  useWorkspaceStore.setState({ flakyTestBoards: [] });
});

describe("Flaky tests failure rate", () => {
  it("keeps a blank rate blank on blur and never saves it as 0 %", () => {
    render(<FlakyTestsClient />);
    fireEvent.change(screen.getByLabelText("Test name"), {
      target: { value: "auth > signs in" },
    });
    const rate = screen.getByLabelText(/Failure rate/);
    expect(rate).toHaveAttribute("aria-required", "true");
    expect(rate).toHaveAccessibleDescription(/Required/);

    fireEvent.focus(rate);
    fireEvent.blur(rate);
    expect(rate).toHaveValue("");
    expect(addButton()).toBeDisabled();
    fireEvent.click(addButton());
    expect(tests()).toHaveLength(0);
  });

  it("saves the rate the user typed", () => {
    render(<FlakyTestsClient />);
    fireEvent.change(screen.getByLabelText("Test name"), {
      target: { value: "auth > signs in" },
    });
    const rate = screen.getByLabelText(/Failure rate/);
    fireEvent.change(rate, { target: { value: "12.5" } });
    fireEvent.blur(rate);
    fireEvent.click(addButton());
    expect(tests()).toHaveLength(1);
    expect(tests()[0].failureRate).toBeCloseTo(0.125);
  });

  it("does not trap Tab in the empty rate field when there is no prediction", () => {
    render(<FlakyTestsClient />);
    const rate = screen.getByLabelText(/Failure rate/);
    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.keyDown(rate, { key: "Tab" })).toBe(true);
  });
});

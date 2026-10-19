import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * Sprint Comparison: the "New sprint available to pin" badge appeared after
 * a sprint was added in the Velocity tracker, but there's no pin action, so
 * it did nothing. It's gone.
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

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { SprintCompareClient } from "@/app/(tools)/sprint-compare/sprint-compare-client";
import { useHistoryStore } from "@/lib/history/history-store";

describe("Sprint Comparison", () => {
  it("shows no pin badge after a sprint is added in Velocity", () => {
    const event: HistoryEvent = {
      id: "e1",
      clientEventId: "e1",
      clientId: "c",
      toolRunId: "r",
      userId: null,
      toolId: "velocity",
      action: "sprint_added",
      payload: { name: "Sprint 9" },
      isMilestone: false,
      occurredAt: new Date().toISOString(),
      syncedAt: null,
    };
    useHistoryStore.setState({ events: [event] });

    render(<SprintCompareClient />);
    expect(screen.getByRole("button", { name: /New sprint/ })).toBeInTheDocument();
    expect(screen.queryByText(/available to pin/i)).not.toBeInTheDocument();
  });
});

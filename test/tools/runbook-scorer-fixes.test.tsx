import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Runbook scorer: Freshness was a manual slider with no link to "Last
 * reviewed". Setting the review date now derives Freshness from its age
 * (≤30 days = 5 … older than a year = 1) and says so; the slider still
 * overrides it.
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

import { RunbookScorerClient } from "@/app/(tools)/runbook-scorer/runbook-scorer-client";

const runbook = () => (useWorkspaceStore.getState().runbookScorers ?? [])[0]?.runbooks[0];

function setReviewed(date: string) {
  const input = screen.getByLabelText("Last reviewed");
  fireEvent.change(input, { target: { value: date } });
  fireEvent.blur(input);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 12));
  useWorkspaceStore.setState({
    runbookScorers: [
      {
        id: "runbookScorer:current",
        runbooks: [
          {
            id: "rb1",
            name: "DB failover",
            freshness: 3,
            completeness: 3,
            testedRecently: false,
          },
        ],
      },
    ] as never,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Runbook freshness from Last reviewed", () => {
  it("derives freshness from the review date's age", () => {
    render(<RunbookScorerClient />);
    expect(screen.getByText("Set Last reviewed to get a suggested freshness.")).toBeInTheDocument();

    setReviewed("2026-10-09"); // 10 days ago
    expect(runbook()?.lastReviewedAt).toBe("2026-10-09");
    expect(runbook()?.freshness).toBe(5);
    const slider = screen.getByRole("slider", { name: "Freshness for DB failover" });
    expect(slider).toHaveAccessibleDescription(
      "Suggested 5 from Last reviewed 10 days ago. Move the slider to override."
    );

    setReviewed("2026-06-01"); // 140 days ago
    expect(runbook()?.freshness).toBe(3);

    setReviewed("2025-01-15"); // over a year ago
    expect(runbook()?.freshness).toBe(1);
  });

  it("still lets the slider override the suggestion", () => {
    render(<RunbookScorerClient />);
    setReviewed("2026-10-09");
    const slider = screen.getByRole("slider", { name: "Freshness for DB failover" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(runbook()?.freshness).toBe(4);
    expect(runbook()?.lastReviewedAt).toBe("2026-10-09");
  });
});

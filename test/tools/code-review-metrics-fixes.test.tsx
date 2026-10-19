import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { metadata } from "@/app/(tools)/code-review-metrics/page";

/**
 * Code review metrics: the page promised "reviewer load", but the only
 * per-person chart is "Top PR authors by comments received" (comments are
 * logged per PR, so reviews given can't be measured). The description now
 * says what the chart shows.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children, description }: { children: ReactNode; description: string }) => (
    <div>
      <p data-testid="tool-description">{description}</p>
      {children}
    </div>
  ),
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

import { CodeReviewMetricsClient } from "@/app/(tools)/code-review-metrics/code-review-metrics-client";

beforeEach(() => {
  useWorkspaceStore.setState({
    codeReviewLogs: [
      {
        id: "codeReviewLog:current",
        samples: [
          {
            id: "p1",
            prNumber: "101",
            author: "ana",
            openedAt: "2026-10-01T09:00",
            mergedAt: "2026-10-02T09:00",
            reviewerCount: 2,
            commentCount: 7,
            linesChanged: 120,
          },
        ],
      },
    ] as never,
  });
});

describe("Code review metrics description", () => {
  it("describes the author chart, not reviewer load", () => {
    render(<CodeReviewMetricsClient />);
    const description = screen.getByTestId("tool-description").textContent ?? "";
    expect(description).not.toMatch(/reviewer load/i);
    expect(description).toMatch(/authors' PRs draw the most review comments/);
    expect(screen.getByText("Top PR authors by comments received")).toBeInTheDocument();
  });

  it("page metadata no longer promises a reviewer leaderboard", () => {
    expect(metadata.description).not.toMatch(/reviewer (leaderboard|load)/i);
    expect(metadata.description).toMatch(/authors/);
  });
});

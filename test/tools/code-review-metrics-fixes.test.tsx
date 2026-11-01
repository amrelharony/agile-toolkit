import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { metadata } from "@/app/(tools)/code-review-metrics/page";

/**
 * Code review metrics: the page once promised "reviewer load", then showed
 * "Top PR authors by comments received" (comments are logged per PR, so
 * reviews given can't be measured). Phase 8 replaced the per-author chart
 * with a team-level view by PR size: neither the page nor its metadata
 * ranks people now.
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
  it("shows the team view by PR size, with no author ranking", () => {
    render(
      <TooltipProvider>
        <CodeReviewMetricsClient />
      </TooltipProvider>
    );
    const description = screen.getByTestId("tool-description").textContent ?? "";
    expect(description).not.toMatch(/reviewer load|authors/i);
    expect(description).toMatch(/PR size for the team/);
    expect(screen.getByText("Review flow by PR size")).toBeInTheDocument();
    expect(screen.queryByText(/Top PR authors/)).toBeNull();
  });

  it("page metadata promises no reviewer leaderboard or author ranking", () => {
    expect(metadata.description).not.toMatch(/reviewer (leaderboard|load)|authors/i);
    expect(metadata.description).toMatch(/by PR size/);
  });
});

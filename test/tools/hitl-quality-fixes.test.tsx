import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HitlReview } from "@/lib/stores/workspace-types";

/**
 * HITL Quality: the KPI counts reviews where the reviewer agreed with the
 * model, so it's labelled "Reviewer–model agreement", not "Agreement rate"
 * (which reads as agreement between reviewers).
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

import { HitlQualityClient } from "@/app/(tools)/hitl-quality/hitl-quality-client";

const review = (id: string, agreedWithModel: boolean): HitlReview => ({
  id,
  feature: "Summaries",
  reviewer: id === "r1" ? "Ana" : "Ben",
  rating: 4,
  agreedWithModel,
  loggedAt: "2026-10-01T09:00:00.000Z",
});

beforeEach(() => {
  useWorkspaceStore.setState({
    hitlReviews: [review("r1", true), review("r2", true), review("r3", true), review("r4", false)],
  });
});

describe("HITL Quality: agreement KPI label", () => {
  it("labels the share of reviews that agreed with the model", () => {
    render(<HitlQualityClient />);
    const label = screen.getByText("Reviewer–model agreement");
    expect(label.parentElement).toHaveTextContent("75%");
    expect(screen.queryByText("Agreement rate")).not.toBeInTheDocument();
  });
});

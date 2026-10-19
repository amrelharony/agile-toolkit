import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RlhfPair } from "@/lib/stores/workspace-types";

/** RLHF Log: the Pairs list shows the latest 30 and now says so. */

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

import { RlhfLogClient } from "@/app/(tools)/rlhf-log/rlhf-log-client";

const pair = (i: number): RlhfPair => ({
  id: `p${i}`,
  prompt: `Prompt ${i}`,
  responseA: "A",
  responseB: "B",
  winner: i % 2 === 0 ? "A" : "B",
  loggedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
});

beforeEach(() => {
  useWorkspaceStore.setState({ rlhfPairs: [] });
});

describe("RLHF Log: truncated Pairs list", () => {
  it("says it shows the latest 30 of N", () => {
    useWorkspaceStore.setState({ rlhfPairs: Array.from({ length: 35 }, (_, i) => pair(i)) });
    render(<RlhfLogClient />);
    expect(screen.getByText(/Showing the latest 30 of 35 pairs/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove pair" })).toHaveLength(30);
    // The newest pair is listed, the oldest isn't.
    expect(screen.getByText("Prompt: Prompt 34")).toBeInTheDocument();
    expect(screen.queryByText("Prompt: Prompt 0")).not.toBeInTheDocument();
  });

  it("says nothing when every pair fits", () => {
    useWorkspaceStore.setState({ rlhfPairs: Array.from({ length: 30 }, (_, i) => pair(i)) });
    render(<RlhfLogClient />);
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
  });
});

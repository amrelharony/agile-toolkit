import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TokenSpend } from "@/lib/stores/workspace-types";

/**
 * Token-Cost Tracker:
 *  - Log used to do nothing, with no error, when Cost was blank and the
 *    model wasn't in the price table;
 *  - the spend log shows the latest 50 rows and now says so.
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

import { TokenCostTrackerClient } from "@/app/(tools)/token-cost-tracker/token-cost-tracker-client";

const spend = () => useWorkspaceStore.getState().tokenSpend ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const logSpend = () => fireEvent.click(screen.getByRole("button", { name: "Log" }));

const entry = (i: number): TokenSpend => ({
  id: `t${i}`,
  feature: `Feature ${i}`,
  model: "custom",
  date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
  inputTokens: 100,
  outputTokens: 100,
  costUsd: 1,
});

beforeEach(() => {
  useWorkspaceStore.setState({ tokenSpend: [] });
});

describe("Token-Cost Tracker: Log explains why it can't log", () => {
  it("asks for a cost when the model isn't in the price table", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "in-house-llm");
    type("Input tokens", "1000");
    type("Output tokens", "500");
    logSpend();

    expect(spend()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "“in-house-llm” isn't in the price table, so the cost can't be worked out. Type the Cost in USD."
    );
    expect(screen.getByLabelText("Cost USD")).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").id
    );
  });

  it("logs once a cost is typed, and the message goes away", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "in-house-llm");
    logSpend();
    type("Cost USD", "0.42");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    logSpend();

    expect(spend()).toHaveLength(1);
    expect(spend()[0]).toMatchObject({ feature: "Search", model: "in-house-llm", costUsd: 0.42 });
  });

  it("still fills in the cost from the price table for a known model", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "claude-sonnet-4-6");
    type("Input tokens", "1000");
    type("Output tokens", "500");
    logSpend();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(spend()).toHaveLength(1);
    expect(spend()[0].costUsd).toBeGreaterThan(0);
  });

  it("asks for tokens when the model is known but they're missing", () => {
    render(<TokenCostTrackerClient />);
    type("Feature", "Search");
    type("Model", "claude-sonnet-4-6");
    logSpend();
    expect(spend()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter the input and output tokens/);
  });

  it("asks for the feature first", () => {
    render(<TokenCostTrackerClient />);
    type("Cost USD", "1");
    logSpend();
    expect(spend()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the feature this spend belongs to.");
  });
});

describe("Token-Cost Tracker: the spend log says when it's truncated", () => {
  it("says it shows the latest 50 of N", () => {
    useWorkspaceStore.setState({ tokenSpend: Array.from({ length: 55 }, (_, i) => entry(i)) });
    render(<TokenCostTrackerClient />);
    expect(screen.getByText(/Showing the latest 50 of 55 entries/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Remove spend entry/ })).toHaveLength(50);
  });

  it("says nothing when every entry fits", () => {
    useWorkspaceStore.setState({ tokenSpend: Array.from({ length: 50 }, (_, i) => entry(i)) });
    render(<TokenCostTrackerClient />);
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
  });
});

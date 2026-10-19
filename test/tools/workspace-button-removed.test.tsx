import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * OKRs and Mood Tracker already save straight to the workspace, so their
 * no-op "Workspace" import/push button is gone.
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { OkrsClient } from "@/app/(tools)/okrs/okrs-client";
import { MoodTrackerClient } from "@/app/(tools)/mood-tracker/mood-tracker-client";

describe("tools that already live in the workspace", () => {
  it("OKRs render no Workspace push button", () => {
    render(<OkrsClient />);
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
    expect(screen.queryByText("Push to Workspace")).toBeNull();
  });

  it("Mood Tracker renders no Workspace push button", () => {
    render(<MoodTrackerClient />);
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
  });
});

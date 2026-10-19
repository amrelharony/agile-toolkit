import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/** Cynefin: the Rationale was saved but never shown. */

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

import { CynefinClient } from "@/app/(tools)/cynefin/cynefin-client";

beforeEach(() => {
  useWorkspaceStore.setState({
    cynefinItems: [
      {
        id: "c1",
        title: "New pricing page",
        domain: "complex",
        rationale: "We can't predict how customers will react.",
        loggedAt: "2026-10-01T09:00:00.000Z",
      },
      {
        id: "c2",
        title: "Rotate TLS certs",
        domain: "clear",
        loggedAt: "2026-10-01T09:00:00.000Z",
      },
    ],
  });
});

describe("Cynefin: item view", () => {
  it("shows a saved rationale under its item", () => {
    render(<CynefinClient />);
    const rationale = screen.getByText("We can't predict how customers will react.");
    expect(rationale.closest("li")).toHaveTextContent("New pricing page");
  });

  it("shows nothing extra for an item without a rationale", () => {
    render(<CynefinClient />);
    const item = screen.getByText("Rotate TLS certs").closest("li")!;
    expect(item).not.toHaveTextContent("Rationale");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/** DACI: "Options considered" was saved but never shown. */

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

import { DaciClient } from "@/app/(tools)/daci/daci-client";

beforeEach(() => {
  useWorkspaceStore.setState({
    daciDecisions: [
      {
        id: "d1",
        title: "Pick a feature-flag vendor",
        driver: "Ana",
        approver: "Ben",
        options: ["LaunchDarkly", "Unleash", "Build our own"],
        recommendation: "Unleash",
        status: "open",
        date: "2026-10-01T09:00:00.000Z",
      },
    ],
  });
});

describe("DACI: item view", () => {
  it("lists the options considered", () => {
    render(<DaciClient />);
    const heading = screen.getByText("Options considered:");
    const list = within(heading.parentElement!).getByRole("list");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["LaunchDarkly", "Unleash", "Build our own"]);
  });

  it("omits the section when no options were recorded", () => {
    useWorkspaceStore.setState({
      daciDecisions: [
        {
          id: "d2",
          title: "Move standup to 10am",
          options: [],
          status: "open",
          date: "2026-10-01T09:00:00.000Z",
        },
      ],
    });
    render(<DaciClient />);
    expect(screen.queryByText("Options considered:")).not.toBeInTheDocument();
  });
});

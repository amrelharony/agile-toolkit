import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Stakeholder Map: the Name field's placeholder is a person's name and the
 * Role field's is a role. Name used to suggest "VP of Marketing" and Role
 * "Sponsor / Customer / Exec...".
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

// Radix Slider measures itself; jsdom doesn't ship ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { StakeholderMapClient } from "@/app/(tools)/stakeholder-map/stakeholder-map-client";

describe("Stakeholder Map add form", () => {
  it("suggests a name for Name and a role for Role", () => {
    render(<StakeholderMapClient />);
    expect(screen.getByRole("textbox", { name: "Stakeholder name" })).toHaveAttribute(
      "placeholder",
      "Priya Shah"
    );
    expect(screen.getByRole("textbox", { name: "Role" })).toHaveAttribute(
      "placeholder",
      "VP of Marketing"
    );
  });
});

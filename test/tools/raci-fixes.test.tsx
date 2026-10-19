import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * RACI: validation flags an activity with no Responsible (R), not only one
 * without exactly one Accountable (A).
 */

// The RACI store hydrates from localStorage when its module loads, so seed
// the matrix before the import below runs.
vi.hoisted(() => {
  localStorage.setItem(
    "agile-toolkit:raci",
    JSON.stringify({
      state: {
        roles: [
          { id: "po", name: "Product Owner" },
          { id: "dev", name: "Dev Team" },
        ],
        activities: [
          { id: "ship", name: "Ship release" },
          { id: "plan", name: "Plan sprint" },
        ],
        matrix: {
          ship: { po: "A", dev: "C" }, // an A but nobody does the work
          plan: { po: "A", dev: "R" }, // fine
        },
      },
      version: 0,
    })
  );
});

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

import { RACIClient } from "@/app/(tools)/raci/raci-client";

describe("RACI validation", () => {
  it("flags an activity that has an A but no R", () => {
    render(<RACIClient />);
    expect(screen.getByText("1 validation issue")).toBeInTheDocument();
    expect(
      screen.getByText('"Ship release" has no Responsible (R) role assigned. Add at least one R.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/"Plan sprint" has no/)).toBeNull();
  });
});

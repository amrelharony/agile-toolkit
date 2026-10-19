import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Control map: "Implemented & ready for audit review" showed for Verified
 * controls too. Each done status now gets its own note.
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

import { ControlMapClient } from "@/app/(tools)/control-map/control-map-client";

const control = (id: string, controlId: string, status: string) => ({
  id,
  controlId,
  framework: "soc2",
  title: `Control ${controlId}`,
  status,
  evidenceLinks: [],
});

beforeEach(() => {
  useWorkspaceStore.setState({
    controlMaps: [
      {
        id: "controlMap:current",
        controls: [
          control("c1", "CC1.1", "implemented"),
          control("c2", "CC2.1", "verified"),
          control("c3", "CC3.1", "in_progress"),
        ],
      },
    ] as never,
  });
});

describe("Control map status notes", () => {
  it("says 'ready for audit review' only for Implemented, and 'audited' for Verified", () => {
    render(<ControlMapClient />);
    expect(screen.getAllByText("Implemented & ready for audit review.")).toHaveLength(1);
    expect(screen.getAllByText(/^Verified: audited/)).toHaveLength(1);
  });
});

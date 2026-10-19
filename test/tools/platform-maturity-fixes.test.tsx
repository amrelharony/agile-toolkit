import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Platform maturity:
 * - Reset wiped every score and note with one click. It now asks first,
 *   with what will be lost, and offers Undo.
 * - The 1-5 sliders didn't say what a level means. Each shows the level's
 *   meaning (the roadmap's criteria) as text and in aria-valuetext.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
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

import { PlatformMaturityClient } from "@/app/(tools)/platform-maturity/platform-maturity-client";

const doc = () => (useWorkspaceStore.getState().platformMaturities ?? [])[0];

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    platformMaturities: [
      {
        id: "platformMaturity:current",
        dimensions: {
          goldenPaths: 3,
          internalDevPlatform: 1,
          runbookHygiene: 4,
          onCallMaturity: 2,
          selfServiceProvisioning: 1,
          observabilityDefaults: 5,
          deploymentAutomation: 3,
          cognitiveLoadReduction: 2,
        },
        notes: { goldenPaths: "3 paths live", runbookHygiene: "Quarterly review" },
      },
    ] as never,
  });
});

describe("Platform maturity reset", () => {
  it("asks first, names what is lost, and can be undone", () => {
    render(<PlatformMaturityClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    // Nothing is lost until confirmed.
    expect(doc()?.dimensions.goldenPaths).toBe(3);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset the assessment?");
    expect(dialog).toHaveTextContent("All 8 scores go back to level 1 and 2 notes are cleared");

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset assessment" }));
    expect(doc()?.dimensions.goldenPaths).toBe(1);
    expect(doc()?.notes).toEqual({});
    expect(undo.last?.label).toBe("Reset the assessment");

    act(() => undo.last!.revert());
    expect(doc()?.dimensions.goldenPaths).toBe(3);
    expect(doc()?.dimensions.observabilityDefaults).toBe(5);
    expect(doc()?.notes.goldenPaths).toBe("3 paths live");
  });

  it("Cancel keeps everything", () => {
    render(<PlatformMaturityClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(doc()?.dimensions.goldenPaths).toBe(3);
    expect(undo.last).toBeNull();
  });
});

describe("Platform maturity level meanings", () => {
  it("says what the current level means, visibly and to screen readers", () => {
    render(<PlatformMaturityClient />);
    expect(screen.getByTestId("level-goldenPaths")).toHaveTextContent(
      "Level 3: ≥3 golden paths exist with starter templates"
    );
    expect(screen.getByTestId("level-internalDevPlatform")).toHaveTextContent(
      "Level 1: Ad hoc or missing"
    );
    const slider = screen.getByRole("slider", { name: "Golden paths maturity score" });
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/^3 of 5: ≥3 golden paths exist/)
    );
  });
});

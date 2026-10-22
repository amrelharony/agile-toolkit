import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Platform maturity core: the default level-1 assessment, scoring with the
 * sliders, notes, the average, the improvement roadmap (dimensions below
 * level 3, with their next level's criteria), clamping of corrupt scores,
 * Save snapshot, the reset confirmation copy and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
// undo wrapper: run the change immediately
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
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
import { PLATFORM_MATURITY_ACTIONS } from "@/lib/history/event-actions";

const PM_ID = "platformMaturity:current";
const IDS = [
  "goldenPaths",
  "internalDevPlatform",
  "runbookHygiene",
  "onCallMaturity",
  "selfServiceProvisioning",
  "observabilityDefaults",
  "deploymentAutomation",
  "cognitiveLoadReduction",
] as const;
const LABELS = [
  "Golden paths",
  "Internal Developer Platform",
  "Runbook hygiene",
  "On-call maturity",
  "Self-service provisioning",
  "Observability defaults",
  "Deployment automation",
  "Cognitive load reduction",
];

function seed(scores: number[], notes: Record<string, string> = {}) {
  useWorkspaceStore.setState({
    platformMaturities: [
      {
        id: PM_ID,
        dimensions: Object.fromEntries(IDS.map((id, i) => [id, scores[i]])),
        notes,
      },
    ],
  });
}

const doc = () =>
  (useWorkspaceStore.getState().platformMaturities ?? []).find((d) => d.id === PM_ID);

const average = () =>
  screen.getByText(/Average maturity:/).querySelector(".font-data")?.textContent;

/** Roadmap entries as "Label (level a → b)". */
const roadmap = () => {
  const section = screen.getByText("Improvement roadmap").closest(".rounded-xl") as HTMLElement;
  return within(section)
    .queryAllByText(/\(level \d → \d\)/)
    .map((el) => el.parentElement!.textContent);
};

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ platformMaturities: [] });
});

describe("Platform maturity — default assessment", () => {
  it("starts every dimension at level 1 with an average of 1.00", () => {
    render(<PlatformMaturityClient />);
    expect(average()).toBe("1.00");
    for (const label of LABELS) {
      expect(screen.getByRole("slider", { name: `${label} maturity score` })).toHaveAttribute(
        "aria-valuenow",
        "1"
      );
    }
    expect(roadmap()).toEqual(LABELS.map((l) => `${l} (level 1 → 2)`));
    expect(screen.getByTestId("level-onCallMaturity")).toHaveTextContent(
      "Level 1: Ad hoc or missing; not yet at level 2."
    );
  });
});

describe("Platform maturity — scoring", () => {
  it("moves a dimension with the slider, stores it and updates the average", () => {
    render(<PlatformMaturityClient />);
    const slider = screen.getByRole("slider", { name: "Golden paths maturity score" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });

    expect(doc()?.dimensions.goldenPaths).toBe(3);
    // The other dimensions are written out at their default level.
    expect(doc()?.dimensions.cognitiveLoadReduction).toBe(1);
    expect(average()).toBe("1.25");
    expect(screen.getByTestId("level-goldenPaths")).toHaveTextContent(
      "Level 3: ≥3 golden paths exist with starter templates; ≥50% of new services use them."
    );
    expect(roadmap()).not.toContain("Golden paths (level 3 → 4)");
    expect(history.log).toHaveBeenCalledWith(PLATFORM_MATURITY_ACTIONS.RATING_CHANGED, {
      dimension: "goldenPaths",
      score: 3,
    });
  });

  it("keeps the slider within 1..5", () => {
    seed([5, 1, 1, 1, 1, 1, 1, 1]);
    render(<PlatformMaturityClient />);
    const top = screen.getByRole("slider", { name: "Golden paths maturity score" });
    fireEvent.keyDown(top, { key: "ArrowRight" });
    expect(doc()?.dimensions.goldenPaths).toBe(5);
    const bottom = screen.getByRole("slider", { name: "Runbook hygiene maturity score" });
    fireEvent.keyDown(bottom, { key: "ArrowLeft" });
    expect(doc()?.dimensions.runbookHygiene).toBe(1);
  });

  it("shows level 5 criteria at the top level", () => {
    seed([1, 1, 1, 1, 1, 5, 1, 1]);
    render(<PlatformMaturityClient />);
    expect(screen.getByTestId("level-observabilityDefaults")).toHaveTextContent(
      "Level 5: Observability quality gates exist; missing telemetry blocks deploys."
    );
  });

  it("clamps corrupt stored scores into 1..5 everywhere they are shown", () => {
    seed([0, 9, 3, 3, 3, 3, 3, 3]);
    render(<PlatformMaturityClient />);
    expect(screen.getByTestId("level-goldenPaths")).toHaveTextContent("Level 1:");
    expect(screen.getByTestId("level-internalDevPlatform")).toHaveTextContent("Level 5:");
    // (1 + 5 + 6 × 3) / 8 = 3
    expect(average()).toBe("3.00");
    expect(roadmap()).toEqual(["Golden paths (level 1 → 2)"]);
    expect(exported.csv?.rows[0]).toEqual(["Golden paths", 1, ""]);
    expect(exported.csv?.rows[1]).toEqual(["Internal Developer Platform", 5, ""]);
  });
});

describe("Platform maturity — notes", () => {
  it("commits a note on blur only", () => {
    render(<PlatformMaturityClient />);
    const note = screen.getByLabelText("Golden paths description");
    fireEvent.change(note, { target: { value: "3 paths live" } });
    expect(doc()).toBeUndefined();
    fireEvent.blur(note);
    expect(doc()?.notes).toEqual({ goldenPaths: "3 paths live" });
    expect(doc()?.dimensions.goldenPaths).toBe(1);
  });

  it("shows stored notes", () => {
    seed([1, 1, 1, 1, 1, 1, 1, 1], { runbookHygiene: "Quarterly review" });
    render(<PlatformMaturityClient />);
    expect(screen.getByLabelText("Runbook hygiene description")).toHaveValue("Quarterly review");
  });
});

describe("Platform maturity — roadmap", () => {
  it("lists only dimensions below level 3, with the next level's criteria", () => {
    seed([2, 3, 1, 4, 5, 2, 3, 3]);
    render(<PlatformMaturityClient />);
    expect(roadmap()).toEqual([
      "Golden paths (level 2 → 3)",
      "Runbook hygiene (level 1 → 2)",
      "Observability defaults (level 2 → 3)",
    ]);
    const section = within(
      screen.getByText("Improvement roadmap").closest(".rounded-xl") as HTMLElement
    );
    expect(
      section.getByText(
        "≥3 golden paths exist with starter templates; ≥50% of new services use them."
      )
    ).toBeInTheDocument();
    expect(
      section.getByText("Some services have runbooks; quality varies wildly.")
    ).toBeInTheDocument();
  });

  it("congratulates when every dimension is at level 3 or above", () => {
    seed([3, 3, 4, 5, 3, 4, 3, 5]);
    render(<PlatformMaturityClient />);
    expect(roadmap()).toEqual([]);
    expect(screen.getByText(/All 8 dimensions are at level 3 or above/)).toBeInTheDocument();
    expect(average()).toBe("3.75");
  });
});

describe("Platform maturity — snapshot and reset", () => {
  it("logs a milestone snapshot with the clamped average and the raw scores and notes", () => {
    seed([2, 3, 1, 4, 5, 2, 3, 9], { goldenPaths: "two paths" });
    render(<PlatformMaturityClient />);
    fireEvent.click(screen.getByRole("button", { name: /Save snapshot/ }));
    expect(history.log).toHaveBeenCalledWith(
      PLATFORM_MATURITY_ACTIONS.ASSESSMENT_SAVED,
      {
        avg: (2 + 3 + 1 + 4 + 5 + 2 + 3 + 5) / 8,
        dimensions: expect.objectContaining({ goldenPaths: 2, cognitiveLoadReduction: 9 }),
        notes: { goldenPaths: "two paths" },
      },
      { milestone: true }
    );
  });

  it.each([
    [{}, "All 8 scores go back to level 1. Saved snapshots in history are kept."],
    [
      { goldenPaths: "two paths", runbookHygiene: "   " },
      "All 8 scores go back to level 1 and 1 note is cleared. Saved snapshots in history are kept.",
    ],
  ])("describes what a reset loses (%o)", (notes, text) => {
    seed([2, 3, 1, 4, 5, 2, 3, 3], notes);
    render(<PlatformMaturityClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(text);
  });

  it("resets every score to 1 and clears the notes once confirmed", () => {
    seed([2, 3, 1, 4, 5, 2, 3, 3], { goldenPaths: "two paths" });
    render(<PlatformMaturityClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset assessment" })
    );
    expect(Object.values(doc()!.dimensions)).toEqual(IDS.map(() => 1));
    expect(doc()?.notes).toEqual({});
    expect(average()).toBe("1.00");
    expect(screen.getByLabelText("Golden paths description")).toHaveValue("");
    expect(history.log).toHaveBeenCalledWith(PLATFORM_MATURITY_ACTIONS.PLATFORM_RESET, {});
  });
});

describe("Platform maturity — export", () => {
  it("exports one CSV row per dimension in order", () => {
    seed([2, 3, 1, 4, 5, 2, 3, 3], { onCallMaturity: "Handover doc" });
    render(<PlatformMaturityClient />);
    expect(exported.csv?.headers).toEqual(["Dimension", "Score", "Description"]);
    expect(exported.csv?.rows).toEqual([
      ["Golden paths", 2, ""],
      ["Internal Developer Platform", 3, ""],
      ["Runbook hygiene", 1, ""],
      ["On-call maturity", 4, "Handover doc"],
      ["Self-service provisioning", 5, ""],
      ["Observability defaults", 2, ""],
      ["Deployment automation", 3, ""],
      ["Cognitive load reduction", 3, ""],
    ]);
  });
});

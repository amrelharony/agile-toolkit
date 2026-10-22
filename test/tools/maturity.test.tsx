import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { MATURITY_DIMENSIONS, getMaturityScore } from "@/lib/constants/maturity-model";

/**
 * Agile Maturity Assessment: the overall %/level/average, the sliders, the
 * target-level picker and improvement roadmap, reset, the derived workspace
 * maturity level and the clipboard export.
 */

const exported = vi.hoisted(() => ({ clipboard: undefined as string | undefined }));
const logs = vi.hoisted(() => [] as string[]);

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ clipboardText }: { clipboardText?: string }) => {
    exported.clipboard = clipboardText;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action) }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { MaturityClient } from "@/app/(tools)/maturity/maturity-client";

const ID = "maturity:current";
const ids = MATURITY_DIMENSIONS.map((d) => d.id);
const all = (level: number) => Object.fromEntries(ids.map((id) => [id, level]));

const seed = (scores: Record<string, number>, targetLevel = 4) =>
  useWorkspaceStore.setState({ maturityAssessments: [{ id: ID, scores, targetLevel }] });
const doc = () => (useWorkspaceStore.getState().maturityAssessments ?? []).find((d) => d.id === ID);

const avg = () => screen.getByText(/^Avg level/);
const targetButton = (n: number) =>
  within(screen.getByRole("group", { name: "Target level:" })).getByRole("button", {
    name: String(n),
  });

beforeEach(() => {
  logs.length = 0;
  exported.clipboard = undefined;
  useWorkspaceStore.setState({ maturityAssessments: [], maturityLevel: 3 });
});

describe("getMaturityScore", () => {
  it("names the rounded average with the level labels", () => {
    expect(getMaturityScore(1)).toMatchObject({ percentage: 20, level: 1, label: "Initial" });
    expect(getMaturityScore(2.5)).toMatchObject({ percentage: 50, level: 3, label: "Defined" });
    expect(getMaturityScore(4.49)).toMatchObject({ percentage: 90, level: 4, label: "Managed" });
    expect(getMaturityScore(5)).toMatchObject({ percentage: 100, level: 5, label: "Optimizing" });
  });

  // Bug: 2.875 / 5 * 100 is 57.49999… in floating point, so a 7×3 + 1×2 team read 57%.
  it("rounds a half percent up", () => {
    expect(getMaturityScore(2.875).percentage).toBe(58);
    expect(getMaturityScore(1.125).percentage).toBe(23);
  });

  it("keeps the level in 1-5 for out-of-range or non-finite averages", () => {
    expect(getMaturityScore(0).level).toBe(1);
    expect(getMaturityScore(9).level).toBe(5);
    expect(getMaturityScore(Number.NaN)).toMatchObject({ level: 1, label: "Initial" });
  });
});

describe("Maturity: defaults", () => {
  it("starts every dimension at level 1 with target 4", () => {
    render(<MaturityClient />);
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Level 1 · Initial")).toBeInTheDocument();
    expect(avg()).toHaveTextContent("Avg level 1.0 / 5");
    expect(screen.getAllByText("1 — Initial")).toHaveLength(ids.length);
    for (const d of MATURITY_DIMENSIONS) {
      expect(screen.getByRole("slider", { name: d.name })).toHaveAttribute("aria-valuenow", "1");
    }
    expect(targetButton(4)).toHaveAttribute("aria-pressed", "true");
    expect(targetButton(2)).toHaveAttribute("aria-pressed", "false");
    // Every dimension is below target 4, each one step at a time.
    expect(screen.getAllByText("Level 1 → 2 (target: 4)")).toHaveLength(ids.length);
  });

  it("writes the rounded average into the workspace maturity level", () => {
    render(<MaturityClient />);
    expect(useWorkspaceStore.getState().maturityLevel).toBe(1);
  });
});

describe("Maturity: scoring", () => {
  it("moves a dimension with its slider and stores only that score", () => {
    render(<MaturityClient />);
    const thumb = screen.getByRole("slider", { name: "Scrum Practices" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(doc()).toMatchObject({ id: ID, targetLevel: 4 });
    expect(doc()?.scores).toEqual({ ...all(1), "scrum-practices": 2 });
    expect(thumb).toHaveAttribute("aria-valuenow", "2");
    expect(thumb).toHaveAttribute("aria-valuetext", "2 — Developing");
    expect(screen.getByText("2 — Developing")).toBeInTheDocument();
    expect(logs).toContain("rating_changed");
    // average (2 + 7·1)/8 = 1.125 → 23%
    expect(screen.getByText("23%")).toBeInTheDocument();
    expect(avg()).toHaveTextContent("1.1 / 5");
  });

  it("derives the overall score from the stored scores", () => {
    seed({ ...all(2), [ids[0]]: 5, [ids[1]]: 4 }); // (5+4+6·2)/8 = 2.625
    render(<MaturityClient />);
    expect(screen.getByText("53%")).toBeInTheDocument();
    expect(screen.getByText("Level 3 · Defined")).toBeInTheDocument();
    expect(avg()).toHaveTextContent("2.6 / 5");
    expect(useWorkspaceStore.getState().maturityLevel).toBe(3);
  });

  it("treats a dimension missing from the stored scores as level 1", () => {
    seed(Object.fromEntries(ids.slice(1).map((id) => [id, 5]))); // (1 + 7·5)/8 = 4.5
    render(<MaturityClient />);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: MATURITY_DIMENSIONS[0].name })).toHaveAttribute(
      "aria-valuenow",
      "1"
    );
  });

  // Bug: an out-of-range stored score pushed the page past 100% while the agent's list_state clamps it.
  it("counts an out-of-range stored score as the nearest valid level", () => {
    seed({ ...all(5), [ids[0]]: 9 }); // unclamped (9 + 7·5)/8 = 5.5 → "110%"
    const { unmount } = render(<MaturityClient />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(avg()).toHaveTextContent("5.0 / 5");
    unmount();

    seed({ ...all(1), [ids[0]]: 0 }); // unclamped (0 + 7)/8 = 0.875 → "18%"
    render(<MaturityClient />);
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(avg()).toHaveTextContent("1.0 / 5");
  });

  it("resets every dimension to 1 and the target to 4", () => {
    seed(all(3), 5);
    render(<MaturityClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(doc()).toEqual({ id: ID, scores: all(1), targetLevel: 4 });
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(targetButton(4)).toHaveAttribute("aria-pressed", "true");
    expect(logs).toContain("maturity_reset");
  });
});

describe("Maturity: improvement roadmap", () => {
  it("lists only dimensions below the target, with the next level's description", () => {
    seed({ ...all(4), [ids[0]]: 2, [ids[1]]: 3 });
    render(<MaturityClient />);
    expect(screen.getByText("Level 2 → 3 (target: 4)")).toBeInTheDocument();
    // One step from the target: no "(target …)" suffix.
    expect(screen.getByText("Level 3 → 4")).toBeInTheDocument();
    const next = MATURITY_DIMENSIONS[0].levels.find((l) => l.level === 3)!;
    expect(screen.getByText(next.description)).toBeInTheDocument();
    expect(screen.queryByText(/All dimensions meet or exceed/)).toBeNull();
  });

  it("changes the target level and re-derives the roadmap", () => {
    seed({ ...all(4), [ids[0]]: 2 });
    render(<MaturityClient />);
    fireEvent.click(targetButton(5));
    expect(doc()?.targetLevel).toBe(5);
    expect(targetButton(5)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Level 2 → 3 (target: 5)")).toBeInTheDocument();
    expect(screen.getAllByText("Level 4 → 5")).toHaveLength(ids.length - 1);

    fireEvent.click(targetButton(2));
    expect(doc()?.targetLevel).toBe(2);
    expect(doc()?.scores).toEqual({ ...all(4), [ids[0]]: 2 });
    expect(screen.getByText("All dimensions meet or exceed target level 2!")).toBeInTheDocument();
  });

  it("congratulates when every dimension meets the target", () => {
    seed(all(4));
    render(<MaturityClient />);
    expect(screen.getByText("All dimensions meet or exceed target level 4!")).toBeInTheDocument();
  });

  it("clamps a stored target outside 2-5 when building the roadmap", () => {
    seed(all(5), 9);
    render(<MaturityClient />);
    expect(screen.getByText("All dimensions meet or exceed target level 5!")).toBeInTheDocument();
    // No target button claims to be pressed for an impossible target.
    for (const n of [2, 3, 4, 5]) {
      expect(targetButton(n)).toHaveAttribute("aria-pressed", "false");
    }
  });
});

describe("Maturity: clipboard export", () => {
  it("lists the overall score, each dimension and the roadmap", () => {
    seed({ ...all(3), [ids[0]]: 2 }); // (2 + 7·3)/8 = 2.875 → 57.5% → 58%
    render(<MaturityClient />);
    const text = exported.clipboard ?? "";
    expect(text).toContain("AGILE MATURITY ASSESSMENT");
    expect(text).toContain("Overall Score: 58% — Level 3 (Defined)");
    expect(text).toContain("Average Level: 2.9 / 5");
    expect(text).toContain(`${"Scrum Practices".padEnd(28)} Level 2 (Developing)`);
    expect(text).toContain("IMPROVEMENT ROADMAP");
    expect(text).toContain("Scrum Practices (2 → 4)");
    const next = MATURITY_DIMENSIONS[0].levels.find((l) => l.level === 3)!;
    expect(text).toContain(`  Next: ${next.description}`);
  });

  it("leaves the roadmap out when nothing is below the target", () => {
    seed(all(5));
    render(<MaturityClient />);
    expect(exported.clipboard).toContain("Overall Score: 100% — Level 5 (Optimizing)");
    expect(exported.clipboard).not.toContain("IMPROVEMENT ROADMAP");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ParkingLotItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { NextStepCard } from "@/components/tool-frame/next-step";
import { getNextStepRule, toolsWithNextSteps } from "@/lib/tools/next-steps";
import { getToolById } from "@/lib/constants/tools";

/**
 * "Next step" under a tool reads the workspace and points somewhere real,
 * and renders nothing when no step applies.
 */

const ice = (id: string, extra: Partial<PrioritizationItem> = {}): PrioritizationItem => ({
  id,
  framework: "ice",
  title: `Idea ${id}`,
  score: 100,
  fields: { impact: 5, confidence: 5, ease: 4 },
  status: "scored",
  updatedAt: "2026-10-23T00:00:00.000Z",
  ...extra,
});

beforeEach(() => {
  useWorkspaceStore.setState({ prioritizations: [] });
});

describe("next-step rules", () => {
  it("are declared only for tools that exist", () => {
    for (const id of toolsWithNextSteps()) expect(getToolById(id), id).toBeDefined();
  });

  it("ICE: nothing for an empty list or example rows only", () => {
    const rule = getNextStepRule("ice-score")!;
    expect(rule.steps(rule.select({ prioritizations: [] } as never))).toEqual([]);
    const examples = [ice("example-1"), ice("example-2"), ice("example-3")];
    expect(rule.steps(rule.select({ prioritizations: examples } as never))).toEqual([]);
  });

  it("ICE: compare across methods once an idea is on the backlog, then RICE", () => {
    const rule = getNextStepRule("ice-score")!;
    const rows = [ice("a", { backlogItemId: "b1" }), ice("b"), ice("c")];
    const steps = rule.steps(rule.select({ prioritizations: rows } as never));
    expect(steps.map((s) => s.href)).toEqual(["/prioritizer", "/rice-scoring"]);
    expect(steps[0].detail).toMatch(/^1 ICE idea is on the backlog/);
  });
});

describe("NextStepCard", () => {
  it("renders nothing for a tool without a rule", () => {
    const { container } = render(<NextStepCard toolId="retro" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the first step as a link and follows the workspace", () => {
    render(<NextStepCard toolId="ice-score" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    act(() => useWorkspaceStore.setState({ prioritizations: [ice("a"), ice("b"), ice("c")] }));
    expect(
      screen.getByRole("heading", { name: "Check the front-runners with RICE" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Go/ })).toHaveAttribute("href", "/rice-scoring");
  });

  it("loads a phase 1 tool's model with its own card only, then shows its step", async () => {
    const point: ParkingLotItem = {
      id: "p1",
      text: "Who owns the release checklist?",
      status: "open",
      createdAt: "2026-10-23T09:00:00.000Z",
      updatedAt: "2026-10-23T09:00:00.000Z",
    };
    act(() => useWorkspaceStore.setState({ parkingLotItems: [point] }));
    const rule = getNextStepRule("parking-lot")!;
    // The table carries no phase 1 model: nothing to say until it has loaded.
    expect(rule.ready?.()).toBe(false);
    expect(rule.steps(rule.select(useWorkspaceStore.getState() as never))).toEqual([]);
    expect(getNextStepRule("meeting-audit")?.ready?.()).toBe(false);

    render(<NextStepCard toolId="parking-lot" />);
    expect(await screen.findByRole("link", { name: /Go/ })).toHaveAttribute("href", "/parking-lot");
    expect(rule.ready?.()).toBe(true);
    // Another tool's model stays where it is.
    expect(getNextStepRule("meeting-audit")?.ready?.()).toBe(false);
    act(() => useWorkspaceStore.setState({ parkingLotItems: [] }));
  });
});
